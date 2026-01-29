/**
 * Download cancellation functionality
 * Handles cancellation of active downloads, cleanup of resources, and notification
 */

/**
 * Cancel an active download (cleanup only - cancellation flag and abort are set in handler)
 * @param {string} downloadId - The download ID to cancel
 * @param {Map} downloadControllers - Map of download controllers
 * @param {Map} activeChromeDownloads - Map of active Chrome downloads
 * @param {Map} activeDownloads - Map of active downloads by URL
 * @param {Map} downloadInfo - Map of download info
 * @param {Function} cleanupIndexedDBBlob - Function to cleanup IndexedDB blobs
 * @returns {Promise<void>}
 */
async function cancelDownload(downloadId, downloadControllers, activeChromeDownloads, activeDownloads, downloadInfo, cleanupIndexedDBBlob) {
  try {
    // Get controller info before cleanup
    const controllerInfo = downloadControllers.get(downloadId);
    
    // Cancel Chrome download if active in controller
    if (controllerInfo?.chromeDownloadId) {
      chrome.downloads.cancel(controllerInfo.chromeDownloadId, () => {});
    }
    
    // Remove from tracking maps
    downloadControllers.delete(downloadId);
    
    // Cancel any active Chrome downloads for this downloadId
    for (const [chromeDownloadId, chromeDownloadInfo] of activeChromeDownloads.entries()) {
      if (chromeDownloadInfo.downloadId === downloadId) {
        chrome.downloads.cancel(chromeDownloadId, () => {});
        if (chromeDownloadInfo.blobId) {
          cleanupIndexedDBBlob(chromeDownloadInfo.blobId);
        }
        activeChromeDownloads.delete(chromeDownloadId);
      }
    }
    
    // Remove from activeDownloads
    for (const [url, id] of activeDownloads.entries()) {
      if (id === downloadId) {
        activeDownloads.delete(url);
        break;
      }
    }
    
    // Get tabId for notification before removing downloadInfo
    const info = downloadInfo.get(downloadId);
    const tabId = info?.tabId;
    downloadInfo.delete(downloadId);
    
    // Remove progress and downloadInfo immediately
    // Keep cancellation flag and status temporarily so download process can detect cancellation
    await chrome.storage.local.remove([
      `downloadProgress_${downloadId}`,
      `downloadInfo_${downloadId}`
    ]);
    
    // Clean up ALL download-related storage keys after delay
    // Keep cancellation flag/status for 2 seconds so download process can detect it, then remove everything
    setTimeout(() => {
      chrome.storage.local.remove([
        `downloadStatus_${downloadId}`,
        `downloadCancelled_${downloadId}`,
        `blobReady_${downloadId}` // Also clean up blob ready flag if it exists
      ], () => {
        if (chrome.runtime.lastError) {
          console.error('Error cleaning up cancelled download storage:', chrome.runtime.lastError);
        } else {
          console.log('Cleaned up all cancelled download storage:', downloadId);
        }
      });
    }, 2000);
    
    // Notify content script
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        action: 'downloadCancelled',
        downloadId: downloadId
      }, () => {});
    } else {
      chrome.tabs.query({ url: '*://*.dailymotion.com/*' }, (tabs) => {
        if (tabs && tabs.length > 0) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'downloadCancelled',
            downloadId: downloadId
          }, () => {});
        }
      });
    }
  } catch (error) {
    console.error('Error in cancelDownload:', error);
    throw error;
  }
}

/**
 * Helper function to check if download is cancelled
 * @param {string} downloadId - The download ID to check
 * @returns {Promise<boolean>}
 */
async function isDownloadCancelled(downloadId) {
  return new Promise((resolve) => {
    chrome.storage.local.get([`downloadCancelled_${downloadId}`], (items) => {
      resolve(!!items[`downloadCancelled_${downloadId}`]);
    });
  });
}
