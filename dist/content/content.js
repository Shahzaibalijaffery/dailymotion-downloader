// Content script orchestrator for Dailymotion pages
// Modules are loaded via manifest.json before this script
// This file coordinates initialization and message routing

const DEBUG = false; // Enable for debugging notifications
const originalConsoleLog = console.log;
// Always log restore-related messages for debugging
const originalConsoleError = console.error;
// Global debug state (inspect via window.__dmDownloaderDebug)
const __dmDebugState = {
  loadedAt: Date.now(),
  lastRestore: null,
  lastRestoreError: null,
  lastStorageSnapshot: null,
  lastShowNotification: null,
  lastShowNotificationError: null,
};

console.log = (...args) => { 
  // Always log restore and download notification messages
  const message = args[0]?.toString() || '';
  if (message.includes('restore') || message.includes('Restoring') || message.includes('download notification') || message.includes('✅') || message.includes('❌') || message.includes('⚠️')) {
    originalConsoleLog(...args);
  } else if (DEBUG) {
    originalConsoleLog(...args);
  }
};
console.error = (...args) => {
  originalConsoleError(...args);
};

// Always log content script load (top frame only)
try {
  if (window.self === window.top) {
    originalConsoleLog('[DM Downloader] content script loaded', {
      href: window.location.href,
      readyState: document.readyState,
      ts: new Date().toISOString(),
    });
  }
  } catch (e) {
  // ignore
}

// Catch unexpected errors (top frame only)
try {
  if (window.self === window.top) {
    window.addEventListener('error', (ev) => {
      __dmDebugState.lastRestoreError = __dmDebugState.lastRestoreError || (ev?.error?.message || ev?.message || 'unknown error');
      originalConsoleError('[DM Downloader] window.error', ev?.message || ev, ev?.error);
    });
    window.addEventListener('unhandledrejection', (ev) => {
      __dmDebugState.lastRestoreError = __dmDebugState.lastRestoreError || (ev?.reason?.message || String(ev?.reason) || 'unhandled rejection');
      originalConsoleError('[DM Downloader] unhandledrejection', ev?.reason);
            });
          }
        } catch (e) {
  // ignore
}

// Expose debug helpers for you to run in DevTools console
try {
  if (window.self === window.top) {
    window.__dmDownloaderDebug = {
      state: __dmDebugState,
      forceRestore: () => {
        originalConsoleLog('[DM Downloader] forceRestore() called');
        try {
          if (typeof restoreActiveDownloads === 'function') {
            restoreActiveDownloads();
    }
  } catch (e) {
          __dmDebugState.lastRestoreError = e?.message || String(e);
          originalConsoleError('[DM Downloader] forceRestore error', e);
        }
      },
      dumpStorageKeys: () =>
        new Promise((resolve) => {
          safeStorageGet(null, (items) => {
            const keys = Object.keys(items || {}).filter((k) => k.startsWith('download'));
            const summary = keys
              .sort()
              .map((k) => ({ key: k, value: items[k] }));
            __dmDebugState.lastStorageSnapshot = summary;
            originalConsoleLog('[DM Downloader] storage snapshot (download* keys):', summary);
            resolve(summary);
          });
        }),
      testNotification: () => {
        originalConsoleLog('[DM Downloader] testNotification()');
        try {
          if (typeof showDownloadNotification === 'function') {
            showDownloadNotification('TEST_' + Date.now(), 'test.mp4', 'Test notification', 42, '', __dmDebugState);
          }
  } catch (e) {
          __dmDebugState.lastShowNotificationError = e?.message || String(e);
          originalConsoleError('[DM Downloader] testNotification error', e);
        }
      },
      pingBackground: () =>
        new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage({ action: 'ping' }, (resp) => {
              const err = chrome.runtime.lastError?.message;
              originalConsoleLog('[DM Downloader] pingBackground result:', { resp, err });
              resolve({ resp, err });
            });
  } catch (e) {
            originalConsoleError('[DM Downloader] pingBackground exception', e);
            resolve({ resp: null, err: e?.message || String(e) });
          }
        }),
    };
    originalConsoleLog('[DM Downloader] Debug helpers ready: window.__dmDownloaderDebug');
  }
  } catch (e) {
  // ignore
}

// Initialize modules
function initializeModules() {
  // Only initialize in top frame
  if (window.self !== window.top) return;
  
  // Initialize video extraction (handles network interception and DOM monitoring)
  if (typeof initializeVideoExtraction === 'function') {
    initializeVideoExtraction();
  }
  
  // Initialize page tracking (handles URL monitoring and button verification)
  if (typeof initializePageTracking === 'function') {
    initializePageTracking();
  }
  
  // Schedule restore active downloads
  if (typeof scheduleRestoreActiveDownloads === 'function') {
    scheduleRestoreActiveDownloads();
  }
  
  // Inject download button only after React hydration (avoids React #418/#423)
  // Dailymotion is an SPA; injecting too early causes hydration mismatch and broken UI.
  const INJECT_DELAY_MS = 4500;
  if (isVideoPage() && typeof injectDownloadButton === 'function') {
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
        if (isExtensionContextValid()) {
      setTimeout(() => {
            if (typeof injectDownloadButton === 'function') injectDownloadButton();
          }, INJECT_DELAY_MS);
        }
      });
        } else {
      if (isExtensionContextValid()) {
          setTimeout(() => {
          if (typeof injectDownloadButton === 'function') injectDownloadButton();
        }, INJECT_DELAY_MS);
      }
    }
  }
}

// Initialize when DOM is ready
  if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeModules);
  } else {
  initializeModules();
}

// Listen for messages from background script to handle blob downloads and download notifications
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request.action, request);
  
  // Popup asks the page to (re)run extraction. This is critical for:
  // - slow internet (URLs appear late)
  // - lazy-loaded player/config
  // - SPA navigation where the content script is already injected
  if (request.action === 'triggerVideoExtraction') {
    try {
      // Prefer throttled scheduler if available
      if (typeof scheduleExtract === 'function') {
        scheduleExtract(request.reason || 'popup');
      } else if (typeof extractVideoConfig === 'function') {
        extractVideoConfig(request.reason || 'popup');
      }
      sendResponse({ success: true });
  } catch (e) {
      console.error('triggerVideoExtraction failed:', e);
      sendResponse({ success: false, error: e?.message || String(e) });
    }
    return true;
  }
  
  // Handle download start notification
  if (request.action === 'downloadStarted') {
    console.log('Download started notification received:', request.downloadId, request.filename, 'isExisting:', request.isExisting);
    const downloadId = request.downloadId || `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const filename = request.filename || 'video.mp4';
    const qualityLabel = request.qualityLabel || '';
    
    try {
      console.log('Attempting to show notification for:', downloadId, filename, 'quality:', qualityLabel);
      console.log('Document body exists:', !!document.body);
      console.log('Document ready state:', document.readyState);
      
      // If this is an existing download, check current status first
      if (request.isExisting) {
        safeStorageGet([`downloadProgress_${downloadId}`, `downloadStatus_${downloadId}`], (result) => {
          const progress = result[`downloadProgress_${downloadId}`];
          const status = result[`downloadStatus_${downloadId}`] || 'Downloading...';
          
          if (progress !== undefined) {
            if (typeof showDownloadNotification === 'function') {
              showDownloadNotification(downloadId, filename, status, progress, qualityLabel, __dmDebugState);
            }
            if (typeof startDownloadProgressPolling === 'function') {
            startDownloadProgressPolling(downloadId, filename);
            }
          } else {
            // No progress data yet, show initial notification
            if (typeof showDownloadNotification === 'function') {
              showDownloadNotification(downloadId, filename, 'Preparing download...', 0, qualityLabel, __dmDebugState);
            }
            if (typeof startDownloadProgressPolling === 'function') {
            startDownloadProgressPolling(downloadId, filename);
            }
          }
        });
      } else {
        // New download
        // Ensure body is ready
        if (!document.body) {
          console.log('Waiting for document.body...');
          setTimeout(() => {
            console.log('Retrying notification after body ready');
            if (typeof showDownloadNotification === 'function') {
              showDownloadNotification(downloadId, filename, 'Preparing download...', 0, qualityLabel, __dmDebugState);
            }
            if (typeof startDownloadProgressPolling === 'function') {
            startDownloadProgressPolling(downloadId, filename);
            }
          }, 100);
        } else {
          console.log('Body ready, showing notification immediately');
          if (typeof showDownloadNotification === 'function') {
            showDownloadNotification(downloadId, filename, 'Preparing download...', 0, qualityLabel, __dmDebugState);
          }
          if (typeof startDownloadProgressPolling === 'function') {
          startDownloadProgressPolling(downloadId, filename);
          }
        }
      }
      
      sendResponse({ success: true });
    } catch (error) {
      console.error('Error showing download notification:', error);
      console.error('Error stack:', error.stack);
      sendResponse({ success: false, error: error.message });
    }
    return true; // Keep channel open for async response
  }
  
  // Handle download completion notification
  if (request.action === 'downloadCompleted') {
    console.log('Download completed notification received:', request.downloadId, request.filename);
    const downloadId = request.downloadId;
    const filename = request.filename || 'video.mp4';
    
    // Stop polling for this download
    if (typeof stopDownloadProgressPolling === 'function') {
      stopDownloadProgressPolling(downloadId);
    }
    
    // Update notification to show completion
    if (typeof updateDownloadNotification === 'function') {
    updateDownloadNotification(downloadId, filename, 'Download complete!', 100);
    }
    
    // Hide after delay
    setTimeout(() => {
      if (typeof hideDownloadNotification === 'function') {
      hideDownloadNotification(downloadId);
      }
    }, 3000);
    
    sendResponse({ success: true });
    return true;
  }
  
  // Handle download blocked notification (max 2 downloads or large file >500 segments)
  if (request.action === 'showDownloadBlockedNotification') {
    const message = request.message || 'Please wait for the current download(s) to complete.';
    const reason = request.reason || 'maxConcurrent';
    if (typeof showDownloadBlockedToast === 'function') {
      showDownloadBlockedToast(message, reason);
    }
    sendResponse({ success: true });
    return true;
  }

  // Handle download cancellation notification
  if (request.action === 'downloadCancelled') {
    console.log('Download cancelled notification received:', request.downloadId);
    const downloadId = request.downloadId;
    
    // Stop polling immediately
    if (typeof stopDownloadProgressPolling === 'function') {
      stopDownloadProgressPolling(downloadId);
    }
    
    // Hide notification immediately
    if (typeof hideDownloadNotification === 'function') {
      hideDownloadNotification(downloadId);
    }
    
    sendResponse({ success: true });
    return true;
  }
  
  if (request.action === 'downloadBlobFromIndexedDB') {
    // Retrieve blob from IndexedDB and create blob URL
    (async () => {
      try {
        const blobId = request.blobId;
        const filename = request.filename;
        const mimeType = request.mimeType || 'video/mp4';
        const expectedSize = request.expectedSize;
        
        console.log(`Retrieving blob from IndexedDB with ID: ${blobId}...`);
        
        // First, check if blob is ready signal exists in chrome.storage.local
        const blobReady = await new Promise((resolve) => {
          chrome.storage.local.get([`blobReady_${blobId}`], (result) => {
            resolve(result[`blobReady_${blobId}`] === true);
          });
        });
        
        if (!blobReady) {
          console.log('Blob not ready yet, waiting for signal...');
          // Wait for blob ready signal (polling)
          let signalRetries = 20;
          let signalWaitTime = 500;
          while (!blobReady && signalRetries > 0) {
            await new Promise(resolve => setTimeout(resolve, signalWaitTime));
            const checkReady = await new Promise((resolve) => {
              safeStorageGet([`blobReady_${blobId}`], (result) => {
                resolve(result[`blobReady_${blobId}`] === true);
              });
            });
            if (checkReady) break;
            signalRetries--;
            signalWaitTime = Math.min(signalWaitTime * 1.2, 2000);
          }
        }
        
          // Retry mechanism in case of timing issues
          // IndexedDB isolation between service worker and content script requires longer waits
          // But we reduce retries since offscreen document is now primary method
          let arrayBuffer = null;
          let retries = 3; // Reduced retries since this is now fallback only
          let waitTime = 1000; // Reduced initial wait time
        
        while (!arrayBuffer && retries > 0) {
          try {
            // Check if extension context is still valid
            if (!chrome.runtime || !chrome.runtime.id) {
              throw new Error('Extension context invalidated');
            }
            
            // Open IndexedDB
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
            
            // Retrieve ArrayBuffer
            const transaction = db.transaction(['blobs'], 'readonly');
            const store = transaction.objectStore('blobs');
            
            const result = await new Promise((resolve, reject) => {
              const request = store.get(blobId);
              request.onsuccess = () => {
                const data = request.result;
                if (!data) {
                  const attemptNum = 4 - retries;
                  console.warn(`Blob not found (attempt ${attemptNum}/3), waiting ${waitTime}ms before retry...`);
                  resolve(null);
                } else {
                  console.log(`Blob found! Size: ${data.byteLength} bytes`);
                  resolve(data);
                }
              };
              request.onerror = () => {
                console.error('IndexedDB read error:', request.error);
                reject(request.error || new Error('IndexedDB read error'));
              };
            });
            
            db.close();
            
            if (result && result instanceof ArrayBuffer) {
              arrayBuffer = result;
              break;
            }
            
            retries--;
            if (retries > 0) {
              console.log(`Waiting ${waitTime}ms before retry...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              // Increase wait time for subsequent retries (exponential backoff)
              waitTime = Math.min(waitTime * 1.5, 5000);
            }
          } catch (dbError) {
            // Handle IndexedDB errors or extension context invalidation
            if (dbError.message && dbError.message.includes('Extension context invalidated')) {
              console.error('Extension context invalidated, cannot retrieve blob:', dbError);
              sendResponse({ success: false, error: 'Extension context invalidated. Please reload the extension and try again.' });
              return;
            }
            
            console.error('IndexedDB operation error:', dbError);
            retries--;
            if (retries > 0) {
              await new Promise(resolve => setTimeout(resolve, waitTime));
              waitTime = Math.min(waitTime * 1.5, 5000);
            } else {
              throw dbError;
            }
          }
        }
        
        if (!arrayBuffer || !(arrayBuffer instanceof ArrayBuffer)) {
          throw new Error(`Failed to retrieve blob from IndexedDB after 3 attempts. Blob ID: ${blobId}. This might be due to IndexedDB isolation between service worker and content script. Try using the offscreen document method (primary).`);
        }
        
        const actualSize = arrayBuffer.byteLength;
        const sizeMB = Math.round(actualSize / 1024 / 1024);
        console.log(`Retrieved ${sizeMB}MB blob (${actualSize} bytes) from IndexedDB`);
        
        if (expectedSize && actualSize !== expectedSize) {
          console.warn(`Size mismatch: expected ${expectedSize}, got ${actualSize}`);
        }
        
        // Create blob and blob URL
        const blob = new Blob([arrayBuffer], { type: mimeType });
        
        // Verify blob size
        if (blob.size !== actualSize) {
          console.error(`Blob size mismatch: blob=${blob.size}, arrayBuffer=${actualSize}`);
        }
        
        console.log(`Created blob (${blob.size} bytes), creating blob URL...`);
        const blobUrl = URL.createObjectURL(blob);
        
        console.log(`Blob URL created: ${blobUrl.substring(0, 50)}..., starting download...`);
        
        // Download directly from content script (has access to chrome.downloads)
        // Try with saveAs first, fallback to without saveAs if it fails
        const attemptDownload = (useSaveAs) => {
          chrome.downloads.download({
            url: blobUrl,
            filename: filename,
            saveAs: useSaveAs
          }, (downloadId) => {
            if (chrome.runtime.lastError) {
              const error = chrome.runtime.lastError.message;
              console.error(`Download failed (saveAs: ${useSaveAs}):`, error);
              
              // If saveAs failed, try without saveAs
              if (useSaveAs) {
                console.log('Retrying download without saveAs (direct to Downloads folder)...');
                setTimeout(() => attemptDownload(false), 500);
              } else {
                // Both attempts failed
                URL.revokeObjectURL(blobUrl);
                sendResponse({ success: false, error: error });
              }
            } else if (!downloadId) {
              console.error('Download returned no ID');
              if (useSaveAs) {
                console.log('Retrying download without saveAs...');
                setTimeout(() => attemptDownload(false), 500);
              } else {
                URL.revokeObjectURL(blobUrl);
                sendResponse({ success: false, error: 'No download ID returned' });
              }
            } else {
              console.log(`Download started successfully with ID: ${downloadId} (saveAs: ${useSaveAs})`);
              
              // Verify download actually started by checking its state after a moment
              setTimeout(() => {
                chrome.downloads.search({ id: downloadId }, (results) => {
                  if (results && results.length > 0) {
                    const download = results[0];
                    console.log('Download state check:', download.state, 'Progress:', download.bytesReceived, '/', download.totalBytes);
                    
                    if (download.state === 'interrupted') {
                      console.error('Download was interrupted:', download.error);
                      // If interrupted and we used saveAs, retry without saveAs
                      if (useSaveAs && download.error !== 'USER_CANCELED') {
                        console.log('Download interrupted, retrying without saveAs...');
                        chrome.downloads.removeFile(downloadId, () => {
                          attemptDownload(false);
                        });
                        return;
                      }
                    }
                  }
                });
              }, 2000);
              
              // Revoke blob URL after a delay to ensure download completes
              // Chrome will keep the blob URL alive as long as the download is active
              setTimeout(() => {
                URL.revokeObjectURL(blobUrl);
                console.log('Blob URL revoked');
              }, 300000); // 5 minutes for large files
              
              sendResponse({ success: true });
            }
          });
        };
        
        // Start with saveAs: true, will fallback to false if needed
        attemptDownload(true);
      } catch (error) {
        console.error('Failed to download blob from IndexedDB:', error);
        sendResponse({ success: false, error: error.message });
        
      }
    })();
    
    return true; // Keep channel open for async response
  }
  return false;
});
