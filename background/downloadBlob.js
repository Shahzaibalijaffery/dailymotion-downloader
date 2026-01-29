/**
 * Blob download functionality
 * Handles downloading merged video blobs to user's computer via Chrome downloads API
 */

/**
 * Download a blob (merged video file) to user's computer
 * @param {Blob} blob - The blob to download
 * @param {string} filename - The filename for the download
 * @param {string|null} downloadId - The download ID for tracking
 * @param {Map} downloadControllers - Map of download controllers
 * @param {Map} activeChromeDownloads - Map of active Chrome downloads
 * @param {Function} cleanupIndexedDBBlob - Function to cleanup IndexedDB blobs
 * @param {Function} setupOffscreenDocument - Function to setup offscreen document
 * @param {Function} blobToDataUrl - Function to convert blob to data URL
 * @returns {Promise<void>}
 */
async function downloadBlob(blob, filename, downloadId, downloadControllers, activeChromeDownloads, cleanupIndexedDBBlob, setupOffscreenDocument, blobToDataUrl) {
  console.log('[downloadBlob] Called with filename:', filename, 'downloadId:', downloadId, 'blobSize:', blob.size);
  const blobSize = blob.size;
  
  // Check if download already exists for this downloadId
  if (downloadId) {
    for (const [chromeId, info] of activeChromeDownloads.entries()) {
      if (info.downloadId === downloadId) {
        console.log('[downloadBlob] Download already exists for downloadId, monitoring:', chromeId);
        // Download already in progress for this downloadId, just wait for it
        return new Promise((resolve, reject) => {
          const checkComplete = () => {
            chrome.downloads.search({ id: chromeId }, (results) => {
              if (results && results.length > 0) {
                if (results[0].state === 'complete') {
                  resolve();
                } else if (results[0].state === 'interrupted') {
                  reject(new Error(`Download interrupted: ${results[0].error || 'Unknown error'}`));
                } else {
                  setTimeout(checkComplete, 1000);
                }
              } else {
                reject(new Error('Download not found'));
              }
            });
          };
          checkComplete();
        });
      }
    }
  }
  
  try {
    console.log('[downloadBlob] Starting blob download process');
    // Convert blob to ArrayBuffer
    const arrayBuffer = await blob.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      throw new Error('Blob is empty (0 bytes)');
    }
    
    // Store in IndexedDB
    const blobId = `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('DailymotionDownloaderDB', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('blobs')) {
          db.createObjectStore('blobs');
        }
      };
    });
    
    const transaction = db.transaction(['blobs'], 'readwrite');
    const store = transaction.objectStore('blobs');
    await new Promise((resolve, reject) => {
      const request = store.put(arrayBuffer, blobId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    
    await new Promise(resolve => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      setTimeout(() => resolve(), 5000);
    });
    db.close();
    
    // Setup offscreen document
    await setupOffscreenDocument();
    
    // Wait for offscreen document to be ready (simplified ping)
    let offscreenReady = false;
    const offscreenReadyListener = (request) => {
      if (request.action === 'offscreenReady') {
        offscreenReady = true;
        return true;
      }
    };
    chrome.runtime.onMessage.addListener(offscreenReadyListener);
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    for (let i = 0; i < 5 && !offscreenReady; i++) {
      if (i > 0) await new Promise(resolve => setTimeout(resolve, 300));
      try {
        await new Promise((pingResolve) => {
          const timeout = setTimeout(pingResolve, 1000);
          chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
            clearTimeout(timeout);
            if (!chrome.runtime.lastError && (response?.ready || response?.success)) {
              offscreenReady = true;
            }
            pingResolve();
          });
        });
      } catch (e) {}
    }
    chrome.runtime.onMessage.removeListener(offscreenReadyListener);
    
    return new Promise((resolve, reject) => {
      const messageTimeout = setTimeout(() => {
        cleanupIndexedDBBlob(blobId);
        reject(new Error('Offscreen document timeout'));
      }, 10000);
      
      const sendMessage = (retryCount = 0) => {
        chrome.runtime.sendMessage({
          action: 'downloadBlobFromIndexedDB',
          blobId: blobId,
          filename: filename,
          mimeType: blob.type || 'video/mp4',
          expectedSize: blobSize
        }, (response) => {
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message;
            console.error('[downloadBlob] Error sending message to offscreen:', errorMsg, 'retryCount:', retryCount);
            if ((errorMsg.includes('Receiving end does not exist') || errorMsg.includes('Could not establish connection')) && retryCount < 3) {
              console.log('[downloadBlob] Retrying message to offscreen in 2 seconds');
              setTimeout(() => sendMessage(retryCount + 1), 2000);
              return;
            }
            clearTimeout(messageTimeout);
            cleanupIndexedDBBlob(blobId);
            reject(new Error(`Offscreen document error: ${errorMsg}`));
            return;
          }
          
          clearTimeout(messageTimeout);
          
          if (!response?.success || !response?.blobUrl) {
            console.error('[downloadBlob] Invalid response from offscreen:', response);
            cleanupIndexedDBBlob(blobId);
            reject(new Error(response?.error || 'Invalid response from offscreen document'));
            return;
          }
          
          console.log('[downloadBlob] Received blobUrl from offscreen, calling handleBlobUrlResponse');
          handleBlobUrlResponse(response.blobUrl);
        });
      };
      
      function handleBlobUrlResponse(blobUrl) {
        console.log('[downloadBlob] handleBlobUrlResponse called with blobUrl:', blobUrl?.substring(0, 50) + '...');
        let downloadStarted = false;
        let isResolved = false;
        let hasRetried = false;
        let currentChromeDownloadId = null;
        let verificationInterval = null;
        
        const attemptDownload = (useSaveAs) => {
          console.log('[downloadBlob] attemptDownload called, useSaveAs:', useSaveAs, 'downloadStarted:', downloadStarted);
          // Prevent multiple downloads
          if (downloadStarted) {
            console.log('[downloadBlob] Download already started, returning');
            return;
          }
          
          const controllerInfo = downloadControllers.get(downloadId);
          if (controllerInfo?.controller.signal.aborted) {
            console.log('[downloadBlob] Download cancelled (controller aborted)');
            cleanupIndexedDBBlob(blobId);
            reject(new Error('Download cancelled'));
            return;
          }
          
          chrome.storage.local.get([`downloadCancelled_${downloadId}`], (items) => {
            if (items[`downloadCancelled_${downloadId}`]) {
              console.log('[downloadBlob] Download cancelled (storage flag)');
              cleanupIndexedDBBlob(blobId);
              reject(new Error('Download cancelled'));
              return;
            }
            
            // Check if download already exists for this downloadId
            if (downloadId) {
              for (const [existingChromeId, existingInfo] of activeChromeDownloads.entries()) {
                if (existingInfo.downloadId === downloadId) {
                  console.log('[downloadBlob] Download already exists, monitoring existing:', existingChromeId);
                  // Download already exists for this downloadId, just monitor it
                  const verifyExisting = () => {
                    if (isResolved) return;
                    chrome.downloads.search({ id: existingChromeId }, (results) => {
                      if (results && results.length > 0) {
                        if (results[0].state === 'complete') {
                          cleanupIndexedDBBlob(blobId);
                          if (!isResolved) {
                            isResolved = true;
                            resolve();
                          }
                        } else if (results[0].state === 'interrupted') {
                          cleanupIndexedDBBlob(blobId);
                          if (!isResolved) {
                            isResolved = true;
                            reject(new Error(`Download interrupted: ${results[0].error || 'Unknown error'}`));
                          }
                        }
                      }
                    });
                  };
                  const existingInterval = setInterval(verifyExisting, 1000);
                  setTimeout(() => {
                    clearInterval(existingInterval);
                    if (!isResolved) {
                      isResolved = true;
                      resolve(); // Assume complete after timeout
                    }
                  }, 60000);
                  return;
                }
              }
            }
            
            downloadStarted = true;
            console.log('[downloadBlob] Starting chrome.downloads.download, filename:', filename, 'useSaveAs:', useSaveAs);
            
            chrome.downloads.download({
              url: blobUrl,
              filename: filename,
              saveAs: useSaveAs
            }, (chromeDownloadId) => {
              if (chrome.runtime.lastError || chromeDownloadId === undefined) {
                console.error('[downloadBlob] chrome.downloads.download failed:', chrome.runtime.lastError?.message || 'Unknown error');
                downloadStarted = false;
                const errorMsg = chrome.runtime.lastError?.message || 'Download failed';
                if (useSaveAs && !hasRetried) {
                  console.log('[downloadBlob] Retrying without saveAs dialog');
                  hasRetried = true;
                  setTimeout(() => attemptDownload(false), 500);
                } else {
                  cleanupIndexedDBBlob(blobId);
                  reject(new Error(errorMsg));
                }
                return;
              }
              
              console.log('[downloadBlob] chrome.downloads.download succeeded, chromeDownloadId:', chromeDownloadId);
              
              currentChromeDownloadId = chromeDownloadId;
              
              const controllerInfo = downloadControllers.get(downloadId);
              if (controllerInfo) {
                controllerInfo.chromeDownloadId = chromeDownloadId;
              }
              
              activeChromeDownloads.set(chromeDownloadId, {
                downloadId: downloadId,
                blobUrl: blobUrl,
                blobId: blobId,
                filename: filename
              });
              
              // Monitor download progress
              let lastBytesReceived = 0;
              let noProgressCount = 0;
              let stuckTimeout = null;
              let verificationInterval = null;
              
              // If saveAs is true and download gets stuck, retry with saveAs: false
              if (useSaveAs) {
                stuckTimeout = setTimeout(() => {
                  if (!isResolved && !hasRetried) {
                    console.log('[downloadBlob] Download stuck with saveAs dialog, retrying with saveAs: false');
                    chrome.downloads.search({ id: chromeDownloadId }, (checkResults) => {
                      if (checkResults && checkResults.length > 0) {
                        const state = checkResults[0].state;
                        const bytesReceived = checkResults[0].bytesReceived || 0;
                        // Only retry if still in progress and hasn't progressed much
                        if (state === 'in_progress' && bytesReceived < 1024 * 1024) {
                          hasRetried = true;
                          downloadStarted = false;
                          if (verificationInterval) clearInterval(verificationInterval);
                          chrome.downloads.cancel(chromeDownloadId, () => {
                            chrome.downloads.removeFile(chromeDownloadId, () => {
                              activeChromeDownloads.delete(chromeDownloadId);
                              attemptDownload(false);
                            });
                          });
                        }
                      }
                    });
                  }
                }, 5000); // Wait 5 seconds for user to interact with dialog
              }
              
              // Immediately check download state (might complete instantly)
              chrome.downloads.search({ id: chromeDownloadId }, (immediateResults) => {
                if (immediateResults && immediateResults.length > 0) {
                  const immediateState = immediateResults[0].state;
                  console.log('[downloadBlob] Immediate download state check:', immediateState);
                  if (immediateState === 'complete') {
                    if (stuckTimeout) clearTimeout(stuckTimeout);
                    if (!isResolved) {
                      isResolved = true;
                      activeChromeDownloads.delete(chromeDownloadId);
                      cleanupIndexedDBBlob(blobId);
                      console.log('[downloadBlob] Download completed instantly, resolving');
                      resolve();
                      return;
                    }
                  } else if (immediateState === 'interrupted') {
                    if (stuckTimeout) clearTimeout(stuckTimeout);
                    if (!isResolved) {
                      isResolved = true;
                      activeChromeDownloads.delete(chromeDownloadId);
                      cleanupIndexedDBBlob(blobId);
                      console.error('[downloadBlob] Download interrupted instantly:', immediateResults[0].error);
                      reject(new Error(`Download interrupted: ${immediateResults[0].error || 'Unknown error'}`));
                      return;
                    }
                  } else if (immediateState === 'in_progress') {
                    // If download is progressing, clear the stuck timeout
                    const bytesReceived = immediateResults[0].bytesReceived || 0;
                    if (bytesReceived > 0) {
                      lastBytesReceived = bytesReceived;
                    }
                  }
                }
              });
              
              const verifyDownload = () => {
                if (isResolved) {
                  console.log('[downloadBlob] verifyDownload: already resolved, skipping');
                  return;
                }
                
                chrome.downloads.search({ id: chromeDownloadId }, (results) => {
                  if (!results || results.length === 0) {
                    console.log('[downloadBlob] verifyDownload: download not found');
                    if (verificationInterval) clearInterval(verificationInterval);
                    activeChromeDownloads.delete(chromeDownloadId);
                    cleanupIndexedDBBlob(blobId);
                    if (!isResolved) {
                      isResolved = true;
                      reject(new Error('Download not found'));
                    }
                    return;
                  }
                  
                  const download = results[0];
                  const currentBytes = download.bytesReceived || 0;
                  const isProgressing = currentBytes > lastBytesReceived;
                  
                  console.log('[downloadBlob] verifyDownload: state=', download.state, 'bytesReceived=', currentBytes, 'isProgressing=', isProgressing);
                  
                  if (download.state === 'interrupted') {
                    console.log('[downloadBlob] verifyDownload: download interrupted, error:', download.error);
                    if (stuckTimeout) clearTimeout(stuckTimeout);
                    if (verificationInterval) clearInterval(verificationInterval);
                    activeChromeDownloads.delete(chromeDownloadId);
                    if (useSaveAs && download.error !== 'USER_CANCELED' && !hasRetried) {
                      hasRetried = true;
                      downloadStarted = false;
                      chrome.downloads.removeFile(chromeDownloadId, () => attemptDownload(false));
                    } else {
                      cleanupIndexedDBBlob(blobId);
                      if (!isResolved) {
                        isResolved = true;
                        reject(new Error(`Download interrupted: ${download.error || 'Unknown error'}`));
                      }
                    }
                  } else if (download.state === 'complete') {
                    console.log('[downloadBlob] verifyDownload: download complete! Resolving promise');
                    if (stuckTimeout) clearTimeout(stuckTimeout);
                    if (verificationInterval) clearInterval(verificationInterval);
                    activeChromeDownloads.delete(chromeDownloadId);
                    cleanupIndexedDBBlob(blobId);
                    if (!isResolved) {
                      isResolved = true;
                      resolve();
                    }
                  } else if (download.state === 'in_progress') {
                    if (isProgressing) {
                      lastBytesReceived = currentBytes;
                      noProgressCount = 0;
                      // If download is progressing, clear stuck timeout
                      if (stuckTimeout && currentBytes > 1024 * 1024) {
                        clearTimeout(stuckTimeout);
                        stuckTimeout = null;
                      }
                    } else {
                      noProgressCount++;
                      // If saveAs was true and download is stuck, retry with saveAs: false
                      if (useSaveAs && !hasRetried && noProgressCount > 10) {
                        console.log('[downloadBlob] Download stuck with saveAs, retrying with saveAs: false');
                        hasRetried = true;
                        downloadStarted = false;
                        if (stuckTimeout) clearTimeout(stuckTimeout);
                        if (verificationInterval) clearInterval(verificationInterval);
                        chrome.downloads.cancel(chromeDownloadId, () => {
                          chrome.downloads.removeFile(chromeDownloadId, () => {
                            activeChromeDownloads.delete(chromeDownloadId);
                            attemptDownload(false);
                          });
                        });
                        return;
                      }
                      // Only check for stuck downloads, don't retry automatically
                      if (noProgressCount > 10) {
                        chrome.downloads.search({ id: chromeDownloadId }, (checkResults) => {
                          if (checkResults && checkResults.length > 0) {
                            const state = checkResults[0].state;
                            if (state === 'complete') {
                              if (verificationInterval) clearInterval(verificationInterval);
                              activeChromeDownloads.delete(chromeDownloadId);
                              cleanupIndexedDBBlob(blobId);
                              if (!isResolved) {
                                isResolved = true;
                                resolve();
                              }
                            } else if (state === 'in_progress' || state === 'interrupted') {
                              // Try to resume once, but don't create new download
                              chrome.downloads.resume(chromeDownloadId, (resumed) => {
                                if (chrome.runtime.lastError?.message?.includes('must be complete')) {
                                  if (verificationInterval) clearInterval(verificationInterval);
                                  activeChromeDownloads.delete(chromeDownloadId);
                                  cleanupIndexedDBBlob(blobId);
                                  if (!isResolved) {
                                    isResolved = true;
                                    resolve();
                                  }
                                } else if (resumed) {
                                  noProgressCount = 0;
                                }
                                // If resume failed, just continue monitoring - don't create new download
                              });
                            } else {
                              if (verificationInterval) clearInterval(verificationInterval);
                              activeChromeDownloads.delete(chromeDownloadId);
                              cleanupIndexedDBBlob(blobId);
                              if (!isResolved) {
                                isResolved = true;
                                resolve();
                              }
                            }
                          }
                        });
                        // Reset counter to avoid repeated checks
                        noProgressCount = 0;
                      }
                    }
                  }
                });
              };
              
              console.log('[downloadBlob] Starting verification loop for chromeDownloadId:', chromeDownloadId);
              verifyDownload();
              setTimeout(() => {
                console.log('[downloadBlob] Running delayed verifyDownload (2s)');
                verifyDownload();
              }, 2000);
              verificationInterval = setInterval(() => {
                verifyDownload();
              }, 500);
              console.log('[downloadBlob] Verification interval set, will run every 500ms');
              
              setTimeout(() => {
                if (verificationInterval) {
                  console.log('[downloadBlob] Clearing verification interval after 10 minutes');
                  clearInterval(verificationInterval);
                }
              }, 600000);
              
              const chromeDownloadInfo = activeChromeDownloads.get(chromeDownloadId);
              if (chromeDownloadInfo) {
                chromeDownloadInfo.verificationInterval = verificationInterval;
                console.log('[downloadBlob] Stored verificationInterval in activeChromeDownloads');
              } else {
                console.warn('[downloadBlob] Could not find chromeDownloadInfo to store verificationInterval');
              }
              
              setTimeout(() => {
                chrome.downloads.search({ id: chromeDownloadId }, (results) => {
                  if (!results || results.length === 0 || results[0].state === 'complete' || results[0].state === 'interrupted') {
                    cleanupIndexedDBBlob(blobId);
                  }
                });
              }, 600000);
            });
          });
        };
        
        attemptDownload(true);
      }
      
      sendMessage();
    });
  } catch (error) {
    // Fallback: data URL for small files only
    if (blobSize <= 50 * 1024 * 1024) {
      const dataUrl = await blobToDataUrl(blob);
      return new Promise((resolve, reject) => {
        chrome.downloads.download({
          url: dataUrl,
          filename: filename,
          saveAs: true
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
    } else {
      throw error;
    }
  }
}

/**
 * Download a full MP4 file (ensuring we get the complete file, not chunks)
 * Fetches the video URL, streams it into memory, creates a blob, and downloads it
 * @param {string} videoUrl - The video URL to download
 * @param {string} filename - The filename for the download
 * @param {string} downloadId - The download ID for tracking
 * @param {AbortController} abortController - Abort controller for cancellation
 * @param {Map} downloadControllers - Map of download controllers
 * @param {Map} activeChromeDownloads - Map of active Chrome downloads
 * @param {Function} cleanupIndexedDBBlob - Function to cleanup IndexedDB blobs
 * @param {Function} setupOffscreenDocument - Function to setup offscreen document
 * @param {Function} blobToDataUrl - Function to convert blob to data URL
 * @returns {Promise<void>}
 */
async function downloadFullVideoFile(
  videoUrl,
  filename,
  downloadId,
  abortController,
  downloadControllers,
  activeChromeDownloads,
  cleanupIndexedDBBlob,
  setupOffscreenDocument,
  blobToDataUrl,
) {
  try {
    await chrome.storage.local.set({
      [`downloadProgress_${downloadId}`]: 0,
      [`downloadStatus_${downloadId}`]: "Fetching video...",
    });

    // Check if cancelled before starting
    if (abortController.signal.aborted) {
      throw new DOMException("Download cancelled", "AbortError");
    }

    // Fetch the video without range headers to get the full file
    const response = await fetch(videoUrl, {
      method: "GET",
      signal: abortController.signal,
      // Don't send Range header - request the full file
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch video: ${response.statusText}`);
    }

    // Get content length for progress
    const contentLength = response.headers.get("content-length");
    const totalSize = contentLength ? parseInt(contentLength) : null;

    // Read the response as array buffer
    const reader = response.body.getReader();
    const chunks = [];
    let receivedLength = 0;

    while (true) {
      // Check if cancelled before reading next chunk
      if (abortController.signal.aborted) {
        reader.cancel();
        throw new DOMException("Download cancelled", "AbortError");
      }

      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      receivedLength += value.length;

      // Update progress if we know the total size
      if (totalSize) {
        const progress = Math.round((receivedLength / totalSize) * 100);
        await chrome.storage.local.set({
          [`downloadProgress_${downloadId}`]: progress,
          [`downloadStatus_${downloadId}`]: `Downloading ${Math.round(receivedLength / 1024 / 1024)}MB / ${Math.round(totalSize / 1024 / 1024)}MB`,
        });
      }
    }

    // Combine all chunks
    const allChunks = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      allChunks.set(chunk, position);
      position += chunk.length;
    }

    // Check if cancelled before creating blob
    if (abortController.signal.aborted) {
      throw new DOMException("Download cancelled", "AbortError");
    }

    // Create blob and download
    const blob = new Blob([allChunks], { type: "video/mp4" });
    // Set progress to 100% BEFORE downloadBlob so polling sees completion immediately
    await chrome.storage.local.set({
      [`downloadProgress_${downloadId}`]: 100,
      [`downloadStatus_${downloadId}`]: "Download complete!",
    });

    await downloadBlob(
      blob,
      filename || "dailymotion_video.mp4",
      downloadId,
      downloadControllers,
      activeChromeDownloads,
      cleanupIndexedDBBlob,
      setupOffscreenDocument,
      blobToDataUrl,
    );

    // Clean up ALL download-related storage keys after delay
    // Keep progress/status visible for 15s so polling can detect completion, then remove everything
    setTimeout(() => {
      chrome.storage.local.remove([
        `downloadProgress_${downloadId}`,
        `downloadStatus_${downloadId}`,
        `downloadInfo_${downloadId}`,
        `downloadCancelled_${downloadId}`,
        `blobReady_${downloadId}` // Also clean up blob ready flag if it exists
      ], () => {
        if (chrome.runtime.lastError) {
          console.error('Error cleaning up download storage:', chrome.runtime.lastError);
        } else {
          console.log('Cleaned up all download storage from downloadBlob:', downloadId);
        }
      });
    }, 15000);
  } catch (error) {
    // Check if error is due to cancellation
    if (error.name === "AbortError" || abortController.signal.aborted) {
      console.log("Full video download was cancelled:", downloadId);
      await chrome.storage.local.set({
        [`downloadProgress_${downloadId}`]: 0,
        [`downloadStatus_${downloadId}`]: "Download cancelled",
      });
      
      // Clean up ALL download-related storage keys after delay
      setTimeout(() => {
        chrome.storage.local.remove([
          `downloadProgress_${downloadId}`,
          `downloadStatus_${downloadId}`,
          `downloadInfo_${downloadId}`,
          `downloadCancelled_${downloadId}`,
          `blobReady_${downloadId}` // Also clean up blob ready flag if it exists
        ], () => {
          if (chrome.runtime.lastError) {
            console.error('Error cleaning up download storage:', chrome.runtime.lastError);
          } else {
            console.log('Cleaned up all download storage from downloadBlob (cancelled):', downloadId);
          }
        });
      }, 2000);
      
      throw new Error("Download cancelled by user");
    }
    
    // Create user-friendly error message
    let errorMessage = 'Download failed';
    if (error.message) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        errorMessage = 'Network error: Failed to download video. Please check your internet connection and try again.';
      } else {
        errorMessage = `Download failed: ${error.message}`;
      }
    }
    
    console.error("Full video download error:", error);
    
    // Update status with error message
    await chrome.storage.local.set({
      [`downloadProgress_${downloadId}`]: 0,
      [`downloadStatus_${downloadId}`]: errorMessage
    });
    
    // Clean up ALL download-related storage keys after delay
    // Keep error status visible for 10 seconds before clearing everything
    setTimeout(() => {
      chrome.storage.local.remove([
        `downloadProgress_${downloadId}`,
        `downloadStatus_${downloadId}`,
        `downloadInfo_${downloadId}`,
        `downloadCancelled_${downloadId}`,
        `blobReady_${downloadId}` // Also clean up blob ready flag if it exists
      ], () => {
        if (chrome.runtime.lastError) {
          console.error('Error cleaning up download storage:', chrome.runtime.lastError);
        } else {
          console.log('Cleaned up all download storage from downloadBlob (error):', downloadId);
        }
      });
    }, 10000);
    
    throw new Error(errorMessage);
  }
}

/**
 * Simple direct download using Chrome downloads API
 * @param {string} url - The URL to download
 * @param {string} filename - The filename for the download
 */
function downloadVideo(url, filename) {
  chrome.downloads.download({
    url: url,
    filename: filename || "dailymotion_video.mp4",
    saveAs: true,
  });
}

/**
 * Check if object URL creation is supported
 * @returns {boolean}
 */
function supportsObjectUrl() {
  return (
    typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
  );
}

/**
 * Helper function to clean up IndexedDB blob
 * @param {string} blobId - The blob ID to cleanup
 */
function cleanupIndexedDBBlob(blobId) {
  try {
    const request = indexedDB.open("DailymotionDownloaderDB", 1);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["blobs"], "readwrite");
      tx.objectStore("blobs").delete(blobId);
      tx.oncomplete = () => {
        db.close();
        console.log("Cleaned up IndexedDB blob:", blobId);
      };
      tx.onerror = () => {
        console.error("Failed to clean up IndexedDB blob:", tx.error);
        db.close();
      };
    };
    request.onerror = () => {
      console.error("Failed to open IndexedDB for cleanup:", request.error);
    };
  } catch (error) {
    console.error("Error cleaning up IndexedDB:", error);
  }
}

/**
 * Convert blob to data URL
 * @param {Blob} blob - The blob to convert
 * @returns {Promise<string>} Data URL string
 */
async function blobToDataUrl(blob) {
  // Try FileReader first (faster, but may not be available in service workers)
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(reader.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Fallback: manual conversion (only for very small files)
  // This is slow but works in all contexts
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // Process in chunks to avoid blocking
  const chunkSize = 8192; // 8KB chunks
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, Math.min(i + chunkSize, bytes.length));
    // Convert chunk to string
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }

    // Yield to event loop every 10 chunks to prevent freezing
    if (i % (chunkSize * 10) === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const base64 = btoa(binary);
  return `data:${blob.type || "application/octet-stream"};base64,${base64}`;
}

/**
 * Create or get offscreen document
 * Offscreen document is needed for IndexedDB access and URL.createObjectURL
 * @returns {Promise<void>}
 */
async function setupOffscreenDocument() {
  try {
    const offscreenPath = "background/offscreen.html";
    const offscreenUrl = chrome.runtime.getURL(offscreenPath);

    // Check if offscreen document already exists
    // Use chrome.runtime.getContexts() if available (Chrome 116+), otherwise fall back to clients.matchAll()
    let offscreenExists = false;

    if (chrome.runtime.getContexts) {
      try {
        const contexts = await chrome.runtime.getContexts({
          contextTypes: ["OFFSCREEN_DOCUMENT"],
          documentUrls: [offscreenUrl],
        });
        offscreenExists = contexts.length > 0;
        if (offscreenExists) {
          console.log(
            "Offscreen document already exists (checked via getContexts)",
          );
          return;
        }
      } catch (getContextsError) {
        console.log(
          "getContexts API error, falling back to clients.matchAll():",
          getContextsError,
        );
      }
    }

    // Fallback: use clients API (for Chrome < 116)
    if (!offscreenExists) {
      try {
        const allClients = await self.clients.matchAll({
          includeUncontrolled: true,
        });
        for (const client of allClients) {
          if (
            client.url &&
            (client.url.includes("offscreen.html") ||
              client.url === offscreenUrl)
          ) {
            console.log(
              "Offscreen document already exists (checked via clients.matchAll)",
            );
            return;
          }
        }
      } catch (clientsError) {
        // clients API might not be available, continue to create
        console.log(
          "Could not check existing clients, proceeding to create offscreen document",
        );
      }
    }

    // Create offscreen document
    // Note: URL is relative to extension root
    console.log("Creating offscreen document at:", offscreenPath);
    await chrome.offscreen.createDocument({
      url: offscreenPath,
      reasons: ["BLOBS"], // Using BLOBS since we're using URL.createObjectURL
      justification:
        "Need to access IndexedDB and create blob URLs for downloads",
    });
    console.log("Offscreen document created successfully");

    // Wait for script to load and message listener to be set up
    // chrome.offscreen.createDocument resolves when HTML loads, but script execution is async
    // Give it time to load, execute, and set up the message listener
    await new Promise((resolve) => setTimeout(resolve, 800));
  } catch (error) {
    console.error("Failed to create offscreen document:", error);
    throw error;
  }
}
