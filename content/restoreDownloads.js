/**
 * Download restoration module
 * Handles restoring active downloads when page loads or video changes
 */

// Restore active downloads when page loads
function restoreActiveDownloads() {
  // Only restore in top frame
  if (window.self !== window.top) return;
  
  // Check if extension context is valid
  if (!isExtensionContextValid()) {
    return;
  }
  
  // Get current video ID (using utility function)
  const currentVideoId = extractVideoId(window.location.href);
  const currentUrl = window.location.href;
  
  // Always log restore attempts
  if (window.__dmDownloaderDebug && window.__dmDownloaderDebug.state) {
    window.__dmDownloaderDebug.state.lastRestore = {
      currentVideoId,
      currentUrl,
      isVideoPage: (() => {
        try {
          return isVideoPage();
        } catch (e) {
          return 'error';
        }
      })(),
      readyState: document.readyState,
      timestamp: new Date().toISOString(),
    };
  }
  
  console.log('🔄 restoreActiveDownloads called:', {
    currentVideoId,
    currentUrl: currentUrl.substring(0, 80),
    isVideoPage: isVideoPage(),
    readyState: document.readyState,
    timestamp: new Date().toISOString()
  });
  
  // Check for active downloads in storage
  safeStorageGet(null, (items) => {
    // Check again if context is still valid after async operation
    if (!isExtensionContextValid()) {
      console.log('Extension context invalidated, skipping restore');
      return;
    }
    
    // Snapshot storage (only download-related keys) for debugging
    try {
      if (window.__dmDownloaderDebug && window.__dmDownloaderDebug.state) {
        window.__dmDownloaderDebug.state.lastStorageSnapshot = Object.keys(items || {})
          .filter((k) => k.startsWith('download'))
          .sort()
          .map((k) => ({ key: k, value: items[k] }));
      }
    } catch (e) {
      // ignore
    }

    // Find all download progress keys
    const downloadKeys = Object.keys(items).filter(key => key.startsWith('downloadProgress_'));
    
    if (downloadKeys.length === 0) {
      console.log('ℹ️ No active downloads found in storage');
      return; // No active downloads
    }
    
    console.log(`📥 Found ${downloadKeys.length} potential downloads to restore`, {
      downloadIds: downloadKeys.map(k => k.replace('downloadProgress_', '')),
      currentVideoId,
      progressValues: downloadKeys.map(k => ({ id: k.replace('downloadProgress_', ''), progress: items[k] }))
    });
    
    downloadKeys.forEach(key => {
      const downloadId = key.replace('downloadProgress_', '');
      const progress = items[key];
      const status = items[`downloadStatus_${downloadId}`];
      const isCancelled = items[`downloadCancelled_${downloadId}`];
      
      // Don't restore if cancelled
      if (isCancelled) {
        console.log('Skipping cancelled download:', downloadId);
        return;
      }
      
      // Only restore if download is in progress (not complete or failed)
      // Allow restoring even if status is missing (might be initializing)
      const isInProgress = progress !== undefined && progress < 100 && 
          (!status || (
            !status.toLowerCase().includes('complete') && 
            !status.toLowerCase().includes('failed') && 
            !status.toLowerCase().includes('error') &&
            !status.toLowerCase().includes('cancelled')
          ));
      
      if (isInProgress) {
        
        // Get filename from background script to verify download still exists
        // Also check storage directly in case background script hasn't restored info yet
        const storedInfoKey = `downloadInfo_${downloadId}`;
        const storedInfo = items[storedInfoKey];
        
        // Try to restore immediately from storage if available (faster)
        if (storedInfo) {
          try {
            const info = JSON.parse(storedInfo);
            console.log('📦 Found download info in storage, attempting immediate restore:', downloadId);
            
            // Restore ALL active downloads regardless of videoId
            // Users should see all their active downloads even when navigating between videos
            console.log('✅ Restoring download notification immediately from storage:', downloadId, {
              videoId: info.videoId,
              currentVideoId,
              note: info.videoId !== currentVideoId ? '(different video, but showing anyway)' : '(same video)'
            });
            try {
              if (typeof showDownloadNotification === 'function') {
                showDownloadNotification(downloadId, info.filename || 'video.mp4', status || 'Downloading...', progress, info.qualityLabel || '');
              }
              if (typeof startDownloadProgressPolling === 'function') {
                startDownloadProgressPolling(downloadId, info.filename || 'video.mp4');
              }
              console.log('✅ Successfully restored immediately:', downloadId);
              return; // Don't wait for background script response
            } catch (error) {
              console.error('❌ Error in immediate restore, will try background script:', downloadId, error);
              // Fall through to background script check
            }
          } catch (e) {
            console.error('⚠️ Failed to parse stored info, will try background script:', downloadId, e);
            // Fall through to background script check
          }
        }
        
        // Also check with background script (in case storage is stale)
        safeSendMessage({
          action: 'getDownloadInfo',
          downloadId: downloadId
        }, (response) => {
          // Check again if context is still valid
          if (!isExtensionContextValid()) {
            return;
          }
          
          if (response && response.info) {
            const info = response.info;
            
            // Restore ALL active downloads regardless of videoId
            // Users should see all their active downloads even when navigating between videos
            console.log('✅ Restoring download notification:', downloadId, {
              progress,
              status,
              videoId: info.videoId,
              currentVideoId,
              filename: info.filename,
              note: info.videoId !== currentVideoId ? '(different video, but showing anyway)' : '(same video)'
            });
            try {
              if (typeof showDownloadNotification === 'function') {
                showDownloadNotification(downloadId, info.filename || 'video.mp4', status || 'Downloading...', progress, info.qualityLabel || '');
              }
              if (typeof startDownloadProgressPolling === 'function') {
                startDownloadProgressPolling(downloadId, info.filename || 'video.mp4');
              }
              console.log('✅ Successfully restored download notification and started polling:', downloadId);
            } catch (error) {
              console.error('❌ Error restoring download notification:', downloadId, error);
            }
          } else {
            // Download info not found in background - try to get it from storage directly
            // This can happen if background script hasn't restored it yet
            const storedInfoKey = `downloadInfo_${downloadId}`;
            const storedInfo = items[storedInfoKey];
            
            if (storedInfo) {
              try {
                const info = JSON.parse(storedInfo);
                console.log('Found download info in storage (background script not returned yet):', downloadId, info);
                
                // Restore ALL active downloads regardless of videoId
                console.log('✅ Restoring download notification from storage:', downloadId, {
                  progress,
                  status,
                  videoId: info.videoId,
                  currentVideoId,
                  filename: info.filename,
                  note: info.videoId !== currentVideoId ? '(different video, but showing anyway)' : '(same video)'
                });
                try {
                  if (typeof showDownloadNotification === 'function') {
                    showDownloadNotification(downloadId, info.filename || 'video.mp4', status || 'Downloading...', progress, info.qualityLabel || '');
                  }
                  if (typeof startDownloadProgressPolling === 'function') {
                    startDownloadProgressPolling(downloadId, info.filename || 'video.mp4');
                  }
                  console.log('✅ Successfully restored download notification from storage:', downloadId);
                } catch (error) {
                  console.error('❌ Error restoring download notification from storage:', downloadId, error);
                }
                return;
              } catch (e) {
                console.warn('Failed to parse stored download info:', e);
              }
            }
            
            // If no info found anywhere, restore anyway if progress indicates it's active
            // Check if this might be a stale download entry - if status indicates completion, don't restore
            if (status && (status.toLowerCase().includes('complete') || status.toLowerCase().includes('finished'))) {
              console.log('Skipping completed download:', downloadId);
              return;
            }
            
            // Last resort: restore with minimal info if progress indicates it's active
            // Restore regardless of whether we're on a video page or not
            console.log('⚠️ Restoring download notification with minimal info (no downloadInfo found):', downloadId, 'Progress:', progress, 'Status:', status, 'CurrentVideoId:', currentVideoId);
            try {
              if (typeof showDownloadNotification === 'function') {
                showDownloadNotification(downloadId, 'video.mp4', status || 'Downloading...', progress, '');
              }
              if (typeof startDownloadProgressPolling === 'function') {
                startDownloadProgressPolling(downloadId, 'video.mp4');
              }
              console.log('✅ Successfully restored download notification with minimal info:', downloadId);
            } catch (error) {
              console.error('❌ Error restoring download notification with minimal info:', downloadId, error);
            }
          }
        });
      }
    });
  });
}

// Restore active downloads when page loads
// Wait a bit longer to ensure background script is ready
function scheduleRestoreActiveDownloads() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Wait 2 seconds to ensure background script and storage are ready
      setTimeout(() => {
        if (isExtensionContextValid()) {
          restoreActiveDownloads();
        }
      }, 2000);
    });
  } else {
    // Wait 2 seconds to ensure background script and storage are ready
    setTimeout(() => {
      if (isExtensionContextValid()) {
        restoreActiveDownloads();
      }
    }, 2000);
  }
}

// Also restore when video is detected (in case page loaded before video was ready)
// This helps when refreshing a page with an active download
let restoreRetryCount = 0;
const maxRestoreRetries = 3;
// Expose restoreRetryCount on window for access from other modules
window.restoreRetryCount = restoreRetryCount;
function retryRestoreActiveDownloads() {
  if (restoreRetryCount < maxRestoreRetries && isVideoPage() && isExtensionContextValid()) {
    restoreRetryCount++;
    window.restoreRetryCount = restoreRetryCount;
    console.log(`Retrying restore active downloads (attempt ${restoreRetryCount}/${maxRestoreRetries})`);
    setTimeout(() => {
      restoreActiveDownloads();
    }, 1000);
  }
}

// Function to reset retry count (for use by other modules)
function resetRestoreRetryCount() {
  restoreRetryCount = 0;
  window.restoreRetryCount = 0;
}
