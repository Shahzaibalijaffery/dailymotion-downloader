// Popup script
// Utility functions are loaded via popup.html before this script

let currentTabId = null;
let currentVideoId = null;
let currentUrl = null;
let isLoading = false;
let latestVideoData = null; // last data received from background (used by download button)
let refreshInterval = null;
let navigationCheckInterval = null;

// Retry configuration for slow internet
const RETRY_CONFIG = {
  MAX_RETRIES: 15, // Increased for slow internet
  INITIAL_DELAY: 1000, // 1 second
  MAX_DELAY: 5000, // 5 seconds max delay
  BACKOFF_MULTIPLIER: 1.3, // Exponential backoff
  PERIODIC_REFRESH_INTERVAL: 2000, // Check every 2 seconds for lazy loading
  NAVIGATION_CHECK_INTERVAL: 1000, // Check URL changes every second
};

let popupRetryCount = 0;
let popupRetryTimer = null;

// Initialize when popup opens
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs && tabs.length > 0 && tabs[0]) {
    initializePopup(tabs[0]);
  } else {
    showError("No active tab found. Please open a Dailymotion video page.");
  }
});

/**
 * Initialize popup with current tab
 */
function initializePopup(tab) {
  currentTabId = tab.id;
  currentUrl = tab.url;
  currentVideoId = extractVideoId(tab.url);

  console.log("Popup initialized:", {
    tabId: currentTabId,
    url: currentUrl,
    videoId: currentVideoId,
  });

  // Start loading video data
  loadVideoData(true);

  // Set up periodic refresh for lazy loading (videos that load after popup opens)
  setupPeriodicRefresh();

  // Set up navigation detection (detect URL changes while popup is open)
  setupNavigationDetection();

  // Clean up when popup is hidden (user switched tab or closed popup) to free memory
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cleanup();
  });

  // Fallback: clean up after 2 minutes max
  setTimeout(() => {
    cleanup();
  }, 120000);
}

/**
 * Load video data from background script
 * Always queries for fresh tab data to handle navigation
 */
function loadVideoData(showLoading = true, forceRefresh = false) {
  // Prevent multiple simultaneous loads
  if (isLoading && !forceRefresh) {
    console.log("Already loading, skipping duplicate request");
    return;
  }

  // Clear any existing retry timer
  if (popupRetryTimer) {
    clearTimeout(popupRetryTimer);
    popupRetryTimer = null;
  }

  // Always query for active tab to get current URL (handles navigation)
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) {
      showError("No active tab found.");
      return;
    }

    const tab = tabs[0];
    const newUrl = tab.url;
    const newVideoId = extractVideoId(newUrl);

    // Check if URL changed (navigation detected)
    if (currentUrl !== newUrl) {
      console.log("Navigation detected:", {
        old: currentUrl,
        new: newUrl,
        oldVideoId: currentVideoId,
        newVideoId: newVideoId,
      });
      currentUrl = newUrl;
      currentVideoId = newVideoId;
      currentTabId = tab.id;
      // Reset retry count on navigation
      popupRetryCount = 0;
    } else if (currentTabId !== tab.id) {
      // Tab ID changed (tab was switched)
      currentTabId = tab.id;
      currentUrl = newUrl;
      currentVideoId = newVideoId;
      popupRetryCount = 0;
    }

    // Show loading state
    if (showLoading && popupRetryCount === 0) {
      showLoadingState();
    }

    isLoading = true;

    // Request content script to actively detect videos (for lazy loading scenarios)
    requestVideoDetection(currentTabId);

    // Wake up service worker and get video data
    wakeServiceWorkerAndGetData(currentTabId, newVideoId);
  });
}

/**
 * Request content script to actively detect videos
 * This helps with lazy loading scenarios where videos load after page load
 */
function requestVideoDetection(tabId) {
  // Send message to content script to trigger video extraction
  chrome.tabs.sendMessage(
    tabId,
    { action: "triggerVideoExtraction", reason: "popup-request" },
    (response) => {
      if (chrome.runtime.lastError) {
        // Content script might not be ready yet, that's okay
        console.log(
          "Could not request video detection:",
          chrome.runtime.lastError.message,
        );
      } else {
        console.log("Video detection requested:", response);
      }
    },
  );
}

/**
 * Wake up service worker and get video data
 */
function wakeServiceWorkerAndGetData(tabId, expectedVideoId) {
  // Step 1: Ping service worker to wake it up
  chrome.runtime.sendMessage({ action: "ping" }, (pingResponse) => {
    // Step 2: Get video data
    chrome.runtime.sendMessage(
      { action: "getVideoData", tabId: tabId },
      (response) => {
        isLoading = false;

        if (chrome.runtime.lastError) {
          handleError(chrome.runtime.lastError.message);
          return;
        }

        if (!response) {
          handleError("No response from background script");
          return;
        }

        const videoData = response.videoData || { urls: [] };
        latestVideoData = videoData;

        // Check if we have videos for current page
        const hasVideos = videoData.urls && videoData.urls.length > 0;
        const hasCurrentPageVideos =
          hasVideos && hasVideosForCurrentPage(videoData, expectedVideoId);

        // If no videos or no videos for current page, retry with exponential backoff
        if (
          !hasCurrentPageVideos &&
          popupRetryCount < RETRY_CONFIG.MAX_RETRIES
        ) {
          handleRetry(expectedVideoId);
          return;
        }

        // Success - reset retry count and display videos
        popupRetryCount = 0;
        displayVideosWithTitle(videoData, tabId);
      },
    );
  });
}

/**
 * Check if video data has videos for the current page
 */
function hasVideosForCurrentPage(videoData, expectedVideoId) {
  if (!videoData.urls || videoData.urls.length === 0) {
    return false;
  }

  if (!expectedVideoId) {
    // If no video ID, check for very recent videos (within last 30 seconds)
    const now = Date.now();
    const recentThreshold = now - 30000;
    return videoData.urls.some(
      (v) => v.timestamp && v.timestamp > recentThreshold,
    );
  }

  // Check for videos matching current video ID
  const normalizedExpectedId = String(expectedVideoId);
  return videoData.urls.some((v) => {
    if (!v.videoId) return false;
    return String(v.videoId) === normalizedExpectedId;
  });
}

/**
 * Handle retry with exponential backoff
 */
function handleRetry(expectedVideoId) {
  popupRetryCount++;

  // Calculate delay with exponential backoff
  const delay = Math.min(
    RETRY_CONFIG.INITIAL_DELAY *
      Math.pow(RETRY_CONFIG.BACKOFF_MULTIPLIER, popupRetryCount - 1),
    RETRY_CONFIG.MAX_DELAY,
  );

  // Show retry message
  const container = document.getElementById("videoList");
  if (container) {
    container.innerHTML = `
      <div class="no-videos">
        <div class="no-videos-icon">⏳</div>
        <h3>Detecting Videos...</h3>
        <p>No videos detected yet. Retrying... (${popupRetryCount}/${RETRY_CONFIG.MAX_RETRIES})</p>
        <p>This may take a moment on slow connections.</p>
        <p style="font-size: 11px; color: #666; margin-top: 8px;">
          ${
            popupRetryCount <= 3
              ? "⏱️ Waiting for page to load..."
              : popupRetryCount <= 8
                ? "🔄 Checking for videos..."
                : "🌐 Slow connection detected, please wait..."
          }
        </p>
      </div>
    `;
  }

  // Schedule retry
  popupRetryTimer = setTimeout(() => {
    // Request fresh detection before retry
    requestVideoDetection(currentTabId);
    loadVideoData(false, true);
  }, delay);
}

/**
 * Display videos with title fetching
 */
function displayVideosWithTitle(videoData, tabId) {
  // Get title from tab if not available or generic
  if (
    !videoData.videoTitle ||
    videoData.videoTitle === "Dailymotion Video" ||
    videoData.videoTitle.toLowerCase().includes("dailymotion video player")
  ) {
    chrome.tabs.get(tabId, (tab) => {
      if (!chrome.runtime.lastError && tab && tab.title) {
        const title = cleanVideoTitle(tab.title);
        if (title) {
          videoData.videoTitle = title;
        }
      }
      displayVideos(videoData);
    });
  } else {
    displayVideos(videoData);
  }
}

/**
 * Show loading state
 */
function showLoadingState() {
  const container = document.getElementById("videoList");
  if (container) {
    container.innerHTML = `
      <div class="no-videos">
        <div class="no-videos-icon">⏳</div>
        <h3>Loading Video Data...</h3>
        <p>Please wait while we detect video URLs.</p>
        <p>If the page is still loading, this may take a moment.</p>
      </div>
    `;
  }
}

/**
 * Handle errors
 */
function handleError(errorMsg) {
  isLoading = false;
  const container = document.getElementById("videoList");
  if (container) {
    const isConnectionError =
      errorMsg.includes("Could not establish connection") ||
      errorMsg.includes("Receiving end does not exist");

    container.innerHTML = `
      <div class="no-videos">
        <div class="no-videos-icon">⚠️</div>
        <h3>${isConnectionError ? "Service Worker Not Running" : "Connection Error"}</h3>
        <p>${isConnectionError ? "The extension service worker is not running." : `Error: ${errorMsg}`}</p>
        <p>Please:</p>
        <ol>
          <li>Reload the extension (chrome://extensions → Reload)</li>
          <li>Refresh this Dailymotion page</li>
          <li>Click the refresh button below</li>
        </ol>
        <button class="refresh-btn" onclick="window.loadVideoData(true, true)">🔄 Refresh</button>
      </div>
    `;
  }
  popupRetryCount = 0;
}

/**
 * Show error message
 */
function showError(message) {
  const container = document.getElementById("videoList");
  if (container) {
    container.innerHTML = `
      <div class="no-videos">
        <div class="no-videos-icon">⚠️</div>
        <h3>Error</h3>
        <p>${message}</p>
        <button class="refresh-btn" onclick="window.loadVideoData(true, true)">🔄 Retry</button>
      </div>
    `;
  }
}

/**
 * Set up periodic refresh for lazy loading
 */
function setupPeriodicRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }

  refreshInterval = setInterval(() => {
    const container = document.getElementById("videoList");
    if (!container) return;

    // Only refresh if showing "no videos" or "loading" state
    const hasNoVideos = container.querySelector(".no-videos");
    if (
      hasNoVideos &&
      popupRetryCount < RETRY_CONFIG.MAX_RETRIES &&
      !isLoading
    ) {
      // Silently refresh (don't show loading again)
      loadVideoData(false, true);
    }
  }, RETRY_CONFIG.PERIODIC_REFRESH_INTERVAL);
}

/**
 * Set up navigation detection
 */
function setupNavigationDetection() {
  if (navigationCheckInterval) {
    clearInterval(navigationCheckInterval);
  }

  navigationCheckInterval = setInterval(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0 && tabs[0]) {
        const tab = tabs[0];
        const newUrl = tab.url;
        const newVideoId = extractVideoId(newUrl);

        // If URL or video ID changed, reload data
        if (newUrl !== currentUrl || newVideoId !== currentVideoId) {
          console.log("Navigation detected in popup:", {
            oldUrl: currentUrl,
            newUrl: newUrl,
            oldVideoId: currentVideoId,
            newVideoId: newVideoId,
          });
          // Reset and reload
          popupRetryCount = 0;
          loadVideoData(true, true);
        }
      }
    });
  }, RETRY_CONFIG.NAVIGATION_CHECK_INTERVAL);
}

/**
 * Cleanup intervals and release large refs to avoid memory retention
 */
function cleanup() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
  if (navigationCheckInterval) {
    clearInterval(navigationCheckInterval);
    navigationCheckInterval = null;
  }
  if (popupRetryTimer) {
    clearTimeout(popupRetryTimer);
    popupRetryTimer = null;
  }
  latestVideoData = null;
}

// Make loadVideoData available globally for refresh buttons
window.loadVideoData = loadVideoData;

// Rest of the file continues with displayVideos and other functions...
// [Previous displayVideos function and all other functions remain the same]

function displayVideos(videoData) {
  const container = document.getElementById("videoList");

  if (!videoData || !videoData.urls || videoData.urls.length === 0) {
    container.innerHTML = `
      <div class="no-videos">
        <div class="no-videos-icon">🎬</div>
        <h3>No Videos Detected</h3>
        <p>No video URLs detected yet.</p>
        <p>Play the video on Dailymotion and wait a moment for detection.</p>
      </div>
    `;
    return;
  }

  // Filter out unreliable or non-video URLs FIRST
  // Only show actual video sources: progressive MP4s from master.json or HLS variants (not master playlists)
  const reliableUrls = videoData.urls.filter((v) => {
    // Hide mp4-full - they're extracted from range URLs and often incomplete
    if (v.type.includes("mp4-full")) {
      return false;
    }
    // Hide config files - they're JSON metadata, not video files
    // (The extension already parses them automatically in the background)
    if (
      v.type === "config" ||
      v.url.includes("master.json") ||
      v.url.includes("config")
    ) {
      return false;
    }
    // Hide HLS master playlists - we show the parsed variants instead (hls-240p, hls-360p, etc.)
    // The master playlist is just a container that lists all quality options, not a specific quality
    if (v.type === "hls-master" || (v.type && v.type.includes("hls-master"))) {
      return false;
    }
    // Hide any HLS URL that doesn't have a specific quality (hls-240p, hls-360p, etc.)
    // These are either master playlists or unparsed HLS streams
    if (v.type && isHLS(v.type)) {
      // Using utility function
      // Check if this HLS URL has quality info in its type (using utility function)
      const quality = extractQuality(v.type, v.url);
      const hasQualityInType = quality !== null;
      if (!hasQualityInType) {
        // No quality info - hide it completely
        // This includes master playlists and any unparsed HLS streams
        return false;
      }
    }

    // Filter out files smaller than 300KB (using utility function)
    if (isFileTooSmall(v.fileSize)) {
      return false; // File is too small, skip it
    }
    // If fileSize is null/undefined (unknown), we still show it (HLS playlists don't have known size)

    // Show all video sources (progressive MP4s, HLS variants with specific qualities)
    // This includes hls-240p, hls-360p, hls-720p, etc. from parsed variants
    return true;
  });

  // If all URLs were filtered out, show "No Videos Detected"
  if (reliableUrls.length === 0) {
    container.innerHTML = `
      <div class="no-videos">
        <div class="no-videos-icon">🎬</div>
        <h3>No Videos Detected</h3>
        <p>No video URLs detected yet.</p>
        <p>Play the video on Dailymotion and wait a moment for detection.</p>
      </div>
    `;
    return;
  }

  // Get video title from videoData (fallback)
  const defaultVideoTitle = videoData.videoTitle || "Dailymotion Video";

  // Group videos by videoId (page/video)
  const videosByPage = {};

  reliableUrls.forEach((video) => {
    const videoId = video.videoId || "unknown";
    if (!videosByPage[videoId]) {
      videosByPage[videoId] = [];
    }
    videosByPage[videoId].push(video);
  });

  // Separate current page videos from all other pages
  let currentPageVideos = [];
  let allOtherPagesVideos = [];

  // Simple strategy: Videos matching currentVideoId are "Current Page", everything else is "Other Pages"
  const currentPageSet = new Set();
  const now = Date.now();
  const veryRecentThreshold = now - 30000; // 30 seconds - very recent videos are likely from current page

  if (currentVideoId) {
    // Normalize currentVideoId to string for comparison
    const normalizedCurrentVideoId = String(currentVideoId);

    // If we have a currentVideoId, only videos with that videoId are "Current Page"
    reliableUrls.forEach((v) => {
      // Normalize videoId to string for comparison
      const normalizedVideoId = v.videoId ? String(v.videoId) : null;
      if (normalizedVideoId === normalizedCurrentVideoId) {
        currentPageSet.add(v.url);
      }
    });

    // Fallback: If no videos matched currentVideoId, use very recent network request videos
    // This handles cases where videos are detected before videoId is set, or videoId extraction failed
    if (currentPageSet.size === 0) {
      const veryRecentVideos = reliableUrls
        .filter(
          (v) =>
            v.fromNetworkRequest &&
            v.timestamp &&
            v.timestamp > veryRecentThreshold,
        )
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      if (veryRecentVideos.length > 0) {
        // Add the most recent video and all videos with the same videoId (if any)
        const mostRecent = veryRecentVideos[0];
        currentPageSet.add(mostRecent.url);
        if (mostRecent.videoId) {
          reliableUrls.forEach((v) => {
            if (v.videoId === mostRecent.videoId) {
              currentPageSet.add(v.url);
            }
          });
        } else {
          // If no videoId, add other very recent videos (they're likely from the same page)
          veryRecentVideos.slice(0, 10).forEach((v) => {
            currentPageSet.add(v.url);
          });
        }
        console.log(
          "No videos matched currentVideoId, using very recent videos as fallback",
        );
      }
    }

    // Also include active videos (they're definitely from current page)
    const activeVideos = reliableUrls.filter((v) => v.active);
    activeVideos.forEach((v) => currentPageSet.add(v.url));
  } else {
    // If no currentVideoId, use active videos as fallback
    const activeVideos = reliableUrls.filter((v) => v.active);
    activeVideos.forEach((v) => currentPageSet.add(v.url));

    // If still no videos, use most recent network request video
    if (currentPageSet.size === 0) {
      const recentNetworkVideos = reliableUrls
        .filter((v) => v.fromNetworkRequest && v.timestamp)
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      if (recentNetworkVideos.length > 0) {
        const mostRecent = recentNetworkVideos[0];
        currentPageSet.add(mostRecent.url);
        // Add all videos with same videoId
        if (mostRecent.videoId) {
          reliableUrls.forEach((v) => {
            if (v.videoId === mostRecent.videoId) {
              currentPageSet.add(v.url);
            }
          });
        }
      }
    }
  }

  // Separate into current page and other pages
  currentPageVideos = reliableUrls.filter((v) => currentPageSet.has(v.url));
  allOtherPagesVideos = reliableUrls.filter((v) => !currentPageSet.has(v.url));

  container.innerHTML = "";

  // Function to render a section header
  const renderSectionHeader = (title, isFirst = false) => {
    const header = document.createElement("div");
    header.className = "section-header";
    header.style.cssText = `
      margin-top: ${isFirst ? "0" : "24px"};
      margin-bottom: 16px;
      padding: 12px 16px;
      background: #f8f9fa;
      border-left: 4px solid #667eea;
      border-radius: 6px;
    `;
    header.innerHTML = `
      <div style="font-size: 13px; font-weight: 600; color: #333;">
        ${title}
      </div>
    `;
    container.appendChild(header);
  };

  // Function to group videos by videoId (same video, different qualities)
  const groupVideosByVideoId = (videos) => {
    const grouped = {};
    videos.forEach((video) => {
      // Normalize videoId to string for consistent grouping
      // Use videoId as primary key, fallback to videoTitle, then 'unknown'
      const videoIdKey = video.videoId ? String(video.videoId) : null;
      const key = videoIdKey || video.videoTitle || "unknown";

      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(video);
    });

    return grouped;
  };

  // Function to sort and render videos
  const renderVideos = (videos) => {
    if (videos.length === 0) return;

    // Group videos by videoId (same video, different qualities)
    const groupedVideos = groupVideosByVideoId(videos);

    // Render each group (each unique video with its quality options)
    Object.keys(groupedVideos).forEach((videoKey) => {
      const videoGroup = groupedVideos[videoKey];

      // Sort qualities: prefer MP4 over HLS, then by quality
      const sortedQualities = videoGroup.sort((a, b) => {
        const aIsMP4 = isMP4(a.type); // Using utility function
        const bIsMP4 = isMP4(b.type); // Using utility function
        if (aIsMP4 && !bIsMP4) return -1;
        if (!aIsMP4 && bIsMP4) return 1;

        const qualityA = extractQuality(a.type, a.url) || 0;
        const qualityB = extractQuality(b.type, b.url) || 0;
        return qualityB - qualityA;
      });

      // Deduplicate by quality AND type: keep one MP4 and one HLS per quality
      // If multiple of the same type exist for same quality, keep the first one
      const uniqueQualities = new Map();
      sortedQualities.forEach((video) => {
        if (!video) return; // Skip invalid videos

        const quality = extractQuality(video.type, video.url);
        if (!quality) {
          // If quality can't be determined, still include it but use a fallback key
          // This prevents all videos from being filtered out
          const isMP4Type = isMP4(video.type); // Using utility function
          const isHLSType = isHLS(video.type); // Using utility function
          const typeKey = isMP4Type ? "MP4" : isHLSType ? "HLS" : "OTHER";
          const fallbackKey = `unknown-${typeKey}`;
          if (!uniqueQualities.has(fallbackKey)) {
            uniqueQualities.set(fallbackKey, video);
          }
          return;
        }

        const isMP4Type = isMP4(video.type); // Using utility function
        const isHLSType = isHLS(video.type); // Using utility function

        // Create a unique key: quality + type (e.g., "360p-MP4" or "360p-HLS")
        const typeKey = isMP4Type ? "MP4" : isHLSType ? "HLS" : "OTHER";
        const qualityKey = `${quality}p-${typeKey}`;

        // Only add if we don't already have this quality+type combination
        if (!uniqueQualities.has(qualityKey)) {
          uniqueQualities.set(qualityKey, video);
        }
        // If we already have this quality+type, skip (keep the first one)
      });

      // Convert map back to array and sort: prefer MP4 over HLS, then by quality (highest first)
      const deduplicatedQualities = Array.from(uniqueQualities.values()).sort(
        (a, b) => {
          if (!a || !b) return 0; // Safety check

          const aIsMP4 = isMP4(a.type); // Using utility function
          const bIsMP4 = isMP4(b.type); // Using utility function

          // Prefer MP4 over HLS
          if (aIsMP4 && !bIsMP4) return -1;
          if (!aIsMP4 && bIsMP4) return 1;

          // Same type, sort by quality
          const qualityA = extractQuality(a.type, a.url) || 0;
          const qualityB = extractQuality(b.type, b.url) || 0;
          return qualityB - qualityA;
        },
      );

      // Check if we have any videos after deduplication
      // If all were filtered out, use the original sortedQualities as fallback
      if (deduplicatedQualities.length === 0) {
        console.warn(
          "No videos after deduplication for videoKey:",
          videoKey,
          "- using original videoGroup as fallback",
        );
        if (videoGroup.length === 0) {
          return; // Skip this group if no videos at all
        }
        // Use original videoGroup as fallback
        deduplicatedQualities.push(...videoGroup.slice(0, 1)); // Use at least the first video
      }

      // Get the first video for title and default selection
      const firstVideo = deduplicatedQualities[0];

      // Safety check: ensure firstVideo exists and is valid
      if (!firstVideo) {
        console.warn("firstVideo is undefined for videoKey:", videoKey);
        return; // Skip this group if firstVideo is invalid
      }

      // Get title for this specific video - NEVER use defaultVideoTitle for other videos
      // Only use defaultVideoTitle if this video matches the current page's videoId
      let displayTitle = null;

      // Normalize videoId to string for lookup
      const videoIdForLookup = firstVideo.videoId
        ? String(firstVideo.videoId)
        : null;
      
      // Check if this video belongs to the current page
      const isCurrentPageVideo = currentVideoId && 
        videoIdForLookup && 
        String(currentVideoId) === videoIdForLookup;

      // Try to get title from videoId mapping first (most reliable)
      // This ensures each video group uses its own videoId's title
      if (videoIdForLookup && videoData.videoIds) {
        // Try both string and number key (in case of type mismatch)
        const titleFromMap =
          videoData.videoIds[videoIdForLookup]?.title ||
          videoData.videoIds[firstVideo.videoId]?.title;
        if (titleFromMap) {
          // Validate that the title is not generic before using it
          const lowerTitle = titleFromMap.toLowerCase();
          const isGeneric = titleFromMap === "Dailymotion Video" ||
            lowerTitle.includes("dailymotion video player") ||
            lowerTitle.match(/^(dailymotion|video|dailymotion video player|video player)$/i);
          if (!isGeneric) {
            displayTitle = titleFromMap;
          }
        }
      }

      // Fallback to video's own title (from the video object itself)
      if (!displayTitle) {
        // Try to find a video with a valid title in this group
        const videoWithTitle = deduplicatedQualities.find((v) => {
          if (!v || !v.videoTitle) return false;
          const lowerTitle = v.videoTitle.toLowerCase();
          // Accept any non-generic title
          return (
            v.videoTitle !== "Dailymotion Video" &&
            !lowerTitle.includes("dailymotion video player") &&
            !lowerTitle.match(
              /^(dailymotion|video|dailymotion video player|video player)$/i,
            )
          );
        });
        if (videoWithTitle) {
          displayTitle = videoWithTitle.videoTitle;
        } else if (firstVideo && firstVideo.videoTitle) {
          const lowerTitle = firstVideo.videoTitle.toLowerCase();
          if (
            firstVideo.videoTitle !== "Dailymotion Video" &&
            !lowerTitle.includes("dailymotion video player") &&
            !lowerTitle.match(
              /^(dailymotion|video|dailymotion video player|video player)$/i,
            )
          ) {
            displayTitle = firstVideo.videoTitle;
          }
        }
      }

      // ONLY use defaultVideoTitle as last resort AND only for current page videos
      // This prevents other videos from showing the wrong title
      if (!displayTitle) {
        if (isCurrentPageVideo) {
          displayTitle = defaultVideoTitle;
        } else {
          // For other videos, use a generic fallback instead of current page title
          displayTitle = "Dailymotion Video";
        }
      }

      // Create video item
      const item = document.createElement("div");
      item.className = "video-item";

      // Generate quality dropdown menu items
      // Use URL as primary identifier since object references might not match
      let qualityMenuItems = "";
      deduplicatedQualities.forEach((video, idx) => {
        if (!video || !video.url) return; // Skip invalid videos
        const qualityLabel = formatQualityLabel(video);
        // Find index by URL (more reliable than object reference)
        const videoIndex = videoData.urls.findIndex((v) => v.url === video.url);
        qualityMenuItems += `<div class="quality-menu-item" data-index="${idx}" data-url="${video.url}" data-video-index="${videoIndex >= 0 ? videoIndex : ""}">${qualityLabel}</div>`;
      });

      // Get default selected video (should exist due to check above, but add safety check)
      const defaultVideo = deduplicatedQualities[0];
      if (!defaultVideo) {
        console.warn("defaultVideo is undefined for videoKey:", videoKey);
        return; // Skip this group if defaultVideo is invalid
      }
      const defaultTypeLabel = formatTypeLabel(defaultVideo.type);
      const defaultShortUrl =
        defaultVideo.url.length > 80
          ? defaultVideo.url.substring(0, 80) + "..."
          : defaultVideo.url;
      const defaultQualityLabel = formatQualityLabel(defaultVideo);

      item.innerHTML = `
        <div class="video-header">
          <div>
            <div class="video-title">${displayTitle}</div>
          </div>
        </div>
        <div class="video-url" title="${defaultVideo.url}">${defaultShortUrl}</div>
      <div class="button-group">
          <div class="download-button-group">
            <button class="download-btn" data-url="${defaultVideo.url}" data-index="${videoData.urls.findIndex((v) => v.url === defaultVideo.url)}" data-quality-label="${defaultQualityLabel}" data-display-title="${displayTitle.replace(/"/g, '&quot;')}">
              Download
            </button>
            <button class="download-dropdown-btn" aria-label="Select quality">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
        </button>
            <div class="quality-dropdown-menu">
              ${qualityMenuItems}
            </div>
          </div>
          <button class="copy-btn" data-url="${defaultVideo.url}">
            Copy
        </button>
      </div>
    `;

      container.appendChild(item);

      // Get elements
      const videoUrlDiv = item.querySelector(".video-url");
      const downloadBtn = item.querySelector(".download-btn");
      const copyBtn = item.querySelector(".copy-btn");
      const dropdownBtn = item.querySelector(".download-dropdown-btn");
      const qualityMenu = item.querySelector(".quality-dropdown-menu");

      // Toggle dropdown menu
      if (dropdownBtn && qualityMenu) {
        dropdownBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          // Close all other dropdowns and remove their z-index
          document
            .querySelectorAll(".quality-dropdown-menu")
            .forEach((menu) => {
              if (menu !== qualityMenu) {
                menu.classList.remove("show");
                const otherItem = menu.closest(".video-item");
                if (otherItem) {
                  otherItem.classList.remove("dropdown-open");
                }
              }
            });
          const isShowing = qualityMenu.classList.contains("show");
          if (isShowing) {
            qualityMenu.classList.remove("show");
            item.classList.remove("dropdown-open");
          } else {
            qualityMenu.classList.add("show");
            item.classList.add("dropdown-open"); // Add class to video item for z-index
          }
        });
      }

      // Close dropdown when clicking outside
      document.addEventListener("click", (e) => {
        if (!item.contains(e.target)) {
          qualityMenu.classList.remove("show");
          item.classList.remove("dropdown-open");
        }
      });

      // Handle quality selection
      qualityMenu.querySelectorAll(".quality-menu-item").forEach((menuItem) => {
        menuItem.addEventListener("click", (e) => {
          e.stopPropagation();
          
          // Get URL directly from data attribute (most reliable)
          const selectedUrl = menuItem.dataset.url;
          if (!selectedUrl) {
            console.error("No URL found in quality menu item:", menuItem);
            return;
          }
          
          // Find the actual video object from videoData.urls by URL (more reliable than index)
          let selectedVideo = videoData.urls.find((v) => v.url === selectedUrl);
          if (!selectedVideo) {
            // Fallback: try using index from deduplicatedQualities
            const selectedIndex = parseInt(menuItem.dataset.index);
            if (selectedIndex >= 0 && selectedIndex < deduplicatedQualities.length) {
              const fallbackVideo = deduplicatedQualities[selectedIndex];
              if (fallbackVideo && fallbackVideo.url === selectedUrl) {
                // Found it in deduplicatedQualities, now find in videoData.urls by URL
                selectedVideo = videoData.urls.find((v) => v.url === selectedUrl);
              }
            }
            if (!selectedVideo) {
              console.error("Could not find video for URL:", selectedUrl);
              return;
            }
          }
          
          const qualityLabel = formatQualityLabel(selectedVideo);

          // Update displayed URL
          const shortUrl =
            selectedVideo.url.length > 80
              ? selectedVideo.url.substring(0, 80) + "..."
              : selectedVideo.url;
          videoUrlDiv.textContent = shortUrl;
          videoUrlDiv.title = selectedVideo.url;

          // Update button data attributes using the found video object
          downloadBtn.dataset.url = selectedVideo.url;
          // Preserve the display title (don't change it when selecting quality)
          // The display title is already stored in data-display-title attribute
          // Find index by URL (more reliable than object reference)
          const videoIndex = videoData.urls.findIndex((v) => v.url === selectedVideo.url);
          downloadBtn.dataset.index = videoIndex >= 0 ? videoIndex.toString() : "";
          downloadBtn.dataset.qualityLabel = qualityLabel;
          copyBtn.dataset.url = selectedVideo.url;

          // Update selected state in menu
          qualityMenu.querySelectorAll(".quality-menu-item").forEach((item) => {
            item.classList.remove("selected");
          });
          menuItem.classList.add("selected");

          // Close dropdown
          qualityMenu.classList.remove("show");
          item.classList.remove("dropdown-open");
        });
      });

      // Mark first quality as selected
      if (qualityMenu.querySelectorAll(".quality-menu-item").length > 0) {
        qualityMenu
          .querySelectorAll(".quality-menu-item")[0]
          .classList.add("selected");
      }
    });
  };

  // Show current page videos first (at the top)
  if (currentPageVideos.length > 0) {
    renderSectionHeader("Current Page", true);
    renderVideos(currentPageVideos);
  }

  // Show all other pages videos in one section (only if there are other pages)
  if (allOtherPagesVideos.length > 0) {
    renderSectionHeader("Other Pages", false);
    renderVideos(allOtherPagesVideos);
  }

  // Fallback: if no videos grouped by page, show all videos
  if (Object.keys(videosByPage).length === 0 && reliableUrls.length > 0) {
    renderVideos(reliableUrls);
  }

  // Add event listeners for all download buttons
  document.querySelectorAll(".download-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const url = e.target.dataset.url;
      const index = e.target.dataset.index;
      // Find the video item from videoData.urls
      const videoItem =
        videoData.urls.find((v) => v.url === url) ||
        (index !== undefined ? videoData.urls[index] : null);

      if (videoItem) {
        // Use the display title from the button (exactly what's shown in the list)
        // This ensures the downloaded file name matches what the user sees
        const videoTitle = e.target.dataset.displayTitle || 
          videoItem.videoTitle || 
          videoData.videoTitle || 
          "Dailymotion Video";
        // Get quality label from button if available
        const qualityLabel = e.target.dataset.qualityLabel || "";
        // Find index by URL (more reliable than object reference)
        const videoIndex = videoData.urls.findIndex((v) => v.url === url);
        downloadVideo(
          url,
          videoIndex >= 0 ? videoIndex : 0, // Fallback to 0 if not found
          videoItem.type,
          videoTitle,
          qualityLabel,
        );
      } else {
        console.error("Video item not found for URL:", url);
      }
    });
  });

  document.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const url = e.target.dataset.url;
      copyToClipboard(url);
      e.target.textContent = "Copied!";
      setTimeout(() => {
        e.target.textContent = "Copy";
      }, 2000);
    });
  });

  // Add event listeners for parse buttons
  document.querySelectorAll(".parse-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const url = e.target.dataset.url;
      parseConfigFile(url);
      e.target.textContent = "⏳ Parsing...";
      e.target.disabled = true;
    });
  });
}

function parseConfigFile(configUrl) {
  chrome.runtime.sendMessage(
    {
      action: "parseConfig",
      url: configUrl,
      tabId: currentTabId,
    },
    (response) => {
      if (response && response.success) {
        console.log("Config parsed, reloading video list...");
        setTimeout(() => {
          loadVideoData(true, true);
        }, 1000);
      } else {
        alert("Failed to parse config file. Check console for details.");
      }
    },
  );
}

function extractQuality(type, url = "") {
  // Try to extract from type first (e.g., "mp4-1080p", "hls-1080p", "hls-720p")
  let match = type.match(/(\d+)p/i);
  if (match) {
    return parseInt(match[1]);
  }

  // Try to extract from type without 'p' (e.g., "mp4-1080", "hls-1080", "hls-720")
  match = type.match(/-(\d+)$/);
  if (match) {
    return parseInt(match[1]);
  }

  // Try to extract from type with dash pattern (e.g., "hls-1080p", "hls-720p")
  match = type.match(/-(\d+)p?$/i);
  if (match) {
    return parseInt(match[1]);
  }

  // Try to extract from URL (some URLs contain quality info)
  if (url) {
    // Look for patterns like /1080p/, /720p/, /480p/, etc. in URL
    match = url.match(/\/(\d+)p/i);
    if (match) {
      return parseInt(match[1]);
    }

    // Look for patterns like /1080/, /720/, /480/ in URL path
    match = url.match(/\/(\d{3,4})(?:\/|$)/);
    if (match) {
      const num = parseInt(match[1]);
      // Only return if it's a reasonable quality value (240-4320)
      if (num >= 240 && num <= 4320 && num % 10 === 0) {
        return num;
      }
    }
  }

  return null; // Return null instead of 0 to indicate unknown
}

function formatTypeLabel(type) {
  if (type.includes("mp4")) {
    return type.toUpperCase();
  } else if (type.includes("m3u8") || type.includes("hls")) {
    return "HLS Stream";
  }
  return type.toUpperCase();
}

function downloadVideo(
  url,
  index,
  type,
  videoTitle = "Dailymotion Video",
  qualityLabel = "",
) {
  // Sanitize filename: remove invalid characters, limit length
  const sanitizeFilename = (name) => {
    // Remove invalid filename characters: / \ : * ? " < > |
    let sanitized = name.replace(/[\/\\:\*\?"<>\|]/g, "");
    // Remove leading/trailing spaces and dots
    sanitized = sanitized.trim().replace(/^\.+|\.+$/g, "");
    // Limit length to 200 characters (reasonable for most filesystems)
    if (sanitized.length > 200) {
      sanitized = sanitized.substring(0, 200);
    }
    // If empty after sanitization, use fallback
    return sanitized || "Dailymotion Video";
  };

  const sanitizedTitle = sanitizeFilename(videoTitle);
  const extension = getExtension(url);

  // Include quality in filename if available
  let filename;
  if (qualityLabel && qualityLabel.trim()) {
    // Extract just the quality part (e.g., "1080p" from "1080p (HLS)" or "1080p (MP4)")
    const qualityMatch = qualityLabel.match(/(\d+p)/i);
    const qualityPart = qualityMatch
      ? qualityMatch[1]
      : qualityLabel.split(" ")[0];
    filename = `${sanitizedTitle} - ${qualityPart}.${extension}`;
  } else {
    filename = `${sanitizedTitle}.${extension}`;
  }

  chrome.runtime.sendMessage(
    {
      action: "download",
      url: url,
      filename: filename,
      type: type,
      qualityLabel: qualityLabel,
      tabId: currentTabId,
      // Prefer the known videoId from captured data (avoids "fmp4" / other false IDs)
      videoId:
        latestVideoData &&
        latestVideoData.urls &&
        latestVideoData.urls[index] &&
        latestVideoData.urls[index].videoId
          ? latestVideoData.urls[index].videoId
          : undefined,
    },
    (downloadResponse) => {
      if (downloadResponse && downloadResponse.success) {
        console.log("Download started");
      } else if (downloadResponse && downloadResponse.error) {
        // Show user-friendly error message in popup
        const errorMsg = downloadResponse.error;
        if (errorMsg.includes("already being downloaded")) {
          showNotification(
            "⏳ Download in Progress",
            "This file is already being downloaded. Please wait for the current download to complete.",
            "warning",
          );
        } else {
          showNotification("Download Failed", errorMsg, "error");
        }
      }
    },
  );
}

// Show notification in popup (replaces alert)
function showNotification(title, message, type = "info") {
  const notificationArea = document.getElementById("notificationArea");
  if (!notificationArea) {
    console.error("Notification area not found");
    return;
  }

  // Clear any existing notification
  notificationArea.innerHTML = "";

  // Show the notification area
  notificationArea.style.display = "block";

  const notificationEl = document.createElement("div");
  notificationEl.className = `notification ${type}`;
  notificationEl.innerHTML = `
    <div class="notification-title">${title}</div>
    <div class="notification-message">${message}</div>
  `;

  notificationArea.appendChild(notificationEl);

  // Show with slide-down animation
  setTimeout(() => {
    notificationEl.style.transform = "translateY(0)";
    notificationEl.style.opacity = "1";
  }, 10);

  // Auto-hide after 5 seconds
  setTimeout(() => {
    notificationEl.style.transform = "translateY(-100%)";
    notificationEl.style.opacity = "0";
    setTimeout(() => {
      if (notificationEl.parentNode) {
        notificationEl.parentNode.removeChild(notificationEl);
      }
      // Hide notification area if empty
      if (notificationArea.children.length === 0) {
        notificationArea.style.display = "none";
      }
    }, 300);
  }, 5000);
}

function getExtension(url) {
  if (url.includes(".mp4")) return "mp4";
  if (url.includes(".m3u8")) return "m3u8";
  return "video";
}

function copyToClipboard(text) {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      console.log("Copied to clipboard");
    })
    .catch((err) => {
      console.error("Failed to copy:", err);
    });
}
