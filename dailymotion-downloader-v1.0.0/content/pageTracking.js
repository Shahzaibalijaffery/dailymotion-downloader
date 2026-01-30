/**
 * Page tracking and URL monitoring module
 * Handles URL changes, video ID tracking, and button data verification
 */

// Track URL changes to remove and re-inject button on navigation
let lastUrl = window.location.href;
let lastVideoId = null;
let urlCheckInterval = null;
let dataCheckInterval = null;
let isRefreshing = false; // Prevent multiple simultaneous refreshes

/**
 * Get current video ID from URL
 * @returns {string|null} Video ID or null
 */
function getCurrentVideoId() {
  try {
    const videoIdMatch = window.location.pathname.match(/\/video\/([a-zA-Z0-9]+)/);
    return videoIdMatch ? videoIdMatch[1] : null;
  } catch (e) {
    return null;
  }
}

/**
 * Extract video title from webpage DOM
 * @returns {string|null} Video title or null
 */
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

/**
 * Stop URL/data intervals when not on video page to reduce CPU and avoid leaks
 */
function stopPageTrackingIntervals() {
  if (urlCheckInterval) {
    clearInterval(urlCheckInterval);
    urlCheckInterval = null;
  }
  if (dataCheckInterval) {
    clearInterval(dataCheckInterval);
    dataCheckInterval = null;
  }
  if (typeof clearSeenUrls === 'function') {
    clearSeenUrls();
  }
}

/**
 * Check for URL changes and re-inject button if needed
 */
function checkUrlChange() {
  const currentUrl = window.location.href;
  
  // Stop intervals when not on video page to reduce memory/CPU
  if (!isVideoPage()) {
    stopPageTrackingIntervals();
    return;
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
    
    // COMPLETELY destroy button and all associated data to prevent stale data
    if (typeof destroyDownloadButton === 'function') {
      destroyDownloadButton();
    } else {
      // Fallback: Remove button wrapper if destroyDownloadButton is not available
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
    }
    
    // Re-inject button with fresh data after a delay (to allow new video data to be detected)
    // Use longer delay to ensure new video data is available
    setTimeout(() => {
      isRefreshing = false;
      // Only re-inject if we're still on a video page
      if (isVideoPage()) {
        startPageTrackingIntervals(); // Ensure intervals run on video page
        if (typeof injectDownloadButton === 'function') {
          injectDownloadButton();
        }
        // Also restore active downloads when video is detected (in case of page refresh)
        if (typeof resetRestoreRetryCount === 'function') {
          resetRestoreRetryCount();
        }
        setTimeout(() => {
          if (typeof restoreActiveDownloads === 'function') {
            restoreActiveDownloads();
          }
        }, 1000);
      }
    }, 2500);
  } else {
    // Same URL/video - ensure intervals are running when on video page
    startPageTrackingIntervals();
  }
}

/**
 * DISABLED: Clean up downloads that belong to a specific video (when navigating away)
 * This function is disabled because users should see ALL active downloads regardless of which video page they're on
 * Downloads will only be hidden when they complete, fail, or are cancelled
 * @param {string} videoId - Video ID
 */
function cleanupDownloadsForVideo(videoId) {
  // Function disabled - do not clean up downloads when navigating
  // Users should see all active downloads even when navigating between videos
  const originalConsoleLog = console.log;
  originalConsoleLog('ℹ️ cleanupDownloadsForVideo called but disabled - downloads persist across navigation:', videoId);
  return;
}

/**
 * Periodic check to verify button has correct data for current video
 */
function verifyButtonData() {
  if (!isVideoPage()) return; // Skip when not on video page (intervals may still be running briefly)
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
      const DEBUG = false; // Can be made configurable
      if (DEBUG) console.log('Video title mismatch detected, refreshing button:', currentVideoTitle, 'vs', storedVideoTitle);
    }
  } else if (currentVideoId && storedVideoId && currentVideoId !== storedVideoId) {
    // Fallback to video ID check if title not available
    shouldRefresh = true;
    const DEBUG = false;
    if (DEBUG) console.log('Video ID mismatch detected, refreshing button:', currentVideoId, 'vs', storedVideoId);
  }
  
  if (shouldRefresh) {
    isRefreshing = true;
    // Completely destroy button to prevent stale data
    if (typeof destroyDownloadButton === 'function') {
      destroyDownloadButton();
    } else {
      // Fallback: just remove wrapper
      buttonWrapper.remove();
    }
    setTimeout(() => {
      isRefreshing = false;
      if (typeof injectDownloadButton === 'function') {
        injectDownloadButton();
      }
    }, 1000);
  }
}

/**
 * Start URL and data check intervals (only when on video page)
 */
function startPageTrackingIntervals() {
  if (!isVideoPage()) return;
  if (!urlCheckInterval) {
    urlCheckInterval = setInterval(checkUrlChange, 500);
  }
  if (!dataCheckInterval) {
    dataCheckInterval = setInterval(verifyButtonData, 3000);
  }
}

/**
 * Initialize page tracking
 */
function initializePageTracking() {
  // Start intervals only when on video page (stopped when leaving video page)
  startPageTrackingIntervals();

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

  // When tab is hidden, stop intervals to save memory/CPU; restart when visible on video page
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPageTrackingIntervals();
    } else if (isVideoPage()) {
      startPageTrackingIntervals();
    }
  });

  // Do NOT observe all DOM mutations to trigger injection: Dailymotion is a React SPA.
  // Firing inject on every mutation caused React hydration errors (#418/#423) and broken UI.
  // Injection is handled by: (1) delayed initial inject in content.js, (2) checkUrlChange on navigation.
}
