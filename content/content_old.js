// Content script to inject into Dailymotion pages
// Utility functions are loaded via manifest.json before this script

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
          restoreActiveDownloads();
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
          showDownloadNotification('TEST_' + Date.now(), 'test.mp4', 'Test notification', 42, '');
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
  __dmDebugState.lastRestore = {
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
  originalConsoleLog('🔄 restoreActiveDownloads called:', {
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
      __dmDebugState.lastStorageSnapshot = Object.keys(items || {})
        .filter((k) => k.startsWith('download'))
        .sort()
        .map((k) => ({ key: k, value: items[k] }));
    } catch (e) {
      // ignore
    }

    // Find all download progress keys
    const downloadKeys = Object.keys(items).filter(key => key.startsWith('downloadProgress_'));
    
    if (downloadKeys.length === 0) {
      originalConsoleLog('ℹ️ No active downloads found in storage');
      return; // No active downloads
    }
    
    originalConsoleLog(`📥 Found ${downloadKeys.length} potential downloads to restore`, {
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
            originalConsoleLog('📦 Found download info in storage, attempting immediate restore:', downloadId);
            
            // Restore ALL active downloads regardless of videoId
            // Users should see all their active downloads even when navigating between videos
            originalConsoleLog('✅ Restoring download notification immediately from storage:', downloadId, {
              videoId: info.videoId,
              currentVideoId,
              note: info.videoId !== currentVideoId ? '(different video, but showing anyway)' : '(same video)'
            });
            try {
              showDownloadNotification(downloadId, info.filename || 'video.mp4', status || 'Downloading...', progress, info.qualityLabel || '');
              startDownloadProgressPolling(downloadId, info.filename || 'video.mp4');
              originalConsoleLog('✅ Successfully restored immediately:', downloadId);
              return; // Don't wait for background script response
            } catch (error) {
              originalConsoleError('❌ Error in immediate restore, will try background script:', downloadId, error);
              // Fall through to background script check
            }
          } catch (e) {
            originalConsoleError('⚠️ Failed to parse stored info, will try background script:', downloadId, e);
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
            originalConsoleLog('✅ Restoring download notification:', downloadId, {
              progress,
              status,
              videoId: info.videoId,
              currentVideoId,
              filename: info.filename,
              note: info.videoId !== currentVideoId ? '(different video, but showing anyway)' : '(same video)'
            });
            try {
              showDownloadNotification(downloadId, info.filename || 'video.mp4', status || 'Downloading...', progress, info.qualityLabel || '');
              startDownloadProgressPolling(downloadId, info.filename || 'video.mp4');
              originalConsoleLog('✅ Successfully restored download notification and started polling:', downloadId);
            } catch (error) {
              originalConsoleError('❌ Error restoring download notification:', downloadId, error);
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
                originalConsoleLog('✅ Restoring download notification from storage:', downloadId, {
                  progress,
                  status,
                  videoId: info.videoId,
                  currentVideoId,
                  filename: info.filename,
                  note: info.videoId !== currentVideoId ? '(different video, but showing anyway)' : '(same video)'
                });
                try {
                  showDownloadNotification(downloadId, info.filename || 'video.mp4', status || 'Downloading...', progress, info.qualityLabel || '');
                  startDownloadProgressPolling(downloadId, info.filename || 'video.mp4');
                  originalConsoleLog('✅ Successfully restored download notification from storage:', downloadId);
                } catch (error) {
                  originalConsoleError('❌ Error restoring download notification from storage:', downloadId, error);
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
              showDownloadNotification(downloadId, 'video.mp4', status || 'Downloading...', progress, '');
              startDownloadProgressPolling(downloadId, 'video.mp4');
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

// extractVideoIdFromUrl is now in utils.js - using extractVideoId directly

// Extract video title from the page (using utility function)
function getVideoTitle() {
  try {
    return cleanVideoTitle(document.title);
  } catch (e) {
    console.error('Error extracting video title:', e);
    return null;
  }
}

// Track URLs we've already sent to avoid spamming background
const seenUrls = new Set();

// Throttle extraction to avoid heavy repeated work
const EXTRACT_COOLDOWN_MS = 4000;
let lastExtractRun = 0;
let pendingExtractTimer = null;

function scheduleExtract(reason = 'manual') {
  const now = Date.now();
  const elapsed = now - lastExtractRun;
  if (elapsed >= EXTRACT_COOLDOWN_MS) {
    lastExtractRun = now;
    extractVideoConfig(reason);
  } else {
    clearTimeout(pendingExtractTimer);
    pendingExtractTimer = setTimeout(() => {
      lastExtractRun = Date.now();
      extractVideoConfig(reason);
    }, EXTRACT_COOLDOWN_MS - elapsed);
  }
}

// Function to extract video config from page
function extractVideoConfig(reason = 'unknown') {
  // Only extract config if we're on a video page
  if (!isVideoPage()) {
    console.log('Not a video page, skipping config extraction');
    return;
  }
  
  console.log('Extracting video config (reason:', reason, ')');
  try {
    // Method 1: Look for window.__PLAYER_CONFIG__ or window.DM (Dailymotion config)
    if (window.__PLAYER_CONFIG__) {
      const config = window.__PLAYER_CONFIG__;
      console.log('Found __PLAYER_CONFIG__:', config);
      parseConfig(config);
    }
    if (window.DM && window.DM.player && window.DM.player.config) {
      const config = window.DM.player.config;
      console.log('Found DM.player.config:', config);
      parseConfig(config);
    }
    
    // Method 2: Look for config in script tags
    const scripts = document.querySelectorAll('script');
    scripts.forEach(script => {
      const content = script.textContent;
      
      // Look for Dailymotion config patterns
      if (content.includes('config_url') || content.includes('"progressive"') || content.includes('"hls"') || content.includes('"qualities"')) {
        try {
          // Try to find JSON objects with video URLs
          const jsonMatches = content.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
          if (jsonMatches) {
            jsonMatches.forEach(jsonStr => {
              if (jsonStr.includes('.mp4') || jsonStr.includes('.m3u8') || jsonStr.includes('progressive') || jsonStr.includes('hls')) {
                try {
                  const parsed = JSON.parse(jsonStr);
                  parseConfig(parsed);
                } catch (e) {
                  // Not valid JSON, skip
                }
              }
            });
          }
          
          // Look for direct URL patterns
          const urlMatches = content.match(/(https?:\/\/[^\s"']+\.(?:mp4|m3u8)[^\s"']*)/g);
          if (urlMatches) {
            urlMatches.forEach(url => {
              const type = url.includes('.m3u8') ? 'm3u8' : 'mp4';
              sendUrlToBackground(url, type);
            });
          }
        } catch (e) {
          console.log('Script parse error:', e);
        }
      }
    });
    
    // Method 3: Check for player data attributes
    const players = document.querySelectorAll('[data-config-url], [data-player-id]');
    players.forEach(player => {
      const configUrl = player.getAttribute('data-config-url');
      if (configUrl) {
        console.log('Found config URL:', configUrl);
        fetchConfigUrl(configUrl);
      }
    });
  } catch (e) {
    console.error('Extract config error:', e);
  }
}

function parseConfig(config) {
  try {
    // Look for progressive downloads (direct MP4)
    if (config.request && config.request.files && config.request.files.progressive) {
      config.request.files.progressive.forEach(file => {
        console.log('Found progressive MP4:', file);
        sendUrlToBackground(file.url, `mp4-${file.quality || file.height}p`);
      });
    }
    
    // Look for HLS streams
    if (config.request && config.request.files && config.request.files.hls) {
      const hls = config.request.files.hls;
      if (hls.cdns) {
        Object.values(hls.cdns).forEach(cdn => {
          if (cdn.url) {
            console.log('Found HLS stream:', cdn);
            sendUrlToBackground(cdn.url, 'hls-master');
          }
        });
      }
      if (hls.default_cdn && hls.cdns[hls.default_cdn]) {
        sendUrlToBackground(hls.cdns[hls.default_cdn].url, 'hls-default');
      }
    }
    
    // Alternative config structures
    if (config.video && config.video.progressive) {
      config.video.progressive.forEach(file => {
        sendUrlToBackground(file.url, `mp4-${file.quality}`);
      });
    }
    
    if (config.video && config.video.hls) {
      sendUrlToBackground(config.video.hls.url, 'hls');
    }
  } catch (e) {
    console.error('Parse config error:', e);
  }
}

function fetchConfigUrl(url) {
  fetch(url)
    .then(res => res.json())
    .then(config => {
      console.log('Fetched config:', config);
      parseConfig(config);
    })
    .catch(err => console.error('Config fetch error:', err));
}

// Extract video ID from current page URL (using utility function)
function getVideoIdFromPage() {
  return extractVideoId(window.location.href);
}

// isVideoPage is now in utils.js - using it directly (no parameters needed, uses window.location)

function sendUrlToBackground(url, type) {
  if (!url || seenUrls.has(url)) return;
  
  // Only send URLs if we're on a video page
  if (!isVideoPage()) {
    return; // Not a video page, skip URL detection
  }
  
  seenUrls.add(url);
  
  // Get video title from page
  const videoTitle = getVideoTitle();
  
  // Get video ID from page URL
  const videoId = getVideoIdFromPage();
  
  safeSendMessage({
    action: 'storeFromContent',
    url: url,
    type: type,
    videoTitle: videoTitle,
    videoId: videoId
  }, (response) => {
    console.log('Sent to background:', url, type, videoTitle, videoId);
  });
}

// Intercept XHR requests
const originalOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url) {
  // Only intercept if we're on a video page
  if (isVideoPage() && (url.includes('.m3u8') || url.includes('.mp4') || url.includes('master.json'))) {
    console.log('XHR intercepted:', url);
    sendUrlToBackground(url, url.includes('.m3u8') ? 'm3u8' : 'mp4');
  }
  return originalOpen.apply(this, arguments);
};

// Intercept fetch
const originalFetch = window.fetch;
window.fetch = function(...args) {
  const url = args[0];
  // Only intercept if we're on a video page
  if (isVideoPage() && typeof url === 'string') {
    if (url.includes('.m3u8') || url.includes('master.json') || url.includes('config')) {
      console.log('Fetch intercepted:', url);
      const type = url.includes('.m3u8') ? 'm3u8' : 'config';
      sendUrlToBackground(url, type);
      
      // If it's a config/master.json, also fetch and parse it
      if (url.includes('master.json') || url.includes('config')) {
        const fetchPromise = originalFetch.apply(this, args);
        fetchPromise.then(response => {
          if (response.ok) {
            response.clone().json().then(config => {
              console.log('Fetched config from fetch intercept:', config);
              parseConfig(config);
            }).catch(e => console.log('Failed to parse config from fetch:', e));
          }
        }).catch(e => console.log('Fetch error:', e));
        return fetchPromise;
      }
    } else if (url.includes('.mp4')) {
      // Only send non-range MP4 URLs
      if (!url.includes('/range/') && !url.includes('range=')) {
        console.log('Fetch intercepted MP4:', url);
        sendUrlToBackground(url, 'mp4');
      }
    }
  }
  return originalFetch.apply(this, args);
};

// Run extraction shortly after load
// Only extract config if we're on a video page
if (isVideoPage()) {
  setTimeout(() => scheduleExtract('initial'), 800);
}

// Helper function to check if extension context is still valid
function isExtensionContextValid() {
  try {
    // Try to access chrome.runtime.id - if context is invalid, this will throw
    return chrome.runtime && chrome.runtime.id !== undefined;
  } catch (e) {
    return false;
  }
}

// Helper function to safely call chrome.storage.local.get with error handling
function safeStorageGet(keys, callback) {
  if (!isExtensionContextValid()) {
    console.warn('Extension context invalidated, cannot access storage');
    if (callback) callback({});
    return;
  }
  
  try {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        const errorMessage = chrome.runtime.lastError.message || '';
        if (errorMessage.includes('Extension context invalidated') || errorMessage.includes('message port closed')) {
          console.warn('Extension context invalidated during storage access');
          if (callback) callback({});
          return;
        }
      }
      if (callback) callback(result);
    });
  } catch (error) {
    console.warn('Error accessing storage:', error);
    if (callback) callback({});
  }
}

// Helper function to safely call chrome.runtime.sendMessage with error handling
function safeSendMessage(message, callback) {
  if (!isExtensionContextValid()) {
    // Don't log warning - extension context invalidation is expected when extension is reloaded
    // The calling code should check isExtensionContextValid() before calling this
    if (callback) callback({ success: false, error: 'Extension context invalidated' });
    return;
  }
  
  try {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        const errorMessage = chrome.runtime.lastError.message || '';
        if (errorMessage.includes('Extension context invalidated') || errorMessage.includes('message port closed')) {
          // Don't log warning - this is expected when extension is reloaded
          if (callback) callback({ success: false, error: 'Extension context invalidated' });
          return;
        }
      }
      if (callback) callback(response);
    });
  } catch (error) {
    // Don't log warning for context invalidation errors
    if (callback) callback({ success: false, error: error.message });
  }
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

// Initial call
scheduleRestoreActiveDownloads();

// Also restore when video is detected (in case page loaded before video was ready)
// This helps when refreshing a page with an active download
let restoreRetryCount = 0;
const maxRestoreRetries = 3;
function retryRestoreActiveDownloads() {
  if (restoreRetryCount < maxRestoreRetries && isVideoPage() && isExtensionContextValid()) {
    restoreRetryCount++;
    console.log(`Retrying restore active downloads (attempt ${restoreRetryCount}/${maxRestoreRetries})`);
    setTimeout(() => {
      restoreActiveDownloads();
    }, 3000 * restoreRetryCount); // Increasing delay: 3s, 6s, 9s
  }
}

// Retry restore when video page is detected
if (isVideoPage()) {
  setTimeout(() => retryRestoreActiveDownloads(), 5000);
}

// Monitor for DOM changes
const observer = new MutationObserver(() => {
  scheduleExtract('mutation');
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

// Listen for video play events
document.addEventListener('play', () => {
  console.log('Video play detected, extracting config...');
  setTimeout(() => scheduleExtract('play'), 500);
}, true);

// extractQuality and formatQualityLabel are now in utils.js - using them directly

// Inject download button into Dailymotion page button group
function injectDownloadButton() {
  // Check if extension context is valid before attempting injection
  if (!isExtensionContextValid()) {
    // Extension context invalidated - stop all injection attempts
    return;
  }
  
  // Only inject button on video pages
  if (!isVideoPage()) {
    console.log('Not a video page, skipping button injection');
    return;
  }
  // Only inject in top frame
  if (window.self !== window.top) return;
  
  // Remove ALL existing buttons first (prevent duplicates)
  document.querySelectorAll('#vimeo-downloader-page-button-wrapper').forEach(btn => {
    btn.remove();
  });
  
  // Find the button container (Dailymotion specific selectors)
  // Try multiple selectors as Dailymotion's structure may vary
  const buttonContainer = document.querySelector('[class*="VideoActions"]') || 
                          document.querySelector('[class*="video-actions"]') ||
                          document.querySelector('.video-actions') ||
                          document.querySelector('[data-testid="video-actions"]');
  if (!buttonContainer) {
    // Retry after a short delay if container not found (only if context is still valid)
    if (isExtensionContextValid()) {
      setTimeout(injectDownloadButton, 500);
    }
    return;
  }
  
  // Check if video URLs exist before injecting button
  const currentVideoId = getCurrentVideoId();
  const currentVideoTitle = getCurrentVideoTitle();
  let retryCount = 0;
  const maxRetries = 10; // Increased retries for slow connections
  
  const tryInject = () => {
    // Check if extension context is still valid before attempting
    if (!isExtensionContextValid()) {
      // Extension context invalidated - stop trying
      return;
    }
    
    // Also check if page is still loading - if so, wait a bit longer
    const isPageLoading = document.readyState !== 'complete';
    
    // Suppress warnings for injection attempts (expected when extension is reloaded)
    safeSendMessage({ 
      action: 'getVideoData', 
      tabId: null 
    }, (response) => {
      // Check again after async operation
      if (!isExtensionContextValid()) {
        return;
      }
      if (!response || !response.videoData || !response.videoData.urls || response.videoData.urls.length === 0) {
        // No videos detected yet, retry with exponential backoff
        // If page is still loading, retry more aggressively
        if (retryCount < maxRetries) {
          retryCount++;
          // Use shorter delays if page is still loading (1s, 1.5s, 2s...)
          // Otherwise use longer delays (2s, 3s, 4s...)
          const baseDelay = isPageLoading ? 1000 : 2000;
          const delay = baseDelay + (retryCount * (isPageLoading ? 500 : 1000));
          setTimeout(tryInject, delay);
          console.log(`Button injection retry ${retryCount}/${maxRetries} (page loading: ${isPageLoading}, delay: ${delay}ms)`);
        } else {
          console.log('Button injection: Max retries reached, video data not available');
        }
        return;
      }
      
      // If we have a current video title, check if we have data matching it
      let hasCurrentVideo = false;
      if (currentVideoTitle) {
        // Normalize title for comparison (remove extra spaces, lowercase)
        const normalizedTitle = currentVideoTitle.toLowerCase().trim().replace(/\s+/g, ' ');
        hasCurrentVideo = response.videoData.urls.some(v => {
          if (v.videoTitle) {
            const normalizedVideoTitle = v.videoTitle.toLowerCase().trim().replace(/\s+/g, ' ');
            return normalizedVideoTitle === normalizedTitle;
          }
          return false;
        });
        
        // Also check videoIds mapping
        if (!hasCurrentVideo && response.videoData.videoIds) {
          hasCurrentVideo = Object.values(response.videoData.videoIds).some(videoInfo => {
            if (videoInfo.title) {
              const normalizedVideoTitle = videoInfo.title.toLowerCase().trim().replace(/\s+/g, ' ');
              return normalizedVideoTitle === normalizedTitle;
            }
            return false;
          });
        }
      }
      
      // Fallback to video ID matching if title matching didn't work
      if (!hasCurrentVideo && currentVideoId) {
        hasCurrentVideo = response.videoData.urls.some(v => 
          v.videoId && String(v.videoId) === String(currentVideoId)
        );
      }
      
      // If no data for current video yet, retry (but don't block if we have any videos)
      // Only retry if we have NO videos at all, or if we specifically need the current video
      const hasAnyVideos = response.videoData.urls && response.videoData.urls.length > 0;
      
      if (!hasAnyVideos && retryCount < maxRetries) {
        // No videos at all, retry
        retryCount++;
        setTimeout(tryInject, 2000 * retryCount);
        return;
      }
      
      // If we have videos but they don't match current video, still proceed (will use most recent)
      // Only retry if we specifically need the current video and have time
      if (hasAnyVideos && (currentVideoTitle || currentVideoId) && !hasCurrentVideo && retryCount < 2) {
        // Give it one more try to get the current video data
        retryCount++;
        setTimeout(tryInject, 2000);
        return;
      }
      
      retryCount = 0; // Reset retry count on success
      
      // Filter to check if there are any valid video URLs
      const reliableUrls = response.videoData.urls.filter(v => {
        if (v.type && v.type.includes('mp4-full')) return false;
        if (v.type === 'config' || v.url.includes('master.json') || v.url.includes('config')) return false;
        if (v.type === 'hls-master' || (v.type && v.type.includes('hls-master'))) return false;
        if (v.type && (v.type.includes('hls') || v.type.includes('m3u8'))) {
          const hasQualityInType = v.type.match(/hls-(\d+)p?/i) || v.type.match(/(\d+)p/i);
          if (!hasQualityInType) return false;
        }
        return true;
      });
      
      if (reliableUrls.length === 0) {
        // No valid videos detected yet, retry after a delay
        if (retryCount < maxRetries) {
          retryCount++;
          setTimeout(tryInject, 2000 * retryCount);
        }
        return;
      }
      
      // Videos found, proceed with button injection
      injectButtonElement(buttonContainer);
    });
  };
  
  tryInject();
}

// Separate function to actually inject the button element
function injectButtonElement(buttonContainer) {
  // Only inject button on video pages
  if (!isVideoPage()) {
    console.log('Not a video page, skipping button injection');
    return;
  }
  // Double-check: Remove any existing buttons before injecting (safety check)
  document.querySelectorAll('#vimeo-downloader-page-button-wrapper').forEach(btn => {
    btn.remove();
  });
  // Add styles for the download button
  if (!document.getElementById('vimeo-downloader-button-styles')) {
    const style = document.createElement('style');
    style.id = 'vimeo-downloader-button-styles';
    style.textContent = `
      #vimeo-downloader-page-button-wrapper {
        position: relative;
      
      }
      
      .vimeo-downloader-button-group {
        position: relative;
        display: flex;
        border-radius: 8px;
        overflow: visible !important;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
   
      }
      
      /* Ensure parent containers don't clip the dropdown */
      .css-rrm59m {
        overflow: visible !important;
      }
      
      .chakra-stack.css-tistzx {
        overflow: visible !important;
      }
      
      .vimeo-downloader-download-btn {
        flex: 1;
        min-width: 0;
        background: rgb(14, 18, 22);
        color: white;
        border: none;
        border-radius: 0;
        border-top-left-radius: 8px;
        border-bottom-left-radius: 8px;
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
        margin: 0;
        padding: 6px 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
      }
      
      .vimeo-downloader-download-btn:hover {
        background: rgb(20, 24, 28);
      }
      
      .vimeo-downloader-download-btn .download-icon {
        display: none;
      }
      
      @media (max-width: 600px) {
        [data-testid="action-bar"] {
          overflow-x: scroll;
          overflow-y: visible;
          -webkit-overflow-scrolling: touch;
        }
        
        [data-testid="action-bar"] .chakra-stack {
          overflow-y: visible !important;
        }
        
        .vimeo-downloader-download-btn {
          padding: 6px 8px;
          min-width: 40px;
        }
        
        .vimeo-downloader-download-btn .download-text {
          display: none;
        }
        
        .vimeo-downloader-download-btn .download-icon {
          display: inline-block;
          width: 16px;
          height: 16px;
        }
      }
      
      .vimeo-downloader-dropdown-btn {
        flex: 0 0 auto;
        width: 32px;
        padding: 10px 8px;
        background: rgb(14, 18, 22);
        color: white;
        border: none;
        border-left: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 0;
        border-top-right-radius: 8px;
        border-bottom-right-radius: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      }
      
      .vimeo-downloader-dropdown-btn:hover {
        background: rgb(20, 24, 28);
      }
      
      .vimeo-downloader-dropdown-btn svg {
        pointer-events: none;
      }
      
      .vimeo-downloader-quality-menu {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        background: white;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        max-height: 200px;
        overflow-y: auto;
        z-index: 999999 !important;
        display: none;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
        padding: 4px 0;
        min-width: 200px;
        max-width: calc(100vw - 16px);
        box-sizing: border-box;
      }
      
      @media (max-width: 600px) {
        .vimeo-downloader-quality-menu {
          max-width: calc(100vw - 16px) !important;
        }
      }
      
      .vimeo-downloader-quality-menu.show {
        display: block !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        visibility: visible !important;
      }
      
      .vimeo-downloader-quality-item {
        padding: 10px 16px;
        cursor: pointer;
        font-size: 13px;
        color: #333;
        transition: background-color 0.2s;
        border-bottom: 1px solid #f0f0f0;
      }
      
      .vimeo-downloader-quality-item:last-child {
        border-bottom: none;
      }
      
      .vimeo-downloader-quality-item:hover {
        background-color: #f5f5f5;
      }
      
      .vimeo-downloader-quality-item.selected {
        background-color: rgb(14, 18, 22);
        color: white;
        font-weight: 600;
      }
      
      .vimeo-downloader-quality-item.selected:hover {
        background-color: rgb(20, 24, 28);
      }
    `;
    document.head.appendChild(style);
  }
  
  // Create wrapper
  const buttonWrapper = document.createElement('div');
  buttonWrapper.id = 'vimeo-downloader-page-button-wrapper';
  buttonWrapper.className = 'css-rrm59m';
  
  // Create button group
  const buttonGroup = document.createElement('div');
  buttonGroup.className = 'vimeo-downloader-button-group';
  
  // Create main download button
  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'vimeo-downloader-download-btn';
  downloadBtn.innerHTML = `
    <span class="download-text">Download</span>
    <svg class="download-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 2V10M8 10L5 7M8 10L11 7M3 12H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
  
  // Create dropdown button
  const dropdownBtn = document.createElement('button');
  dropdownBtn.className = 'vimeo-downloader-dropdown-btn';
  dropdownBtn.setAttribute('aria-label', 'Select quality');
  dropdownBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
  
  // Create quality dropdown menu
  const qualityMenu = document.createElement('div');
  qualityMenu.className = 'vimeo-downloader-quality-menu';
  
  
  // Function to get current video ID from URL
  const getCurrentVideoId = () => {
    try {
      const videoIdMatch = window.location.pathname.match(/\/video\/([a-zA-Z0-9]+)/);
      return videoIdMatch ? videoIdMatch[1] : null;
    } catch (e) {
      return null;
    }
  };
  
  // Function to populate quality menu - SIMPLIFIED
  // Track retry state for quality menu
  let menuRetryCount = 0;
  const maxMenuRetries = 5;
  
  const populateQualityMenu = (isRetry = false) => {
    if (!isRetry) {
      qualityMenu.innerHTML = '';
      menuRetryCount = 0;
    }
    
    const currentVideoTitle = getCurrentVideoTitle();
    const currentVideoId = getCurrentVideoId();
    
    // Get video data to populate quality menu (pass null for tabId, background will find it)
    safeSendMessage({ 
      action: 'getVideoData', 
      tabId: null 
    }, (response) => {
      if (!response || !response.videoData || !response.videoData.urls || response.videoData.urls.length === 0) {
        // If no videos and we haven't exceeded retries, show loading and retry
        if (menuRetryCount < maxMenuRetries && document.readyState !== 'complete') {
          menuRetryCount++;
          const menuItem = document.createElement('div');
          menuItem.className = 'vimeo-downloader-quality-item';
          menuItem.textContent = `Loading videos... (${menuRetryCount}/${maxMenuRetries})`;
          menuItem.style.cursor = 'default';
          menuItem.style.opacity = '0.5';
          qualityMenu.innerHTML = '';
          qualityMenu.appendChild(menuItem);
          // Retry after delay
          setTimeout(() => populateQualityMenu(true), 1500);
          return;
        }
        // Max retries reached or page loaded - show no videos message
        const menuItem = document.createElement('div');
        menuItem.className = 'vimeo-downloader-quality-item';
        menuItem.textContent = 'No videos detected yet';
        menuItem.style.cursor = 'default';
        menuItem.style.opacity = '0.5';
        qualityMenu.innerHTML = '';
        qualityMenu.appendChild(menuItem);
        return;
      }
      
      // Reset retry count on success
      menuRetryCount = 0;
      
      // Use same filtering logic as popup
      const reliableUrls = response.videoData.urls.filter(v => {
        // Hide mp4-full - they're extracted from range URLs and often incomplete
        if (v.type && v.type.includes('mp4-full')) {
          return false;
        }
        // Hide config files
        if (v.type === 'config' || v.url.includes('master.json') || v.url.includes('config')) {
          return false;
        }
        // Hide HLS master playlists
        if (v.type === 'hls-master' || (v.type && v.type.includes('hls-master'))) {
          return false;
        }
        // Hide any HLS URL that doesn't have a specific quality
        if (v.type && (v.type.includes('hls') || v.type.includes('m3u8'))) {
          const hasQualityInType = v.type.match(/hls-(\d+)p?/i) || v.type.match(/(\d+)p/i);
          if (!hasQualityInType) {
            return false;
          }
        }
        
        // Filter out files smaller than 300KB (likely thumbnails, metadata, or incomplete files)
        const MIN_FILE_SIZE = 300 * 1024; // 300KB in bytes
        if (v.fileSize !== null && v.fileSize !== undefined) {
          if (v.fileSize < MIN_FILE_SIZE) {
            return false; // File is too small, skip it
          }
        }
        // If fileSize is null/undefined (unknown), we still show it (HLS playlists don't have known size)
        
        return true;
      });
      
      if (reliableUrls.length === 0) {
        const menuItem = document.createElement('div');
        menuItem.className = 'vimeo-downloader-quality-item';
        menuItem.textContent = 'No videos detected yet';
        menuItem.style.cursor = 'default';
        menuItem.style.opacity = '0.5';
        qualityMenu.appendChild(menuItem);
        return;
      }
      
      // Try to filter by current video, but always fall back to all reliable URLs
      let filteredUrls = reliableUrls;
      
      // First, try to match by title if we have one
      if (currentVideoTitle) {
        const normalizedTitle = currentVideoTitle.toLowerCase().trim().replace(/\s+/g, ' ');
        
        // Try matching by videoTitle in URLs
        const titleMatches = reliableUrls.filter(v => {
          if (v.videoTitle) {
            const normalizedVideoTitle = v.videoTitle.toLowerCase().trim().replace(/\s+/g, ' ');
            return normalizedVideoTitle === normalizedTitle;
          }
          return false;
        });
        
        if (titleMatches.length > 0) {
          filteredUrls = titleMatches;
        } else if (response.videoData.videoIds) {
          // Try matching via videoIds mapping
          const matchingVideoId = Object.entries(response.videoData.videoIds).find(([id, info]) => {
            if (info.title) {
              const normalizedVideoTitle = info.title.toLowerCase().trim().replace(/\s+/g, ' ');
              return normalizedVideoTitle === normalizedTitle;
            }
            return false;
          });
          
          if (matchingVideoId) {
            const matchedId = matchingVideoId[0];
            const idMatches = reliableUrls.filter(v => 
              v.videoId && String(v.videoId) === String(matchedId)
            );
            if (idMatches.length > 0) {
              filteredUrls = idMatches;
            }
          }
        }
      }
      
      // If still no matches and we have a video ID, try matching by ID
      if (filteredUrls.length === 0 && currentVideoId) {
        const idMatches = reliableUrls.filter(v => 
          v.videoId && String(v.videoId) === String(currentVideoId)
        );
        if (idMatches.length > 0) {
          filteredUrls = idMatches;
        }
      }
      
      // Always fall back to all reliable URLs if filtering resulted in nothing
      if (filteredUrls.length === 0) {
        filteredUrls = reliableUrls;
      }
      
      // Group by videoId
      const groupedVideos = {};
      filteredUrls.forEach(video => {
        const key = video.videoId || video.url.split('?')[0];
        if (!groupedVideos[key]) {
          groupedVideos[key] = [];
        }
        groupedVideos[key].push(video);
      });
      
      // Get the group for the current video (prioritize title match, then videoId)
      let videoGroup = [];
      if (currentVideoTitle) {
        // Try to find group with matching title
        const normalizedTitle = currentVideoTitle.toLowerCase().trim().replace(/\s+/g, ' ');
        const matchingGroup = Object.entries(groupedVideos).find(([key, videos]) => {
          return videos.some(v => {
            if (v.videoTitle) {
              const normalizedVideoTitle = v.videoTitle.toLowerCase().trim().replace(/\s+/g, ' ');
              return normalizedVideoTitle === normalizedTitle;
            }
            return false;
          });
        });
        if (matchingGroup) {
          videoGroup = matchingGroup[1];
        }
      }
      
      // If no title match, try video ID match
      if (videoGroup.length === 0 && currentVideoId) {
        const matchingGroup = Object.entries(groupedVideos).find(([key, videos]) => {
          return videos.some(v => v.videoId && String(v.videoId) === String(currentVideoId));
        });
        if (matchingGroup) {
          videoGroup = matchingGroup[1];
        }
      }
      
      // If no match found, get the most recent group (by timestamp)
      if (videoGroup.length === 0) {
        const sortedGroups = Object.entries(groupedVideos).sort((a, b) => {
          const aMaxTime = Math.max(...a[1].map(v => v.timestamp || 0), 0);
          const bMaxTime = Math.max(...b[1].map(v => v.timestamp || 0), 0);
          return bMaxTime - aMaxTime;
        });
        videoGroup = sortedGroups[0] ? sortedGroups[0][1] : [];
      }
      
      // If still no group, use all filtered URLs directly (don't group)
      if (videoGroup.length === 0 && filteredUrls.length > 0) {
        videoGroup = filteredUrls;
      }
      
      if (videoGroup.length === 0) {
        const menuItem = document.createElement('div');
        menuItem.className = 'vimeo-downloader-quality-item';
        menuItem.textContent = 'No videos detected yet';
        menuItem.style.cursor = 'default';
        menuItem.style.opacity = '0.5';
        qualityMenu.appendChild(menuItem);
        return;
      }
      
      // Sort by quality (prefer MP4, then highest quality)
      const sortedQualities = videoGroup.sort((a, b) => {
        const aIsMP4 = a.type && a.type.includes('mp4') && !a.type.includes('m3u8');
        const bIsMP4 = b.type && b.type.includes('mp4') && !b.type.includes('m3u8');
        if (aIsMP4 && !bIsMP4) return -1;
        if (!aIsMP4 && bIsMP4) return 1;
        
        const qualityA = extractQuality(a.type, a.url) || 0;
        const qualityB = extractQuality(b.type, b.url) || 0;
        return qualityB - qualityA;
      });
      
      // Deduplicate by quality AND type (keep one MP4 and one HLS per quality)
      const uniqueQualities = new Map();
      sortedQualities.forEach((video) => {
        const quality = extractQuality(video.type, video.url);
        if (!quality) {
          // Still include videos without quality if they're MP4
          const isMP4 = video.type && video.type.includes('mp4') && !video.type.includes('m3u8');
          if (isMP4) {
            const key = 'MP4-unknown';
            if (!uniqueQualities.has(key)) {
              uniqueQualities.set(key, video);
            }
          }
          return;
        }
        
        const isMP4 = video.type && video.type.includes('mp4') && !video.type.includes('m3u8');
        const isHLS = video.type && (video.type.includes('m3u8') || video.type.includes('hls'));
        const key = `${quality}-${isMP4 ? 'MP4' : isHLS ? 'HLS' : 'OTHER'}`;
        
        if (!uniqueQualities.has(key)) {
          uniqueQualities.set(key, video);
        }
      });
      
      const deduplicatedQualities = Array.from(uniqueQualities.values());
      
      if (deduplicatedQualities.length === 0) {
        const menuItem = document.createElement('div');
        menuItem.className = 'vimeo-downloader-quality-item';
        menuItem.textContent = 'No videos detected yet';
        menuItem.style.cursor = 'default';
        menuItem.style.opacity = '0.5';
        qualityMenu.appendChild(menuItem);
        return;
      }
      
      // Get video title - prioritize current video title from webpage DOM
      let videoTitle = 'Vimeo Video';
      if (currentVideoTitle) {
        // Use the title from the webpage (most accurate)
        videoTitle = currentVideoTitle;
      } else if (currentVideoId && response.videoData.videoIds && response.videoData.videoIds[currentVideoId]) {
        videoTitle = response.videoData.videoIds[currentVideoId].title || videoTitle;
      } else if (deduplicatedQualities[0]?.videoTitle) {
        videoTitle = deduplicatedQualities[0].videoTitle;
      } else if (response.videoData.videoIds && Object.keys(response.videoData.videoIds).length > 0) {
        // Get title from the most recent video ID (by timestamp)
        const videoIds = Object.entries(response.videoData.videoIds);
        const sortedIds = videoIds.sort((a, b) => {
          const aTime = a[1].timestamp || 0;
          const bTime = b[1].timestamp || 0;
          return bTime - aTime;
        });
        if (sortedIds[0] && sortedIds[0][1].title) {
          videoTitle = sortedIds[0][1].title;
        }
      } else if (response.videoData.videoTitle) {
        videoTitle = response.videoData.videoTitle;
      }
      
      // Get current selected URL from button (if any) to preserve selection
      // BUT: Only preserve if we're still on the same video (check videoId)
      const currentSelectedUrl = downloadBtn.getAttribute('data-url');
      const buttonVideoId = downloadBtn.getAttribute('data-video-id');
      let selectedIndex = 0; // Default to first item
      
      // Only preserve selection if we're on the same video
      if (currentSelectedUrl && deduplicatedQualities.length > 0 && 
          currentVideoId && buttonVideoId && 
          String(currentVideoId) === String(buttonVideoId)) {
        // Same video - try to preserve selection
        const matchingIndex = deduplicatedQualities.findIndex(v => v && v.url === currentSelectedUrl);
        if (matchingIndex >= 0) {
          selectedIndex = matchingIndex;
        }
      } else {
        // Different video or no videoId match - reset to first item
        // Clear old button data to prevent using stale URLs
        downloadBtn.removeAttribute('data-url');
        downloadBtn.removeAttribute('data-type');
        downloadBtn.removeAttribute('data-quality-label');
        downloadBtn.removeAttribute('data-video-title');
        downloadBtn.removeAttribute('data-video-id');
        selectedIndex = 0;
      }
      
      // Set button data - SIMPLE
      if (deduplicatedQualities.length > 0 && deduplicatedQualities[0] && deduplicatedQualities[0].url) {
        // Use selected video or first video
        const selectedVideo = deduplicatedQualities[selectedIndex] || deduplicatedQualities[0];
        downloadBtn.setAttribute('data-url', selectedVideo.url);
        downloadBtn.setAttribute('data-type', selectedVideo.type || '');
        downloadBtn.setAttribute('data-quality-label', formatQualityLabel(selectedVideo));
        downloadBtn.setAttribute('data-video-title', videoTitle);
        if (currentVideoId) {
          downloadBtn.setAttribute('data-video-id', currentVideoId);
        }
        
        // Populate menu
        deduplicatedQualities.forEach((video, idx) => {
          if (!video || !video.url) return;
          const qualityLabel = formatQualityLabel(video);
          const menuItem = document.createElement('div');
          menuItem.className = 'vimeo-downloader-quality-item' + (idx === selectedIndex ? ' selected' : '');
          menuItem.textContent = `${videoTitle} - ${qualityLabel}`;
          menuItem.setAttribute('data-url', video.url);
          menuItem.setAttribute('data-type', video.type || '');
          menuItem.setAttribute('data-quality-label', qualityLabel);
          menuItem.setAttribute('data-video-title', videoTitle);
          qualityMenu.appendChild(menuItem);
        });
      }
    });
  };
  
  // Initial population
  populateQualityMenu();
  
  // Toggle dropdown
  dropdownBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const isShowing = qualityMenu.classList.contains('show');
    
    // Close all other dropdowns
    document.querySelectorAll('.vimeo-downloader-quality-menu').forEach(menu => {
      if (menu !== qualityMenu) {
        menu.classList.remove('show');
        menu.style.display = 'none';
      }
    });
    
    if (isShowing) {
      qualityMenu.classList.remove('show');
      qualityMenu.style.display = 'none';
    } else {
      // Always refresh menu data when opening to get latest video data (handles navigation)
      // Clear menu first to show loading state
      qualityMenu.innerHTML = '';
      const loadingItem = document.createElement('div');
      loadingItem.className = 'vimeo-downloader-quality-item';
      loadingItem.textContent = 'Loading...';
      loadingItem.style.cursor = 'default';
      loadingItem.style.opacity = '0.5';
      qualityMenu.appendChild(loadingItem);
      
      // Then populate with fresh data
      populateQualityMenu();
      
      // Calculate position after menu is populated (use setTimeout to ensure DOM is updated)
      setTimeout(() => {
        // Calculate position for fixed positioning on mobile
        if (window.innerWidth <= 600) {
          const buttonRect = buttonGroup.getBoundingClientRect();
          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;
          const padding = 8; // Minimum padding from screen edges
          
          // Temporarily show menu to measure it
          qualityMenu.style.visibility = 'hidden';
          qualityMenu.style.display = 'block';
          qualityMenu.style.position = 'fixed';
          qualityMenu.style.left = '0';
          qualityMenu.style.top = '0';
          const menuRect = qualityMenu.getBoundingClientRect();
          const menuHeight = menuRect.height || 200; // Fallback if not measured
          const menuNaturalWidth = menuRect.width || buttonRect.width;
          
          // Calculate menu width (don't exceed viewport)
          const maxMenuWidth = viewportWidth - (padding * 2);
          const menuWidth = Math.min(menuNaturalWidth, maxMenuWidth, buttonRect.width);
          
          // Calculate horizontal position (ensure it doesn't go off right edge)
          let leftPos = buttonRect.left;
          
          // Check if menu would overflow right edge
          if (leftPos + menuWidth > viewportWidth - padding) {
            leftPos = viewportWidth - menuWidth - padding;
          }
          
          // Ensure menu doesn't go off left edge
          if (leftPos < padding) {
            leftPos = padding;
          }
          
          // Final check: ensure menu fits within viewport
          if (leftPos + menuWidth > viewportWidth) {
            leftPos = Math.max(padding, viewportWidth - menuWidth - padding);
          }
          
          // Calculate vertical position (prefer below, but show above if not enough space)
          let topPos = buttonRect.bottom + 4;
          const spaceBelow = viewportHeight - buttonRect.bottom;
          const spaceAbove = buttonRect.top;
          
          if (spaceBelow < menuHeight + 4 && spaceAbove > spaceBelow) {
            // Show above button if there's more space above
            topPos = buttonRect.top - menuHeight - 4;
          }
          
          // Ensure dropdown doesn't go below viewport
          if (topPos + menuHeight > viewportHeight - padding) {
            topPos = viewportHeight - menuHeight - padding;
          }
          
          // Ensure dropdown doesn't go above viewport
          if (topPos < padding) {
            topPos = padding;
          }
          
          qualityMenu.style.position = 'fixed';
          qualityMenu.style.top = `${topPos}px`;
          qualityMenu.style.left = `${leftPos}px`;
          qualityMenu.style.right = 'auto';
          qualityMenu.style.width = `${menuWidth}px`;
          qualityMenu.style.maxWidth = `${viewportWidth - (padding * 2)}px`;
          qualityMenu.style.maxHeight = `${viewportHeight - topPos - padding}px`;
          qualityMenu.style.visibility = 'visible';
          
          // Double-check: if menu still overflows, adjust using right property
          setTimeout(() => {
            const finalRect = qualityMenu.getBoundingClientRect();
            if (finalRect.right > viewportWidth - padding) {
              const overflow = finalRect.right - (viewportWidth - padding);
              qualityMenu.style.left = `${Math.max(padding, leftPos - overflow)}px`;
            }
          }, 0);
        } else {
          qualityMenu.style.position = 'absolute';
          qualityMenu.style.top = 'calc(100% + 4px)';
          qualityMenu.style.left = '0';
          qualityMenu.style.right = '0';
          qualityMenu.style.width = 'auto';
          qualityMenu.style.maxHeight = '';
        }
        
        qualityMenu.classList.add('show');
        qualityMenu.style.display = 'block';
        qualityMenu.style.opacity = '1';
        qualityMenu.style.visibility = 'visible';
        qualityMenu.style.zIndex = '999999';
      }, 50); // Small delay to ensure menu is populated
    }
  });
  
  // Handle quality selection
  qualityMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.vimeo-downloader-quality-item');
    if (!item || item.style.cursor === 'default') return;
    
    e.stopPropagation();
    
    // Update selected item
    qualityMenu.querySelectorAll('.vimeo-downloader-quality-item').forEach(i => {
      i.classList.remove('selected');
    });
    item.classList.add('selected');
    
    // Update download button
    const url = item.getAttribute('data-url');
    const type = item.getAttribute('data-type');
    const qualityLabel = item.getAttribute('data-quality-label');
    const videoTitle = item.getAttribute('data-video-title');
    
    if (url) {
      downloadBtn.setAttribute('data-url', url);
      downloadBtn.setAttribute('data-type', type);
      downloadBtn.setAttribute('data-quality-label', qualityLabel);
      if (videoTitle) {
        downloadBtn.setAttribute('data-video-title', videoTitle);
      }
    }
    
    // Close menu
    qualityMenu.classList.remove('show');
    qualityMenu.style.display = 'none';
  });
  
  // Update dropdown position on scroll (for mobile with overflow scroll)
  const updateDropdownPosition = () => {
    if (window.innerWidth <= 600 && qualityMenu.classList.contains('show')) {
      const buttonRect = buttonGroup.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const padding = 8; // Minimum padding from screen edges
      
      const menuHeight = qualityMenu.offsetHeight || 200; // Fallback height
      const menuNaturalWidth = qualityMenu.offsetWidth || buttonRect.width;
      
      // Calculate menu width (don't exceed viewport)
      const maxMenuWidth = viewportWidth - (padding * 2);
      const menuWidth = Math.min(menuNaturalWidth, maxMenuWidth, buttonRect.width);
      
      // Calculate horizontal position (ensure it doesn't go off right edge)
      let leftPos = buttonRect.left;
      
      // Check if menu would overflow right edge
      if (leftPos + menuWidth > viewportWidth - padding) {
        leftPos = viewportWidth - menuWidth - padding;
      }
      
      // Ensure menu doesn't go off left edge
      if (leftPos < padding) {
        leftPos = padding;
      }
      
      // Final check: ensure menu fits within viewport
      if (leftPos + menuWidth > viewportWidth) {
        leftPos = Math.max(padding, viewportWidth - menuWidth - padding);
      }
      
      // Calculate vertical position (prefer below, but show above if not enough space)
      let topPos = buttonRect.bottom + 4;
      const spaceBelow = viewportHeight - buttonRect.bottom;
      const spaceAbove = buttonRect.top;
      
      if (spaceBelow < menuHeight + 4 && spaceAbove > spaceBelow) {
        // Show above button if there's more space above
        topPos = buttonRect.top - menuHeight - 4;
      }
      
      // Ensure dropdown doesn't go below viewport
      if (topPos + menuHeight > viewportHeight - padding) {
        topPos = viewportHeight - menuHeight - padding;
      }
      
      // Ensure dropdown doesn't go above viewport
      if (topPos < padding) {
        topPos = padding;
      }
      
      qualityMenu.style.top = `${topPos}px`;
      qualityMenu.style.left = `${leftPos}px`;
      qualityMenu.style.width = `${menuWidth}px`;
      qualityMenu.style.maxWidth = `${viewportWidth - (padding * 2)}px`;
      qualityMenu.style.maxHeight = `${viewportHeight - topPos - padding}px`;
      
      // Double-check: if menu still overflows, adjust using right property
      setTimeout(() => {
        const finalRect = qualityMenu.getBoundingClientRect();
        if (finalRect.right > viewportWidth - padding) {
          const overflow = finalRect.right - (viewportWidth - padding);
          qualityMenu.style.left = `${Math.max(padding, leftPos - overflow)}px`;
        }
      }, 0);
    }
  };
  
  // Listen for scroll on action bar
  const actionBar = document.querySelector('[data-testid="action-bar"]');
  if (actionBar) {
    actionBar.addEventListener('scroll', updateDropdownPosition);
  }
  
  // Listen for window resize
  window.addEventListener('resize', updateDropdownPosition);
  
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    // Only close if dropdown is open and click is outside the button group
    if (qualityMenu.classList.contains('show') && !buttonGroup.contains(e.target)) {
      qualityMenu.classList.remove('show');
      qualityMenu.style.display = 'none';
    }
  });
  
  // Handle download button click
  downloadBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const url = downloadBtn.getAttribute('data-url');
    const type = downloadBtn.getAttribute('data-type');
    const qualityLabel = downloadBtn.getAttribute('data-quality-label');
    const buttonVideoId = downloadBtn.getAttribute('data-video-id');
    const currentVideoId = getCurrentVideoId();
    
    // Safety check: Verify URL belongs to current video
    if (url && currentVideoId && buttonVideoId && String(currentVideoId) !== String(buttonVideoId)) {
      console.warn('Button URL belongs to different video, refreshing button data...', {
        buttonVideoId,
        currentVideoId,
        url: url.substring(0, 50) + '...'
      });
      // Clear stale data and refresh
      downloadBtn.removeAttribute('data-url');
      downloadBtn.removeAttribute('data-type');
      downloadBtn.removeAttribute('data-quality-label');
      downloadBtn.removeAttribute('data-video-title');
      downloadBtn.removeAttribute('data-video-id');
      // Re-populate menu to get fresh data
      populateQualityMenu();
      return;
    }
    
    if (!url) {
      // Instead of alert, try to refresh the button data
      if (DEBUG) console.log('No video URL available, refreshing button data...');
      
      // Try to repopulate the menu and get fresh data
      const qualityMenu = buttonWrapper.querySelector('.vimeo-downloader-quality-menu');
      if (qualityMenu) {
        // Trigger menu population which will update button data
        const populateQualityMenu = window.vimeoDownloaderPopulateQualityMenu;
        if (populateQualityMenu) {
          populateQualityMenu();
        } else {
          // Fallback: re-inject button
          setTimeout(() => {
            injectDownloadButton();
          }, 1000);
        }
      } else {
        // Fallback: re-inject button
        setTimeout(() => {
          injectDownloadButton();
        }, 1000);
      }
      return;
    }
    
    // Get video title from button attribute or fetch from background
    let videoTitle = downloadBtn.getAttribute('data-video-title');
    
    if (!videoTitle) {
      // Fallback: get from background
      safeSendMessage({ 
        action: 'getVideoData', 
        tabId: null 
      }, (response) => {
        if (response && response.videoData) {
          videoTitle = response.videoData.videoTitle || 
                      (response.videoData.videoIds && Object.values(response.videoData.videoIds)[0]?.title) ||
                      'Vimeo Video';
          triggerDownload(url, type, qualityLabel, videoTitle);
        } else {
          triggerDownload(url, type, qualityLabel, 'Vimeo Video');
        }
      });
    } else {
      triggerDownload(url, type, qualityLabel, videoTitle);
    }
    
    function triggerDownload(url, type, qualityLabel, videoTitle) {
      const extension = url.includes('.mp4') ? 'mp4' : (url.includes('.m3u8') ? 'm3u8' : 'mp4');
      const sanitizedTitle = videoTitle.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
      const filename = qualityLabel ? 
        `${sanitizedTitle} - ${qualityLabel}.${extension}` : 
        `${sanitizedTitle}.${extension}`;
      
      // Trigger download
      safeSendMessage({
        action: 'download',
        url: url,
        type: type,
        filename: filename,
        qualityLabel: qualityLabel,
        // Send correct dailymotion videoId for restore filtering
        videoId: getCurrentVideoId()
      }, (downloadResponse) => {
        if (downloadResponse && downloadResponse.success) {
          if (DEBUG) console.log('Download started from page button');
        } else if (downloadResponse && downloadResponse.error) {
          // Only show alert for actual errors, not for cancellations or duplicates
          const errorMsg = downloadResponse.error.toLowerCase();
          if (!errorMsg.includes('already being downloaded') && 
              !errorMsg.includes('duplicate') &&
              !errorMsg.includes('cancelled') &&
              !errorMsg.includes('cancel')) {
            // Only show alert for real failures
            if (DEBUG) console.log('Download failed:', downloadResponse.error);
            // Don't show alert - silently fail
          }
        }
        // If no response or no success, silently fail (don't show alert)
      });
    }
  });
  
  // Assemble button group
  buttonGroup.appendChild(downloadBtn);
  buttonGroup.appendChild(dropdownBtn);
  buttonGroup.appendChild(qualityMenu);
  buttonWrapper.appendChild(buttonGroup);
  
  // Insert into Vimeo's button container
  buttonContainer.appendChild(buttonWrapper);
  
  if (DEBUG) console.log('Download button injected into Vimeo page');
}

// Inject button when page loads (only on video pages)
if (isVideoPage()) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (isExtensionContextValid()) {
        setTimeout(injectDownloadButton, 1000);
      }
    });
  } else {
    if (isExtensionContextValid()) {
      setTimeout(injectDownloadButton, 1000);
    }
  }
}

// Track URL changes to remove and re-inject button on navigation
let lastUrl = window.location.href;
let lastVideoId = null;
let urlCheckInterval = null;
let dataCheckInterval = null;
let isRefreshing = false; // Prevent multiple simultaneous refreshes

function getCurrentVideoId() {
  try {
    const videoIdMatch = window.location.pathname.match(/\/video\/([a-zA-Z0-9]+)/);
    return videoIdMatch ? videoIdMatch[1] : null;
  } catch (e) {
    return null;
  }
}

// Extract video title from webpage DOM
function getCurrentVideoTitle() {
  try {
    // Simple approach: just use page title (tab bar always has the video title)
    let title = document.title;
    if (title) {
      // Remove common suffixes: " - Dailymotion", " | Dailymotion", " - Watch on Dailymotion", etc.
      title = title.replace(/\s*[-|]\s*Dailymotion.*$/i, '').trim();
      title = title.replace(/\s*[-|]\s*Watch.*Dailymotion.*$/i, '').trim();
      // Remove "Dailymotion Video Player" if it's the entire title or a suffix
      title = title.replace(/\s*[-|]\s*Dailymotion\s+Video\s+Player.*$/i, '').trim();
      title = title.replace(/^Dailymotion\s+Video\s+Player\s*[-|]?\s*/i, '').trim();
      // Filter out generic titles
      if (title && title.length > 2 && 
          !title.toLowerCase().match(/^(dailymotion|video|dailymotion video player|video player)$/i)) {
        return title;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

function checkUrlChange() {
  const currentUrl = window.location.href;
  
  // Only run checks if we're on a video page
  if (!isVideoPage()) {
    return; // Not a video page, skip all checks
  }
  const currentVideoId = getCurrentVideoId();
  
  if (currentUrl !== lastUrl || (currentVideoId && currentVideoId !== lastVideoId)) {
    const previousVideoId = lastVideoId;
    lastUrl = currentUrl;
    lastVideoId = currentVideoId;
    
    // Prevent multiple simultaneous refreshes
    if (isRefreshing) return;
    isRefreshing = true;
    
    // DON'T clean up download notifications when navigating - users should see all active downloads
    // The cleanupDownloadsForVideo function is disabled to allow downloads to persist across navigation
    // This way users can navigate between videos and still see their active downloads
    
    // Clear button data attributes before removing to prevent stale data
    document.querySelectorAll('#vimeo-downloader-page-button-wrapper').forEach(wrapper => {
      const downloadBtn = wrapper.querySelector('.vimeo-downloader-download-btn');
      if (downloadBtn) {
        downloadBtn.removeAttribute('data-url');
        downloadBtn.removeAttribute('data-type');
        downloadBtn.removeAttribute('data-quality-label');
        downloadBtn.removeAttribute('data-video-title');
        downloadBtn.removeAttribute('data-video-id');
      }
      wrapper.remove();
    });
    
    // Re-inject button with fresh data after a delay (to allow new video data to be detected)
    // Use longer delay to ensure new video data is available
    setTimeout(() => {
      isRefreshing = false;
      // Only re-inject if we're still on a video page
      if (isVideoPage()) {
        injectDownloadButton();
        // Also restore active downloads when video is detected (in case of page refresh)
        // Reset retry count to allow fresh retry attempts
        restoreRetryCount = 0;
        setTimeout(() => {
          restoreActiveDownloads();
        }, 1000);
      }
    }, 2500);
  }
}

// DISABLED: Clean up downloads that belong to a specific video (when navigating away)
// This function is disabled because users should see ALL active downloads regardless of which video page they're on
// Downloads will only be hidden when they complete, fail, or are cancelled
function cleanupDownloadsForVideo(videoId) {
  // Function disabled - do not clean up downloads when navigating
  // Users should see all active downloads even when navigating between videos
  originalConsoleLog('ℹ️ cleanupDownloadsForVideo called but disabled - downloads persist across navigation:', videoId);
  return;
}

// Periodic check to verify button has correct data for current video
function verifyButtonData() {
  if (isRefreshing) return;
  
  const buttonWrapper = document.getElementById('vimeo-downloader-page-button-wrapper');
  if (!buttonWrapper) return;
  
  const downloadBtn = buttonWrapper.querySelector('.vimeo-downloader-download-btn');
  if (!downloadBtn) return;
  
  const currentVideoId = getCurrentVideoId();
  const currentVideoTitle = getCurrentVideoTitle();
  const storedVideoId = downloadBtn.getAttribute('data-video-id');
  const storedVideoTitle = downloadBtn.getAttribute('data-video-title');
  
  // Check if video title changed (most reliable indicator)
  let shouldRefresh = false;
  if (currentVideoTitle && storedVideoTitle) {
    const normalizedCurrent = currentVideoTitle.toLowerCase().trim().replace(/\s+/g, ' ');
    const normalizedStored = storedVideoTitle.toLowerCase().trim().replace(/\s+/g, ' ');
    if (normalizedCurrent !== normalizedStored) {
      shouldRefresh = true;
      if (DEBUG) console.log('Video title mismatch detected, refreshing button:', currentVideoTitle, 'vs', storedVideoTitle);
    }
  } else if (currentVideoId && storedVideoId && currentVideoId !== storedVideoId) {
    // Fallback to video ID check if title not available
    shouldRefresh = true;
    if (DEBUG) console.log('Video ID mismatch detected, refreshing button:', currentVideoId, 'vs', storedVideoId);
  }
  
  if (shouldRefresh) {
    isRefreshing = true;
    buttonWrapper.remove();
    setTimeout(() => {
      isRefreshing = false;
      injectDownloadButton();
    }, 1000);
  }
}

// Start URL change monitoring
if (!urlCheckInterval) {
  urlCheckInterval = setInterval(checkUrlChange, 500);
}

// Start periodic data verification (every 3 seconds)
if (!dataCheckInterval) {
  dataCheckInterval = setInterval(verifyButtonData, 3000);
}

// Also listen to history API changes (for SPA navigation)
if (window.history && window.history.pushState) {
  const originalPushState = window.history.pushState;
  window.history.pushState = function(...args) {
    originalPushState.apply(window.history, args);
    setTimeout(checkUrlChange, 100);
  };
  
  const originalReplaceState = window.history.replaceState;
  window.history.replaceState = function(...args) {
    originalReplaceState.apply(window.history, args);
    setTimeout(checkUrlChange, 100);
  };
  
  window.addEventListener('popstate', () => {
    setTimeout(checkUrlChange, 100);
  });
}

// Also try injecting when DOM changes (for SPA navigation)
const pageObserver = new MutationObserver(() => {
  // Check if extension context is valid before attempting injection
  if (!isExtensionContextValid()) {
    // Extension context invalidated - disconnect observer and stop
    pageObserver.disconnect();
    return;
  }
  
  // Only inject if button doesn't exist (prevent duplicates)
  if (!document.getElementById('vimeo-downloader-page-button-wrapper') && !isRefreshing) {
    // Small delay to avoid too frequent checks
    setTimeout(() => {
      // Check again before injecting (context might have been invalidated during delay)
      if (!isExtensionContextValid()) {
        pageObserver.disconnect();
        return;
      }
      if (!document.getElementById('vimeo-downloader-page-button-wrapper') && !isRefreshing) {
        injectDownloadButton();
      }
    }, 500);
  }
});

// Start observing after a delay
setTimeout(() => {
  if (document.body) {
    pageObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
}, 2000);

// Download notification system for webpage (supports multiple simultaneous downloads)
let notificationContainer = null;
let activeDownloads = new Map(); // Map of downloadId -> { filename, interval, element }

function createNotificationContainer() {
  // Only create notifications in the top frame, not in iframes
  if (window.self !== window.top) {
    console.log('Skipping notification container creation in iframe');
    return null;
  }
  
  // Check if container already exists in DOM first
  let existingContainer = document.getElementById('vimeo-downloader-notifications');
  if (existingContainer) {
    notificationContainer = existingContainer;
    return notificationContainer;
  }
  
  // Also check if we have a cached reference
  if (notificationContainer && document.body.contains(notificationContainer)) {
    return notificationContainer;
  }
  
  // Make sure body exists
  if (!document.body) {
    // Wait for body to be ready
    setTimeout(createNotificationContainer, 100);
    return null;
  }
  
  notificationContainer = document.createElement('div');
  notificationContainer.id = 'vimeo-downloader-notifications';
  notificationContainer.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 20px;
    z-index: 999999;
    width: 400px;
    max-width: 400px;
    max-height: calc(100vh - 40px);
    display: flex;
    flex-direction: column;
    gap: 12px;
    pointer-events: none;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 8px;
  `;
  
  // Add responsive styles for mobile
  if (!document.getElementById('vimeo-downloader-notification-responsive-style')) {
    const responsiveStyle = document.createElement('style');
    responsiveStyle.id = 'vimeo-downloader-notification-responsive-style';
    responsiveStyle.textContent = `
      @media (max-width: 600px) {
        #vimeo-downloader-notifications {
          width: calc(100vw - 40px) !important;
          max-width: calc(100vw - 40px) !important;
          left: 20px !important;
          right: 20px !important;
          bottom: 20px !important;
        }
        
        #vimeo-downloader-notifications > div[id^="download-notification-"] {
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          padding: 12px 16px !important;
          font-size: 13px !important;
        }
      }
    `;
    document.head.appendChild(responsiveStyle);
  }
  
  // Add custom scrollbar styling
  if (!document.getElementById('vimeo-downloader-scrollbar-style')) {
    const scrollbarStyle = document.createElement('style');
    scrollbarStyle.id = 'vimeo-downloader-scrollbar-style';
    scrollbarStyle.textContent = `
      #vimeo-downloader-notifications::-webkit-scrollbar {
        width: 6px;
      }
      #vimeo-downloader-notifications::-webkit-scrollbar-track {
        background: transparent;
      }
      #vimeo-downloader-notifications::-webkit-scrollbar-thumb {
        background: rgba(102, 126, 234, 0.5);
        border-radius: 3px;
      }
      #vimeo-downloader-notifications::-webkit-scrollbar-thumb:hover {
        background: rgba(102, 126, 234, 0.7);
      }
    `;
    document.head.appendChild(scrollbarStyle);
  }
  
  // Add animation style if not already added
  if (!document.getElementById('vimeo-downloader-notification-style')) {
    const style = document.createElement('style');
    style.id = 'vimeo-downloader-notification-style';
    style.textContent = `
      @keyframes slideInUp {
        from {
          transform: translateY(100px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
      @keyframes slideOutDown {
        from {
          transform: translateY(0);
          opacity: 1;
        }
        to {
          transform: translateY(100px);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(notificationContainer);
  console.log('Notification container created and appended to body');
  
  // Verify it was actually added
  const verify = document.getElementById('vimeo-downloader-notifications');
  if (!verify) {
    console.error('Notification container was not added to DOM!');
    return null;
  }
  
  return notificationContainer;
}

function showDownloadNotification(downloadId, filename, status, progress, qualityLabel = '') {
  // Only show notifications in the top frame, not in iframes
  if (window.self !== window.top) {
    console.log('Skipping notification display in iframe');
    return;
  }
  
  console.log('showDownloadNotification called:', { downloadId, filename, status, progress });
  try {
    __dmDebugState.lastShowNotification = {
      downloadId,
      filename,
      status,
      progress,
      qualityLabel,
      href: window.location.href,
      ts: new Date().toISOString(),
    };
    __dmDebugState.lastShowNotificationError = null;
  } catch (e) {
    // ignore
  }
  
  // Ensure body exists
  if (!document.body) {
    console.log('Document body not ready, waiting...');
    setTimeout(() => showDownloadNotification(downloadId, filename, status, progress, qualityLabel), 100);
    return;
  }
  
  const container = createNotificationContainer();
  
  if (!container) {
    console.error('Could not create notification container');
    setTimeout(() => showDownloadNotification(downloadId, filename, status, progress, qualityLabel), 200);
    return;
  }
  
  // Create individual notification element for this download
  let notificationEl = document.getElementById(`download-notification-${downloadId}`);
  if (!notificationEl) {
    notificationEl = document.createElement('div');
    notificationEl.id = `download-notification-${downloadId}`;
    notificationEl.style.cssText = `
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px 20px;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      animation: slideInUp 0.3s ease-out;
      pointer-events: auto;
      width: 400px;
      min-width: 400px;
      max-width: 400px;
      box-sizing: border-box;
    `;
    
    // Apply responsive width on mobile (will be overridden by the style tag, but set initial value)
    if (window.innerWidth <= 600) {
      notificationEl.style.width = '100%';
      notificationEl.style.minWidth = '0';
      notificationEl.style.maxWidth = '100%';
    }
    container.appendChild(notificationEl);
    console.log('Created notification element for download:', downloadId);
  }
  
  const progressBar = progress !== undefined ? `
    <div style="margin-top: 12px; background: rgba(255, 255, 255, 0.2); border-radius: 10px; height: 6px; overflow: hidden;">
      <div style="background: white; height: 100%; width: ${progress}%; transition: width 0.3s ease; border-radius: 10px;"></div>
    </div>
    <div style="margin-top: 8px; font-size: 12px; opacity: 0.9;">${progress}%</div>
  ` : '';
  
  // Show cancel button only if download is in progress (not complete or cancelled)
  const showCancelButton = progress !== undefined && progress < 100 && !status.includes('cancelled') && !status.includes('complete');
  const cancelButton = showCancelButton ? `
    <button id="cancel-btn-${downloadId}" style="
      margin-top: 12px;
      padding: 8px 16px;
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 6px;
      color: white;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      width: 100%;
    " onmouseover="this.style.background='rgba(255, 255, 255, 0.3)'" onmouseout="this.style.background='rgba(255, 255, 255, 0.2)'">
      ❌ Cancel Download
    </button>
  ` : '';
  
  // Extract just the quality part for display (e.g., "1080p" from "1080p (HLS)")
  const displayQuality = qualityLabel ? (qualityLabel.match(/(\d+p)/i) ? qualityLabel.match(/(\d+p)/i)[1] : qualityLabel.split(' ')[0]) : '';
  const qualityDisplay = displayQuality ? `<span style="opacity: 0.9; font-size: 12px; margin-left: 8px;">${displayQuality}</span>` : '';
  
  notificationEl.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
      <div style="font-size: 20px;">⬇️</div>
      <div style="flex: 1;">
        <div style="font-weight: 600; margin-bottom: 4px;">Download Started${qualityDisplay}</div>
        <div style="font-size: 12px; opacity: 0.9; word-break: break-word;">${filename}</div>
      </div>
    </div>
    <div style="font-size: 13px; opacity: 0.95; margin-top: 8px;">${status}</div>
    ${progressBar}
    ${cancelButton}
  `;
  
  // Add cancel button event listener if button exists
  // Use event delegation on the notification element to handle dynamically created buttons
  if (showCancelButton) {
    // Remove any existing listeners by cloning the element
    const cancelBtn = notificationEl.querySelector(`#cancel-btn-${downloadId}`);
    if (cancelBtn) {
      // Remove old listener by cloning
      const newCancelBtn = cancelBtn.cloneNode(true);
      cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
      
      newCancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('🚫 [CONTENT] Cancel button clicked for download:', downloadId);
        console.log('🚫 [CONTENT] Extension context valid:', isExtensionContextValid());
        
        // Stop polling immediately
        stopDownloadProgressPolling(downloadId);
        
        // Hide notification immediately
        hideDownloadNotification(downloadId);
        
        // Send cancel request to background (fire and forget)
        console.log('🚫 [CONTENT] Sending cancelDownload message with downloadId:', downloadId);
        safeSendMessage({
          action: 'cancelDownload',
          downloadId: downloadId
        }, (response) => {
          console.log('🚫 [CONTENT] Received response from cancelDownload:', response);
          if (response && response.success) {
            console.log('🚫 [CONTENT] ✅ Download cancellation confirmed');
          } else {
            console.warn('🚫 [CONTENT] ⚠️ Download cancellation may have failed:', response);
          }
        });
      });
    } else {
      console.warn('Cancel button not found for download:', downloadId);
    }
  }
  
  notificationEl.style.display = 'block';
  notificationEl.style.visibility = 'visible';
  notificationEl.style.opacity = '1';
  
  // Force visibility
  if (container) {
    container.style.display = 'flex';
    container.style.visibility = 'visible';
  }
  
  console.log('Notification displayed successfully:', downloadId, filename);
  console.log('Notification element:', notificationEl);
  console.log('Notification container:', container);
  
  // Verify it's actually visible
  setTimeout(() => {
    const checkEl = document.getElementById(`download-notification-${downloadId}`);
    if (checkEl) {
      const rect = checkEl.getBoundingClientRect();
      console.log('Notification position:', { top: rect.top, left: rect.left, width: rect.width, height: rect.height, visible: rect.width > 0 && rect.height > 0 });
    } else {
      console.error('Notification element not found in DOM after creation!');
    }
  }, 100);
}

function updateDownloadNotification(downloadId, filename, status, progress) {
  // Only update notifications in the top frame, not in iframes
  if (window.self !== window.top) {
    console.log('Skipping notification update in iframe');
    return;
  }
  
  // Ensure container exists
  const container = createNotificationContainer();
  if (!container) {
    console.error('Could not get/create notification container for update');
    return;
  }
  
  const notificationEl = document.getElementById(`download-notification-${downloadId}`);
  if (!notificationEl) {
    console.warn('Notification element not found, recreating:', downloadId);
    // Try to get qualityLabel from stored download info
    safeSendMessage({ action: 'getDownloadInfo', downloadId: downloadId }, (response) => {
      const qualityLabel = response?.info?.qualityLabel || '';
      showDownloadNotification(downloadId, filename, status, progress, qualityLabel);
    });
    return;
  }
  
  const progressBar = progress !== undefined ? `
    <div style="margin-top: 12px; background: rgba(255, 255, 255, 0.2); border-radius: 10px; height: 6px; overflow: hidden;">
      <div style="background: white; height: 100%; width: ${progress}%; transition: width 0.3s ease; border-radius: 10px;"></div>
    </div>
    <div style="margin-top: 8px; font-size: 12px; opacity: 0.9;">${progress}%</div>
  ` : '';
  
  const isCancelled = status && status.toLowerCase().includes('cancelled');
  const isFailed = status && (status.toLowerCase().includes('failed') || status.toLowerCase().includes('error'));
  const statusIcon = isCancelled ? '❌' : (isFailed ? '⚠️' : (progress === 100 ? '✅' : '⬇️'));
  const statusText = isCancelled ? 'Download Cancelled' : (isFailed ? 'Download Failed' : (progress === 100 ? 'Download Complete' : 'Downloading'));
  
  // Show cancel button only if download is in progress (not complete, cancelled, or failed)
  const showCancelButton = progress !== undefined && progress < 100 && !isCancelled && !isFailed && !status.includes('complete');
  // Show dismiss button for failed or cancelled downloads
  const showDismissButton = isFailed || isCancelled;
  
  const cancelButton = showCancelButton ? `
    <button id="cancel-btn-${downloadId}" style="
      margin-top: 12px;
      padding: 8px 16px;
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 6px;
      color: white;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      width: 100%;
    " onmouseover="this.style.background='rgba(255, 255, 255, 0.3)'" onmouseout="this.style.background='rgba(255, 255, 255, 0.2)'">
      ❌ Cancel Download
    </button>
  ` : '';
  
  const dismissButton = showDismissButton ? `
    <button id="dismiss-btn-${downloadId}" style="
      margin-top: 12px;
      padding: 8px 16px;
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 6px;
      color: white;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      width: 100%;
    " onmouseover="this.style.background='rgba(255, 255, 255, 0.3)'" onmouseout="this.style.background='rgba(255, 255, 255, 0.2)'">
      ✕ Dismiss
    </button>
  ` : '';
  
  notificationEl.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
      <div style="font-size: 20px;">${statusIcon}</div>
      <div style="flex: 1;">
        <div style="font-weight: 600; margin-bottom: 4px;">${statusText}</div>
        <div style="font-size: 12px; opacity: 0.9; word-break: break-word;">${filename}</div>
      </div>
    </div>
    <div style="font-size: 13px; opacity: 0.95; margin-top: 8px;">${status}</div>
    ${progressBar}
    ${cancelButton}
    ${dismissButton}
  `;
  
  // Add cancel button event listener if button exists
  if (showCancelButton) {
    const cancelBtn = notificationEl.querySelector(`#cancel-btn-${downloadId}`);
    if (cancelBtn) {
      // Remove existing listener by cloning
      const newCancelBtn = cancelBtn.cloneNode(true);
      cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
      
      newCancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Cancel button clicked for download:', downloadId);
        // Check current status first
        safeStorageGet([`downloadStatus_${downloadId}`], (result) => {
          const currentStatus = result[`downloadStatus_${downloadId}`] || '';
          const isFailedOrCancelled = currentStatus.toLowerCase().includes('failed') || 
                                     currentStatus.toLowerCase().includes('error') || 
                                     currentStatus.toLowerCase().includes('cancelled');
          
          if (isFailedOrCancelled) {
            // Download already failed/cancelled, just hide the notification
            hideDownloadNotification(downloadId);
            return;
          }
          
          // Stop polling immediately
          stopDownloadProgressPolling(downloadId);
          
          // Hide notification immediately
          hideDownloadNotification(downloadId);
          
          // Try to cancel the download (fire and forget)
          safeSendMessage({
            action: 'cancelDownload',
            downloadId: downloadId
          }, (response) => {
            if (response && response.success) {
              console.log('Download cancellation confirmed');
            } else {
              console.warn('Download cancellation may have failed:', response);
            }
          });
        });
      });
    } else {
      console.warn('Cancel button not found in updateNotification for download:', downloadId);
    }
  }
  
  // Add dismiss button event listener if button exists
  if (showDismissButton) {
    const dismissBtn = document.getElementById(`dismiss-btn-${downloadId}`);
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        console.log('Dismiss button clicked for download:', downloadId);
        hideDownloadNotification(downloadId);
      });
    }
  }
}

function hideDownloadNotification(downloadId) {
  const notificationEl = document.getElementById(`download-notification-${downloadId}`);
  if (notificationEl) {
    notificationEl.style.animation = 'slideOutDown 0.3s ease-out';
    setTimeout(() => {
      if (notificationEl && notificationEl.parentNode) {
        notificationEl.parentNode.removeChild(notificationEl);
      }
      activeDownloads.delete(downloadId);
    }, 300);
  }
}

// Helper function to check if extension context is still valid
function isExtensionContextValid() {
  try {
    // Try to access chrome.runtime.id - if context is invalid, this will throw
    return chrome.runtime && chrome.runtime.id !== undefined;
  } catch (e) {
    return false;
  }
}

function startDownloadProgressPolling(downloadId, filename) {
  // Don't start if already polling for this download
  if (activeDownloads.has(downloadId)) return;
  
  // Check if extension context is valid before starting
  if (!isExtensionContextValid()) {
    console.warn('Extension context invalidated, cannot start polling');
    return;
  }
  
  // Check immediately
  const checkProgress = () => {
    // Check if extension context is still valid - stop immediately if invalidated
    if (!isExtensionContextValid()) {
      // Stop polling silently - extension was reloaded
      stopDownloadProgressPolling(downloadId);
      return;
    }
    
    // Check if this download is still being tracked (might have been stopped already)
    if (!activeDownloads.has(downloadId)) {
      // Polling was already stopped, don't continue
      return;
    }
    
    // Use safe storage access
    safeStorageGet([`downloadProgress_${downloadId}`, `downloadStatus_${downloadId}`], (result) => {
      // Check again if extension context is still valid after async operation
      if (!isExtensionContextValid()) {
        stopDownloadProgressPolling(downloadId);
        return;
      }
      
      // Check again if download is still being tracked
      if (!activeDownloads.has(downloadId)) {
        return;
      }
      if (!result) {
        console.warn('No result from storage for download:', downloadId);
        return;
      }
      
      const progress = result[`downloadProgress_${downloadId}`];
      const status = result[`downloadStatus_${downloadId}`];
      
      // Verify notification element still exists
      const notificationEl = document.getElementById(`download-notification-${downloadId}`);
      if (!notificationEl) {
        // Check if download still exists before recreating
        const downloadInfo = activeDownloads.get(downloadId);
        if (!downloadInfo) {
          // Polling was stopped, don't recreate - this is normal when download completes
          return;
        }
        
        // Check if we're still on a video page and container exists before recreating
        if (!isVideoPage() || !document.getElementById('vimeo-downloader-notifications')) {
          // Page navigated away or container removed, stop polling silently
          stopDownloadProgressPolling(downloadId);
          return;
        }
        
        // Check if download exists in background and is still active
        safeSendMessage({ action: 'getDownloadInfo', downloadId: downloadId }, (response) => {
          if (response && response.info) {
            // Check if download is complete
            safeStorageGet([`downloadProgress_${downloadId}`, `downloadStatus_${downloadId}`], (progressResult) => {
              const downloadProgress = progressResult[`downloadProgress_${downloadId}`];
              const downloadStatus = progressResult[`downloadStatus_${downloadId}`] || '';
              
              // If download is complete or failed, don't recreate notification
              if (downloadProgress === 100 || downloadStatus.toLowerCase().includes('complete') || 
                  downloadStatus.toLowerCase().includes('failed') || downloadStatus.toLowerCase().includes('cancelled')) {
                console.log('Download completed/failed, stopping polling:', downloadId);
                stopDownloadProgressPolling(downloadId);
                return;
              }
              
              // Download exists and is still active, recreate notification (but limit recreations)
              if (!downloadInfo.recreationCount) {
                downloadInfo.recreationCount = 0;
              }
              downloadInfo.recreationCount++;
              
              // Only recreate a few times to prevent loops
              if (downloadInfo.recreationCount <= 3) {
                // Use console.log instead of console.warn - this is often normal (DOM mutations, etc.)
                console.log('Notification element missing during polling, recreating:', downloadId, `(attempt ${downloadInfo.recreationCount}/3)`);
                showDownloadNotification(downloadId, filename, status || 'Preparing download...', progress || 0);
              } else {
                // Too many recreations - might be a persistent DOM issue, stop silently
                console.log('Too many notification recreations, stopping polling:', downloadId);
                stopDownloadProgressPolling(downloadId);
              }
            });
          } else {
            // Download doesn't exist, stop polling
            console.log('Download not found in background, stopping polling:', downloadId);
            stopDownloadProgressPolling(downloadId);
          }
        });
        return;
      }
      
      // Reset recreation count and polling failures if notification exists
      const downloadInfo = activeDownloads.get(downloadId);
      if (downloadInfo) {
        downloadInfo.recreationCount = 0;
        if (downloadInfo.pollingFailures > 0) {
          downloadInfo.pollingFailures = 0;
        }
      }
      
      if (progress !== undefined && progress !== null) {
        updateDownloadNotification(downloadId, filename, status || 'Preparing download...', progress);
        
        // Check if download is complete (progress 100 or status includes "complete")
        const isComplete = progress === 100 || (status && status.toLowerCase().includes('complete'));
        
        if (isComplete) {
          // Download complete - stop polling immediately
          stopDownloadProgressPolling(downloadId);
          // Hide notification after delay (but polling is already stopped)
          setTimeout(() => {
            hideDownloadNotification(downloadId);
          }, 3000);
          return;
        }
        
        // Check if cancelled or failed
        if (status && (status.toLowerCase().includes('cancelled') || status.toLowerCase().includes('failed') || status.toLowerCase().includes('error'))) {
          // Download was cancelled or failed, stop polling but keep notification visible with dismiss button
          stopDownloadProgressPolling(downloadId);
          // Update notification one more time to show dismiss button
          updateDownloadNotification(downloadId, filename, status, progress);
          return;
        }
      } else {
        // No progress data - check if download still exists in background
        const downloadInfo = activeDownloads.get(downloadId);
        if (!downloadInfo) {
          // Download info not found - might be completed/cleaned up, stop polling silently
          console.log('Download info not found (likely completed), stopping polling:', downloadId);
          stopDownloadProgressPolling(downloadId);
          return;
        }
        
        // Check if download still exists in background script
        safeSendMessage({ action: 'getDownloadInfo', downloadId: downloadId }, (response) => {
          if (!response || !response.info) {
            // Download doesn't exist in background, stop polling
            console.log('Download not found in background script, stopping polling:', downloadId);
            stopDownloadProgressPolling(downloadId);
            // Hide notification if it exists
            const notificationEl = document.getElementById(`download-notification-${downloadId}`);
            if (notificationEl) {
              hideDownloadNotification(downloadId);
            }
            return;
          }
          
          // Download exists but no progress data - might be a temporary storage issue
          // Track polling failures
          if (!downloadInfo.pollingFailures) {
            downloadInfo.pollingFailures = 0;
          }
          downloadInfo.pollingFailures++;
          
          if (downloadInfo.pollingFailures > 10) {
            // Too many failures, stop polling but keep notification
            console.warn('Multiple polling failures (no progress data), stopping polling but keeping notification:', downloadId);
            stopDownloadProgressPolling(downloadId);
            // Update notification to show "Waiting for progress..."
            updateDownloadNotification(downloadId, filename, 'Waiting for progress update...', undefined);
          } else {
            // Temporary issue, continue polling (only log every 5th attempt to reduce noise)
            if (downloadInfo.pollingFailures % 5 === 0) {
              console.log(`No progress data yet (attempt ${downloadInfo.pollingFailures}/10) for download:`, downloadId);
            }
          }
        });
      }
    });
  };
  
  checkProgress();
  
  // Poll every 500ms
  const interval = setInterval(checkProgress, 500);
  activeDownloads.set(downloadId, { filename, interval, element: null, pollingFailures: 0 });
}

function stopDownloadProgressPolling(downloadId) {
  const download = activeDownloads.get(downloadId);
  if (download && download.interval) {
    clearInterval(download.interval);
  }
  activeDownloads.delete(downloadId);
}

// Listen for messages from background script to handle blob downloads
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request.action, request);
  
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
            showDownloadNotification(downloadId, filename, status, progress, qualityLabel);
            startDownloadProgressPolling(downloadId, filename);
          } else {
            // No progress data yet, show initial notification
            showDownloadNotification(downloadId, filename, 'Preparing download...', 0, qualityLabel);
            startDownloadProgressPolling(downloadId, filename);
          }
        });
      } else {
        // New download
        // Ensure body is ready
        if (!document.body) {
          console.log('Waiting for document.body...');
          setTimeout(() => {
            console.log('Retrying notification after body ready');
            showDownloadNotification(downloadId, filename, 'Preparing download...', 0, qualityLabel);
            startDownloadProgressPolling(downloadId, filename);
          }, 100);
        } else {
          console.log('Body ready, showing notification immediately');
          showDownloadNotification(downloadId, filename, 'Preparing download...', 0, qualityLabel);
          startDownloadProgressPolling(downloadId, filename);
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
    stopDownloadProgressPolling(downloadId);
    
    // Update notification to show completion
    updateDownloadNotification(downloadId, filename, 'Download complete!', 100);
    
    // Hide after delay
    setTimeout(() => {
      hideDownloadNotification(downloadId);
    }, 3000);
    
    sendResponse({ success: true });
    return true;
  }
  
  // Handle download cancellation notification
  if (request.action === 'downloadCancelled') {
    console.log('Download cancelled notification received:', request.downloadId);
    const downloadId = request.downloadId;
    
    // Stop polling immediately
    stopDownloadProgressPolling(downloadId);
    
    // Hide notification immediately
    hideDownloadNotification(downloadId);
    
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
    
    return true; // Keep channel open for async response s
  }
  return false;
});