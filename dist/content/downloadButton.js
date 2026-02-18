/**
 * Download button injection module
 * Handles injecting download button into Dailymotion pages and quality menu management
 */

const DM_BTN_LOG = "[DM Download Button]";

/**
 * Completely destroy button and all associated elements and data
 * This ensures no stale data persists when navigating between videos
 */
function destroyDownloadButton() {
  const hadButton =
    document.getElementById("vimeo-downloader-page-button-wrapper") != null;
  if (hadButton) {
    console.log(DM_BTN_LOG, "destroyDownloadButton: removing button from DOM");
  }
  // Remove ALL existing buttons and their wrappers
  document
    .querySelectorAll("#vimeo-downloader-page-button-wrapper")
    .forEach((wrapper) => {
      // Clear all data attributes from button
      const downloadBtn = wrapper.querySelector(
        ".vimeo-downloader-download-btn",
      );
      if (downloadBtn) {
        downloadBtn.removeAttribute("data-url");
        downloadBtn.removeAttribute("data-type");
        downloadBtn.removeAttribute("data-quality-label");
        downloadBtn.removeAttribute("data-video-title");
        downloadBtn.removeAttribute("data-video-id");
        downloadBtn.removeAttribute("data-convert-mp3");
      }

      // Clear quality menu data
      const qualityMenu = wrapper.querySelector(
        ".vimeo-downloader-quality-menu",
      );
      if (qualityMenu) {
        qualityMenu.innerHTML = "";
        qualityMenu.removeAttribute("data-url");
        qualityMenu.removeAttribute("data-type");
        qualityMenu.removeAttribute("data-quality-label");
        qualityMenu.removeAttribute("data-video-title");
        qualityMenu.removeAttribute("data-video-id");
      }

      // Remove all event listeners by cloning (removes all attached listeners)
      const clonedWrapper = wrapper.cloneNode(false);
      if (wrapper.parentNode) {
        wrapper.parentNode.replaceChild(clonedWrapper, wrapper);
        clonedWrapper.remove();
      } else {
        wrapper.remove();
      }
    });

  // Also remove any orphaned quality menus
  document
    .querySelectorAll(".vimeo-downloader-quality-menu")
    .forEach((menu) => {
      menu.innerHTML = "";
      menu.remove();
    });

  // Remove any orphaned buttons
  document.querySelectorAll(".vimeo-downloader-download-btn").forEach((btn) => {
    btn.removeAttribute("data-url");
    btn.removeAttribute("data-type");
    btn.removeAttribute("data-quality-label");
    btn.removeAttribute("data-video-title");
    btn.removeAttribute("data-video-id");
    btn.remove();
  });

  // Remove any orphaned dropdown buttons
  document.querySelectorAll(".vimeo-downloader-dropdown-btn").forEach((btn) => {
    btn.remove();
  });

  // Remove any orphaned button groups
  document
    .querySelectorAll(".vimeo-downloader-button-group")
    .forEach((group) => {
      group.remove();
    });
}

function injectDownloadButton() {
  console.log(DM_BTN_LOG, "injectDownloadButton() called", {
    url: window.location.href?.substring(0, 60),
    readyState: document.readyState,
    source: window.__dmInjectSource || "unknown",
  });
  window.__dmInjectSource = undefined;

  // Check if extension context is valid before attempting injection
  if (!isExtensionContextValid()) {
    console.log(DM_BTN_LOG, "skip: extension context invalidated");
    return;
  }

  // Only inject button on video pages
  if (!isVideoPage()) {
    console.log(DM_BTN_LOG, "skip: not a video page");
    return;
  }
  // Only inject in top frame
  if (window.self !== window.top) {
    console.log(DM_BTN_LOG, "skip: not top frame");
    return;
  }

  // Find the button container first (needed to decide whether we can skip re-inject)
  const buttonContainer =
    document.querySelector('[class*="VideoActions"]') ||
    document.querySelector('[class*="video-actions"]') ||
    document.querySelector(".video-actions") ||
    document.querySelector('[data-testid="video-actions"]');
  if (!buttonContainer) {
    console.log(
      DM_BTN_LOG,
      "skip: button container not found (VideoActions/video-actions). Will retry in 2s.",
      {
        retry: (window.__dmInjectRetries || 0) + 1,
        max: 12,
      },
    );
    // Retry with backoff; avoid hammering during React hydration (was 500ms, caused #418/#423)
    if (isExtensionContextValid()) {
      window.__dmInjectRetries = (window.__dmInjectRetries || 0) + 1;
      if (window.__dmInjectRetries <= 12) {
        window.__dmInjectSource = "containerRetry";
        setTimeout(injectDownloadButton, 2000);
      } else {
        console.log(
          DM_BTN_LOG,
          "gave up: container still not found after max retries",
        );
      }
    }
    return;
  }
  window.__dmInjectRetries = 0;

  const currentVideoId =
    typeof getCurrentVideoId === "function" ? getCurrentVideoId() : null;
  const currentVideoTitle =
    typeof getCurrentVideoTitle === "function" ? getCurrentVideoTitle() : null;

  // If button already exists for this video, skip destroy+inject to avoid flicker
  const existingWrapper = document.getElementById(
    "vimeo-downloader-page-button-wrapper",
  );
  if (existingWrapper && buttonContainer.contains(existingWrapper)) {
    const existingBtn = existingWrapper.querySelector(
      ".vimeo-downloader-download-btn",
    );
    const storedVideoId =
      existingBtn && existingBtn.getAttribute("data-video-id");
    if (
      currentVideoId &&
      storedVideoId != null &&
      String(storedVideoId) === String(currentVideoId)
    ) {
      console.log(DM_BTN_LOG, "skip: button already exists for same video", {
        currentVideoId,
      });
      return;
    }
  }

  console.log(
    DM_BTN_LOG,
    "destroying existing button (if any), then tryInject for video data",
  );
  // COMPLETELY destroy existing button and all associated data before re-injecting
  destroyDownloadButton();

  // Check if video URLs exist before injecting button
  // Use functions from pageTracking.js (loaded before this module)
  let retryCount = 0;
  const maxRetries = 10; // Increased retries for slow connections

  const tryInject = () => {
    // Check if extension context is still valid before attempting
    if (!isExtensionContextValid()) {
      // Extension context invalidated - stop trying
      return;
    }

    // Also check if page is still loading - if so, wait a bit longer
    const isPageLoading = document.readyState !== "complete";

    // Suppress warnings for injection attempts (expected when extension is reloaded)
    safeSendMessage(
      {
        action: "getVideoData",
        tabId: null,
      },
      (response) => {
        // Check again after async operation
        if (!isExtensionContextValid()) {
          return;
        }
        if (
          !response ||
          !response.videoData ||
          !response.videoData.urls ||
          response.videoData.urls.length === 0
        ) {
          // No videos detected yet, retry with exponential backoff
          // If page is still loading, retry more aggressively
          if (retryCount < maxRetries) {
            retryCount++;
            // Use shorter delays if page is still loading (1s, 1.5s, 2s...)
            // Otherwise use longer delays (2s, 3s, 4s...)
            const baseDelay = isPageLoading ? 1000 : 2000;
            const delay = baseDelay + retryCount * (isPageLoading ? 500 : 1000);
            setTimeout(tryInject, delay);
            console.log(DM_BTN_LOG, "tryInject: no video data yet, retry", {
              retry: retryCount,
              max: maxRetries,
              pageLoading: isPageLoading,
              delayMs: delay,
            });
          } else {
            console.log(
              DM_BTN_LOG,
              "tryInject: gave up — max retries reached, video data not available",
              { retries: maxRetries },
            );
          }
          return;
        }

        // If we have a current video title, check if we have data matching it
        let hasCurrentVideo = false;
        if (currentVideoTitle) {
          // Normalize title for comparison (remove extra spaces, lowercase)
          const normalizedTitle = currentVideoTitle
            .toLowerCase()
            .trim()
            .replace(/\s+/g, " ");
          hasCurrentVideo = response.videoData.urls.some((v) => {
            if (v.videoTitle) {
              const normalizedVideoTitle = v.videoTitle
                .toLowerCase()
                .trim()
                .replace(/\s+/g, " ");
              return normalizedVideoTitle === normalizedTitle;
            }
            return false;
          });

          // Also check videoIds mapping
          if (!hasCurrentVideo && response.videoData.videoIds) {
            hasCurrentVideo = Object.values(response.videoData.videoIds).some(
              (videoInfo) => {
                if (videoInfo.title) {
                  const normalizedVideoTitle = videoInfo.title
                    .toLowerCase()
                    .trim()
                    .replace(/\s+/g, " ");
                  return normalizedVideoTitle === normalizedTitle;
                }
                return false;
              },
            );
          }
        }

        // Fallback to video ID matching if title matching didn't work
        if (!hasCurrentVideo && currentVideoId) {
          hasCurrentVideo = response.videoData.urls.some(
            (v) => v.videoId && String(v.videoId) === String(currentVideoId),
          );
        }

        // If no data for current video yet, retry (but don't block if we have any videos)
        // Only retry if we have NO videos at all, or if we specifically need the current video
        const hasAnyVideos =
          response.videoData.urls && response.videoData.urls.length > 0;

        if (!hasAnyVideos && retryCount < maxRetries) {
          retryCount++;
          const delay = 2000 * retryCount;
          console.log(DM_BTN_LOG, "tryInject: no videos at all, retry", {
            retry: retryCount,
            delayMs: delay,
          });
          setTimeout(tryInject, delay);
          return;
        }

        // If we have videos but they don't match current video, still proceed (will use most recent)
        // Only retry if we specifically need the current video and have time
        if (
          hasAnyVideos &&
          (currentVideoTitle || currentVideoId) &&
          !hasCurrentVideo &&
          retryCount < 2
        ) {
          retryCount++;
          console.log(
            DM_BTN_LOG,
            "tryInject: have videos but not for current video, retry once",
            { retry: retryCount },
          );
          setTimeout(tryInject, 2000);
          return;
        }

        retryCount = 0; // Reset retry count on success
        console.log(DM_BTN_LOG, "tryInject: video data received", {
          urlCount: response.videoData?.urls?.length ?? 0,
          hasCurrentVideo,
          currentVideoId,
        });

        // Filter to check if there are any valid video URLs
        const reliableUrls = response.videoData.urls.filter((v) => {
          if (v.type && v.type.includes("mp4-full")) return false;
          if (
            v.type === "config" ||
            v.url.includes("master.json") ||
            v.url.includes("config")
          )
            return false;
          if (
            v.type === "hls-master" ||
            (v.type && v.type.includes("hls-master"))
          )
            return false;
          if (v.type && (v.type.includes("hls") || v.type.includes("m3u8"))) {
            const hasQualityInType =
              v.type.match(/hls-(\d+)p?/i) || v.type.match(/(\d+)p/i);
            if (!hasQualityInType) return false;
          }
          return true;
        });

        if (reliableUrls.length === 0) {
          if (retryCount < maxRetries) {
            retryCount++;
            const delay = 2000 * retryCount;
            console.log(
              DM_BTN_LOG,
              "tryInject: no reliable URLs after filter, retry",
              { retry: retryCount, delayMs: delay },
            );
            setTimeout(tryInject, delay);
          } else {
            console.log(
              DM_BTN_LOG,
              "tryInject: gave up — no reliable URLs after filter (max retries)",
            );
          }
          return;
        }

        console.log(
          DM_BTN_LOG,
          "tryInject: proceeding to injectButtonElement",
          { reliableUrlCount: reliableUrls.length },
        );
        // Videos found, proceed with button injection
        injectButtonElement(buttonContainer);
      },
    );
  };

  tryInject();
}

// Separate function to actually inject the button element
function injectButtonElement(buttonContainer) {
  console.log(DM_BTN_LOG, "injectButtonElement() called");
  // Only inject button on video pages
  if (!isVideoPage()) {
    console.log(DM_BTN_LOG, "injectButtonElement: skip — not a video page");
    return;
  }
  // Double-check: Completely destroy any existing buttons before injecting (safety check)
  destroyDownloadButton();
  // Add styles for the download button
  if (!document.getElementById("vimeo-downloader-button-styles")) {
    const style = document.createElement("style");
    style.id = "vimeo-downloader-button-styles";
    style.textContent = `
      /* Video actions bar: 5 columns so Download button fits at start */
      [class*="VideoActions"] {
        grid-template-columns: repeat(5, 1fr) !important;
      }
      /* Wrapper: full width of container */
      #vimeo-downloader-page-button-wrapper {
        position: relative;
        display: flex;
        width: 100%;
        align-items: center;
        overflow: visible !important;
      }
      
      .vimeo-downloader-button-group {
        position: relative;
        display: flex;
        width: 100%;
        align-items: stretch;
        height: 40px;
        border-radius: 6px;
        overflow: visible !important;
        background: #f8f8f8;
        border: 1px solid #f8f8f8;
      }
      
      /* Ensure parent containers don't clip the dropdown */
      .css-rrm59m {
        overflow: visible !important;
      }
      
      .chakra-stack.css-tistzx {
        overflow: visible !important;
      }
      
      /* Match Dailymotion action buttons: 40px height above 786px, no border, #f8f8f8; main btn grows to fill */
      .vimeo-downloader-download-btn {
        flex: 1 1 auto;
        min-width: 0;
        height: 40px;
        box-sizing: border-box;
        background: #f8f8f8;
        color: #0d0d0d;
        border: none;
        border-radius: 0;
        border-top-left-radius: 6px;
        border-bottom-left-radius: 6px;
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
        margin: 0;
        padding: 0 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: pointer;
        font-family: inherit;
        font-size: 14px;
        font-weight: 500;
        transition: background-color 0.15s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        position: relative;
      }
      
      .vimeo-downloader-download-btn:hover {
        background: #fff;
        border-color: #fff;
        box-shadow: 0 0 0.5rem #0d0d0d40;
        color: #0d0d0d;
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
          padding: 0 10px;
          min-width: 32px;
        }
        
        .vimeo-downloader-download-btn .download-text {
          display: none;
        }
        
        .vimeo-downloader-download-btn .download-icon {
          display: inline-block;
          width: 18px;
          height: 18px;
        }
      }
      
      .vimeo-downloader-dropdown-btn {
        flex: 0 0 auto;
        width: 40px;
        min-width: 40px;
        height: 40px;
        box-sizing: border-box;
        padding: 0;
        background: #f8f8f8;
        color: #0d0d0d;
        border: none;
        border-radius: 0;
        border-top-right-radius: 6px;
        border-bottom-right-radius: 6px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.15s ease;
      }
      
      .vimeo-downloader-dropdown-btn:hover {
        background: #fff;
        border-color: #fff;
        box-shadow: 0 0 0.5rem #0d0d0d40;
        color: #0d0d0d;
      }
      
      .vimeo-downloader-dropdown-btn svg {
        pointer-events: none;
      }
      
      @media (max-width: 786px) {
        .vimeo-downloader-button-group {
          height: 32px;
        }
        .vimeo-downloader-download-btn {
          height: 32px;
        }
        .vimeo-downloader-dropdown-btn {
          width: 32px;
          min-width: 32px;
          height: 32px;
        }
      }
      
      .vimeo-downloader-quality-menu {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        background: #f8f8f8;
        border: none;
        border-radius: 6px;
        box-shadow: 0 0 0.5rem #0d0d0d40;
        max-height: 200px;
        overflow-y: auto;
        z-index: 999999 !important;
        display: none;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
        padding: 4px 0;
        min-width: 140px;
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
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 14px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        color: #0d0d0d;
        transition: background-color 0.15s ease;
        border-bottom: none;
      }
      
      .vimeo-downloader-quality-item:last-child {
        border-bottom: none;
      }
      
      .vimeo-downloader-quality-item .quality-resolution {
        flex: 0 0 auto;
      }
      
      .vimeo-downloader-quality-item .quality-tag {
        flex: 0 0 auto;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.02em;
        padding: 2px 6px;
        border-radius: 4px;
        background: rgba(0, 0, 0, 0.08);
        color: #0d0d0d;
      }
      
      .vimeo-downloader-quality-item.selected .quality-tag {
        background: rgba(0, 0, 0, 0.12);
      }
      
      .vimeo-downloader-quality-item:hover {
        background: #fff;
        box-shadow: 0 0 0.5rem #0d0d0d40;
      }
      
      .vimeo-downloader-quality-item.selected {
        background: #fff;
        color: #0d0d0d;
        font-weight: 600;
        box-shadow: 0 0 0.5rem #0d0d0d40;
      }
      
      .vimeo-downloader-quality-item.selected:hover {
        background: #fff;
        box-shadow: 0 0 0.5rem #0d0d0d40;
      }
      
      .vimeo-downloader-download-btn .download-selected-quality {
        margin-left: 4px;
        font-weight: 500;
      }
    `;
    document.head.appendChild(style);
  }

  // Create wrapper
  const buttonWrapper = document.createElement("div");
  buttonWrapper.id = "vimeo-downloader-page-button-wrapper";
  buttonWrapper.className = "css-rrm59m";

  // Create button group
  const buttonGroup = document.createElement("div");
  buttonGroup.className = "vimeo-downloader-button-group";

  // Create main download button
  const downloadBtn = document.createElement("button");
  downloadBtn.className = "vimeo-downloader-download-btn";
  downloadBtn.innerHTML = `
    <span class="download-text">Download</span>
    <span class="download-selected-quality"></span>
    <svg class="download-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 2V10M8 10L5 7M8 10L11 7M3 12H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  // Update visible selected quality on the main button: show tag (SD, HD, FHD, etc.) when available, else label
  const updateButtonSelectedQuality = (qualityLabel) => {
    const sel = downloadBtn.querySelector(".download-selected-quality");
    if (!sel) return;
    const tag =
      typeof getQualityTag === "function" ? getQualityTag(qualityLabel) : null;
    const display = tag || qualityLabel || "";
    sel.textContent = display ? " " + display : "";
  };

  // Create dropdown button (chevron only; selected quality shown on main button)
  const dropdownBtn = document.createElement("button");
  dropdownBtn.className = "vimeo-downloader-dropdown-btn";
  dropdownBtn.setAttribute("aria-label", "Select quality");
  dropdownBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  // Create quality dropdown menu
  const qualityMenu = document.createElement("div");
  qualityMenu.className = "vimeo-downloader-quality-menu";

  // Function to populate quality menu - SIMPLIFIED
  // Note: getCurrentVideoId and getCurrentVideoTitle are from pageTracking.js
  // Track retry state for quality menu
  let menuRetryCount = 0;
  const maxMenuRetries = 5;

  const populateQualityMenu = (isRetry = false) => {
    if (!isRetry) {
      qualityMenu.innerHTML = "";
      menuRetryCount = 0;
    }

    // Use functions from pageTracking.js (loaded before this module)
    const currentVideoTitle =
      typeof getCurrentVideoTitle === "function"
        ? getCurrentVideoTitle()
        : null;
    const currentVideoId =
      typeof getCurrentVideoId === "function" ? getCurrentVideoId() : null;

    // CRITICAL: Verify button still belongs to current video before populating menu
    const buttonVideoId = downloadBtn.getAttribute("data-video-id");
    if (
      currentVideoId &&
      buttonVideoId &&
      String(currentVideoId) !== String(buttonVideoId)
    ) {
      console.warn(
        "⚠️ Video ID mismatch in populateQualityMenu! Button belongs to different video. Destroying and recreating...",
        {
          currentVideoId,
          buttonVideoId,
        },
      );
      destroyDownloadButton();
      setTimeout(() => {
        if (typeof injectDownloadButton === "function") {
          injectDownloadButton();
        }
      }, 500);
      return;
    }

    // Get video data to populate quality menu (pass null for tabId, background will find it)
    safeSendMessage(
      {
        action: "getVideoData",
        tabId: null,
      },
      (response) => {
        if (
          !response ||
          !response.videoData ||
          !response.videoData.urls ||
          response.videoData.urls.length === 0
        ) {
          // If no videos and we haven't exceeded retries, show loading and retry
          if (
            menuRetryCount < maxMenuRetries &&
            document.readyState !== "complete"
          ) {
            menuRetryCount++;
            const menuItem = document.createElement("div");
            menuItem.className = "vimeo-downloader-quality-item";
            menuItem.textContent = `Loading videos... (${menuRetryCount}/${maxMenuRetries})`;
            menuItem.style.cursor = "default";
            menuItem.style.opacity = "0.5";
            qualityMenu.innerHTML = "";
            qualityMenu.appendChild(menuItem);
            // Retry after delay
            setTimeout(() => populateQualityMenu(true), 1500);
            return;
          }
          // Max retries reached or page loaded - show no videos message
          const menuItem = document.createElement("div");
          menuItem.className = "vimeo-downloader-quality-item";
          menuItem.textContent = "No videos detected yet";
          menuItem.style.cursor = "default";
          menuItem.style.opacity = "0.5";
          qualityMenu.innerHTML = "";
          qualityMenu.appendChild(menuItem);
          return;
        }

        // Reset retry count on success
        menuRetryCount = 0;

        // Use same filtering logic as popup
        const reliableUrls = response.videoData.urls.filter((v) => {
          // Hide mp4-full - they're extracted from range URLs and often incomplete
          if (v.type && v.type.includes("mp4-full")) {
            return false;
          }
          // Hide config files
          if (
            v.type === "config" ||
            v.url.includes("master.json") ||
            v.url.includes("config")
          ) {
            return false;
          }
          // Hide HLS master playlists
          if (
            v.type === "hls-master" ||
            (v.type && v.type.includes("hls-master"))
          ) {
            return false;
          }
          // Hide any HLS URL that doesn't have a specific quality
          if (v.type && (v.type.includes("hls") || v.type.includes("m3u8"))) {
            const hasQualityInType =
              v.type.match(/hls-(\d+)p?/i) || v.type.match(/(\d+)p/i);
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
          const menuItem = document.createElement("div");
          menuItem.className = "vimeo-downloader-quality-item";
          menuItem.textContent = "No videos detected yet";
          menuItem.style.cursor = "default";
          menuItem.style.opacity = "0.5";
          qualityMenu.appendChild(menuItem);
          return;
        }

        // Try to filter by current video, but always fall back to all reliable URLs
        let filteredUrls = reliableUrls;

        // First, try to match by title if we have one
        if (currentVideoTitle) {
          const normalizedTitle = currentVideoTitle
            .toLowerCase()
            .trim()
            .replace(/\s+/g, " ");

          // Try matching by videoTitle in URLs
          const titleMatches = reliableUrls.filter((v) => {
            if (v.videoTitle) {
              const normalizedVideoTitle = v.videoTitle
                .toLowerCase()
                .trim()
                .replace(/\s+/g, " ");
              return normalizedVideoTitle === normalizedTitle;
            }
            return false;
          });

          if (titleMatches.length > 0) {
            filteredUrls = titleMatches;
          } else if (response.videoData.videoIds) {
            // Try matching via videoIds mapping
            const matchingVideoId = Object.entries(
              response.videoData.videoIds,
            ).find(([id, info]) => {
              if (info.title) {
                const normalizedVideoTitle = info.title
                  .toLowerCase()
                  .trim()
                  .replace(/\s+/g, " ");
                return normalizedVideoTitle === normalizedTitle;
              }
              return false;
            });

            if (matchingVideoId) {
              const matchedId = matchingVideoId[0];
              const idMatches = reliableUrls.filter(
                (v) => v.videoId && String(v.videoId) === String(matchedId),
              );
              if (idMatches.length > 0) {
                filteredUrls = idMatches;
              }
            }
          }
        }

        // If still no matches and we have a video ID, try matching by ID
        if (filteredUrls.length === 0 && currentVideoId) {
          const idMatches = reliableUrls.filter(
            (v) => v.videoId && String(v.videoId) === String(currentVideoId),
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
        filteredUrls.forEach((video) => {
          const key = video.videoId || video.url.split("?")[0];
          if (!groupedVideos[key]) {
            groupedVideos[key] = [];
          }
          groupedVideos[key].push(video);
        });

        // Get the group for the current video (prioritize title match, then videoId)
        let videoGroup = [];
        if (currentVideoTitle) {
          // Try to find group with matching title
          const normalizedTitle = currentVideoTitle
            .toLowerCase()
            .trim()
            .replace(/\s+/g, " ");
          const matchingGroup = Object.entries(groupedVideos).find(
            ([key, videos]) => {
              return videos.some((v) => {
                if (v.videoTitle) {
                  const normalizedVideoTitle = v.videoTitle
                    .toLowerCase()
                    .trim()
                    .replace(/\s+/g, " ");
                  return normalizedVideoTitle === normalizedTitle;
                }
                return false;
              });
            },
          );
          if (matchingGroup) {
            videoGroup = matchingGroup[1];
          }
        }

        // If no title match, try video ID match
        if (videoGroup.length === 0 && currentVideoId) {
          const matchingGroup = Object.entries(groupedVideos).find(
            ([key, videos]) => {
              return videos.some(
                (v) =>
                  v.videoId && String(v.videoId) === String(currentVideoId),
              );
            },
          );
          if (matchingGroup) {
            videoGroup = matchingGroup[1];
          }
        }

        // If no match found, get the most recent group (by timestamp)
        if (videoGroup.length === 0) {
          const sortedGroups = Object.entries(groupedVideos).sort((a, b) => {
            const aMaxTime = Math.max(...a[1].map((v) => v.timestamp || 0), 0);
            const bMaxTime = Math.max(...b[1].map((v) => v.timestamp || 0), 0);
            return bMaxTime - aMaxTime;
          });
          videoGroup = sortedGroups[0] ? sortedGroups[0][1] : [];
        }

        // If still no group, use all filtered URLs directly (don't group)
        if (videoGroup.length === 0 && filteredUrls.length > 0) {
          videoGroup = filteredUrls;
        }

        if (videoGroup.length === 0) {
          const menuItem = document.createElement("div");
          menuItem.className = "vimeo-downloader-quality-item";
          menuItem.textContent = "No videos detected yet";
          menuItem.style.cursor = "default";
          menuItem.style.opacity = "0.5";
          qualityMenu.appendChild(menuItem);
          return;
        }

        // Sort by quality (prefer MP4, then highest quality)
        const sortedQualities = videoGroup.sort((a, b) => {
          const aIsMP4 =
            a.type && a.type.includes("mp4") && !a.type.includes("m3u8");
          const bIsMP4 =
            b.type && b.type.includes("mp4") && !b.type.includes("m3u8");
          if (aIsMP4 && !bIsMP4) return -1;
          if (!aIsMP4 && bIsMP4) return 1;

          const qualityA = extractQuality(a.type, a.url) || 0;
          const qualityB = extractQuality(b.type, b.url) || 0;
          return qualityB - qualityA;
        });

        // Deduplicate by quality label so revisiting the same video doesn't show duplicate rows (one per 720p, 480p, MP3, etc.)
        const uniqueByQualityLabel = new Map();
        sortedQualities.forEach((video) => {
          if (!video || !video.url) return;
          const label =
            typeof formatQualityLabel === "function"
              ? formatQualityLabel(video)
              : video.type || "Video";
          if (!uniqueByQualityLabel.has(label)) {
            uniqueByQualityLabel.set(label, video);
          }
        });

        const deduplicatedQualities = Array.from(uniqueByQualityLabel.values());

        if (deduplicatedQualities.length === 0) {
          const menuItem = document.createElement("div");
          menuItem.className = "vimeo-downloader-quality-item";
          menuItem.textContent = "No videos detected yet";
          menuItem.style.cursor = "default";
          menuItem.style.opacity = "0.5";
          qualityMenu.appendChild(menuItem);
          return;
        }

        // Get video title - prioritize current video title from webpage DOM
        // Never show "Dailymotion Video" in dropdown; use cleaned title or "Video"
        let videoTitle = "Video";
        if (currentVideoTitle) {
          videoTitle = currentVideoTitle;
        } else if (
          currentVideoId &&
          response.videoData.videoIds &&
          response.videoData.videoIds[currentVideoId]
        ) {
          videoTitle =
            response.videoData.videoIds[currentVideoId].title || videoTitle;
        } else if (deduplicatedQualities[0]?.videoTitle) {
          videoTitle = deduplicatedQualities[0].videoTitle;
        } else if (
          response.videoData.videoIds &&
          Object.keys(response.videoData.videoIds).length > 0
        ) {
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
        videoTitle =
          (typeof cleanVideoTitle === "function"
            ? cleanVideoTitle(videoTitle)
            : null) ||
          videoTitle ||
          "Video";
        if (
          !videoTitle ||
          videoTitle === "Dailymotion Video" ||
          /dailymotion\s+video/i.test(videoTitle)
        ) {
          videoTitle = "Video";
        }

        // Get current selected URL from button (if any) to preserve selection
        // BUT: Only preserve if we're still on the same video (check videoId)
        const currentSelectedUrl = downloadBtn.getAttribute("data-url");
        const buttonVideoId = downloadBtn.getAttribute("data-video-id");
        let selectedIndex = 0; // Default to first item

        // Only preserve selection if we're on the same video
        if (
          currentSelectedUrl &&
          deduplicatedQualities.length > 0 &&
          currentVideoId &&
          buttonVideoId &&
          String(currentVideoId) === String(buttonVideoId)
        ) {
          // Same video - try to preserve selection
          const matchingIndex = deduplicatedQualities.findIndex(
            (v) => v && v.url === currentSelectedUrl,
          );
          if (matchingIndex >= 0) {
            selectedIndex = matchingIndex;
          }
        } else {
          // Different video or no videoId match - reset to first item
          // Clear old button data to prevent using stale URLs
          downloadBtn.removeAttribute("data-url");
          downloadBtn.removeAttribute("data-type");
          downloadBtn.removeAttribute("data-quality-label");
          downloadBtn.removeAttribute("data-video-title");
          downloadBtn.removeAttribute("data-video-id");
          selectedIndex = 0;
        }

        // Set button data - ALWAYS include current video ID to prevent stale data
        if (
          deduplicatedQualities.length > 0 &&
          deduplicatedQualities[0] &&
          deduplicatedQualities[0].url
        ) {
          // Use selected video or first video
          const selectedVideo =
            deduplicatedQualities[selectedIndex] || deduplicatedQualities[0];

          // CRITICAL: Always set current video ID to prevent downloading wrong video
          // If currentVideoId doesn't match, don't set the URL
          if (currentVideoId) {
            downloadBtn.setAttribute("data-video-id", currentVideoId);
          } else {
            // If we can't get current video ID, clear all data to prevent stale downloads
            console.warn(
              "⚠️ Cannot get current video ID, clearing button data to prevent stale downloads",
            );
            downloadBtn.removeAttribute("data-url");
            downloadBtn.removeAttribute("data-type");
            downloadBtn.removeAttribute("data-quality-label");
            downloadBtn.removeAttribute("data-video-title");
            downloadBtn.removeAttribute("data-video-id");
            return;
          }

          const initialQualityLabel = formatQualityLabel(selectedVideo);
          downloadBtn.setAttribute("data-url", selectedVideo.url);
          downloadBtn.setAttribute("data-type", selectedVideo.type || "");
          downloadBtn.setAttribute("data-quality-label", initialQualityLabel);
          downloadBtn.setAttribute("data-video-title", videoTitle);
          updateButtonSelectedQuality(initialQualityLabel);

          // Populate menu: resolution on left, tag (SD/HD/FHD etc.) on right
          deduplicatedQualities.forEach((video, idx) => {
            if (!video || !video.url) return;
            const qualityLabel = formatQualityLabel(video);
            const tag =
              typeof getQualityTag === "function"
                ? getQualityTag(qualityLabel)
                : null;
            const menuItem = document.createElement("div");
            menuItem.className =
              "vimeo-downloader-quality-item" +
              (idx === selectedIndex ? " selected" : "");
            const resSpan = document.createElement("span");
            resSpan.className = "quality-resolution";
            resSpan.textContent = qualityLabel;
            menuItem.appendChild(resSpan);
            if (tag) {
              const tagSpan = document.createElement("span");
              tagSpan.className = "quality-tag";
              tagSpan.textContent = tag;
              menuItem.appendChild(tagSpan);
            }
            menuItem.setAttribute("data-url", video.url);
            menuItem.setAttribute("data-type", video.type || "");
            menuItem.setAttribute("data-quality-label", qualityLabel);
            menuItem.setAttribute("data-video-title", videoTitle);
            qualityMenu.appendChild(menuItem);
          });
          // Add MP3 option: label + tag
          const lowestQuality =
            deduplicatedQualities[deduplicatedQualities.length - 1];
          if (lowestQuality && lowestQuality.url) {
            const mp3Item = document.createElement("div");
            mp3Item.className = "vimeo-downloader-quality-item";
            const mp3Res = document.createElement("span");
            mp3Res.className = "quality-resolution";
            mp3Res.textContent = "MP3";
            mp3Item.appendChild(mp3Res);
            const mp3Tag = document.createElement("span");
            mp3Tag.className = "quality-tag";
            mp3Tag.textContent = "MP3";
            mp3Item.appendChild(mp3Tag);
            mp3Item.setAttribute("data-url", lowestQuality.url);
            mp3Item.setAttribute("data-type", lowestQuality.type || "");
            mp3Item.setAttribute("data-quality-label", "MP3");
            mp3Item.setAttribute("data-video-title", videoTitle);
            mp3Item.setAttribute("data-convert-mp3", "1");
            qualityMenu.appendChild(mp3Item);
          }
        }
      },
    );
  };

  // Initial population
  populateQualityMenu();

  // Toggle dropdown
  dropdownBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const isShowing = qualityMenu.classList.contains("show");

    // Close all other dropdowns
    document
      .querySelectorAll(".vimeo-downloader-quality-menu")
      .forEach((menu) => {
        if (menu !== qualityMenu) {
          menu.classList.remove("show");
          menu.style.display = "none";
        }
      });

    if (isShowing) {
      qualityMenu.classList.remove("show");
      qualityMenu.style.display = "none";
    } else {
      // Always refresh menu data when opening to get latest video data (handles navigation)
      // Clear menu first to show loading state
      qualityMenu.innerHTML = "";
      const loadingItem = document.createElement("div");
      loadingItem.className = "vimeo-downloader-quality-item";
      loadingItem.textContent = "Loading...";
      loadingItem.style.cursor = "default";
      loadingItem.style.opacity = "0.5";
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
          qualityMenu.style.visibility = "hidden";
          qualityMenu.style.display = "block";
          qualityMenu.style.position = "fixed";
          qualityMenu.style.left = "0";
          qualityMenu.style.top = "0";
          const menuRect = qualityMenu.getBoundingClientRect();
          const menuHeight = menuRect.height || 200; // Fallback if not measured
          const menuNaturalWidth = menuRect.width || buttonRect.width;

          // Calculate menu width (don't exceed viewport)
          const maxMenuWidth = viewportWidth - padding * 2;
          const menuWidth = Math.min(
            menuNaturalWidth,
            maxMenuWidth,
            buttonRect.width,
          );

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

          qualityMenu.style.position = "fixed";
          qualityMenu.style.top = `${topPos}px`;
          qualityMenu.style.left = `${leftPos}px`;
          qualityMenu.style.right = "auto";
          qualityMenu.style.width = `${menuWidth}px`;
          qualityMenu.style.maxWidth = `${viewportWidth - padding * 2}px`;
          qualityMenu.style.maxHeight = `${viewportHeight - topPos - padding}px`;
          qualityMenu.style.visibility = "visible";

          // Double-check: if menu still overflows, adjust using right property
          setTimeout(() => {
            const finalRect = qualityMenu.getBoundingClientRect();
            if (finalRect.right > viewportWidth - padding) {
              const overflow = finalRect.right - (viewportWidth - padding);
              qualityMenu.style.left = `${Math.max(padding, leftPos - overflow)}px`;
            }
          }, 0);
        } else {
          qualityMenu.style.position = "absolute";
          qualityMenu.style.top = "calc(100% + 4px)";
          qualityMenu.style.left = "0";
          qualityMenu.style.right = "0";
          qualityMenu.style.width = "auto";
          qualityMenu.style.maxHeight = "";
        }

        qualityMenu.classList.add("show");
        qualityMenu.style.display = "block";
        qualityMenu.style.opacity = "1";
        qualityMenu.style.visibility = "visible";
        qualityMenu.style.zIndex = "999999";
      }, 50); // Small delay to ensure menu is populated
    }
  });

  // Handle quality selection
  qualityMenu.addEventListener("click", (e) => {
    const item = e.target.closest(".vimeo-downloader-quality-item");
    if (!item || item.style.cursor === "default") return;

    e.stopPropagation();

    // Update selected item
    qualityMenu
      .querySelectorAll(".vimeo-downloader-quality-item")
      .forEach((i) => {
        i.classList.remove("selected");
      });
    item.classList.add("selected");

    // Update download button
    const url = item.getAttribute("data-url");
    const type = item.getAttribute("data-type");
    const qualityLabel = item.getAttribute("data-quality-label");
    const videoTitle = item.getAttribute("data-video-title");
    const convertMp3 = item.getAttribute("data-convert-mp3") === "1";

    if (url) {
      // CRITICAL: Always verify and set current video ID when updating from menu selection
      const currentVideoId =
        typeof getCurrentVideoId === "function" ? getCurrentVideoId() : null;
      if (currentVideoId) {
        downloadBtn.setAttribute("data-video-id", currentVideoId);
      } else {
        console.warn(
          "⚠️ Cannot get current video ID when selecting quality, clearing button data",
        );
        downloadBtn.removeAttribute("data-url");
        downloadBtn.removeAttribute("data-type");
        downloadBtn.removeAttribute("data-quality-label");
        downloadBtn.removeAttribute("data-video-title");
        downloadBtn.removeAttribute("data-video-id");
        downloadBtn.removeAttribute("data-convert-mp3");
        return;
      }

      downloadBtn.setAttribute("data-url", url);
      downloadBtn.setAttribute("data-type", type);
      downloadBtn.setAttribute("data-quality-label", qualityLabel);
      updateButtonSelectedQuality(qualityLabel);
      if (videoTitle) {
        downloadBtn.setAttribute("data-video-title", videoTitle);
      }
      if (convertMp3) {
        downloadBtn.setAttribute("data-convert-mp3", "true");
      } else {
        downloadBtn.removeAttribute("data-convert-mp3");
      }
    }

    // Close menu
    qualityMenu.classList.remove("show");
    qualityMenu.style.display = "none";
  });

  // Update dropdown position on scroll (for mobile with overflow scroll)
  const updateDropdownPosition = () => {
    if (window.innerWidth <= 600 && qualityMenu.classList.contains("show")) {
      const buttonRect = buttonGroup.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const padding = 8; // Minimum padding from screen edges

      const menuHeight = qualityMenu.offsetHeight || 200; // Fallback height
      const menuNaturalWidth = qualityMenu.offsetWidth || buttonRect.width;

      // Calculate menu width (don't exceed viewport)
      const maxMenuWidth = viewportWidth - padding * 2;
      const menuWidth = Math.min(
        menuNaturalWidth,
        maxMenuWidth,
        buttonRect.width,
      );

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
      qualityMenu.style.maxWidth = `${viewportWidth - padding * 2}px`;
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
    actionBar.addEventListener("scroll", updateDropdownPosition);
  }

  // Listen for window resize
  window.addEventListener("resize", updateDropdownPosition);

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    // Only close if dropdown is open and click is outside the button group
    if (
      qualityMenu.classList.contains("show") &&
      !buttonGroup.contains(e.target)
    ) {
      qualityMenu.classList.remove("show");
      qualityMenu.style.display = "none";
    }
  });

  // Handle download button click
  downloadBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const url = downloadBtn.getAttribute("data-url");
    const type = downloadBtn.getAttribute("data-type");
    const qualityLabel = downloadBtn.getAttribute("data-quality-label");
    const buttonVideoId = downloadBtn.getAttribute("data-video-id");
    const currentVideoId =
      typeof getCurrentVideoId === "function" ? getCurrentVideoId() : null;

    // CRITICAL: Verify URL belongs to current video - if not, destroy and recreate button
    if (
      url &&
      currentVideoId &&
      buttonVideoId &&
      String(currentVideoId) !== String(buttonVideoId)
    ) {
      console.warn(
        "⚠️ Button URL belongs to different video! Destroying button and recreating...",
        {
          buttonVideoId,
          currentVideoId,
          url: url.substring(0, 50) + "...",
        },
      );
      // Completely destroy button and recreate it
      destroyDownloadButton();
      // Re-inject button with fresh data
      setTimeout(() => {
        if (typeof injectDownloadButton === "function") {
          injectDownloadButton();
        }
      }, 500);
      return;
    }

    // Additional safety: If we have a current video ID but button doesn't have one, or vice versa, recreate button
    if (currentVideoId && !buttonVideoId) {
      console.warn(
        "⚠️ Button missing video ID but current page has one. Recreating button...",
      );
      destroyDownloadButton();
      setTimeout(() => {
        if (typeof injectDownloadButton === "function") {
          injectDownloadButton();
        }
      }, 500);
      return;
    }

    if (!url) {
      // Instead of alert, try to refresh the button data
      if (DEBUG)
        console.log("No video URL available, refreshing button data...");

      // Try to repopulate the menu and get fresh data
      const qualityMenu = buttonWrapper.querySelector(
        ".vimeo-downloader-quality-menu",
      );
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
    let videoTitle = downloadBtn.getAttribute("data-video-title");

    if (!videoTitle) {
      // Fallback: get from background
      safeSendMessage(
        {
          action: "getVideoData",
          tabId: null,
        },
        (response) => {
          if (response && response.videoData) {
            videoTitle =
              response.videoData.videoTitle ||
              (response.videoData.videoIds &&
                Object.values(response.videoData.videoIds)[0]?.title) ||
              "Video";
            videoTitle =
              (typeof cleanVideoTitle === "function"
                ? cleanVideoTitle(videoTitle)
                : null) ||
              videoTitle ||
              "Video";
            if (!videoTitle || /dailymotion\s+video/i.test(videoTitle))
              videoTitle = "Video";
            triggerDownload(url, type, qualityLabel, videoTitle);
          } else {
            triggerDownload(url, type, qualityLabel, "Video");
          }
        },
      );
    } else {
      triggerDownload(url, type, qualityLabel, videoTitle);
    }

    function triggerDownload(url, type, qualityLabel, videoTitle) {
      // FINAL SAFETY CHECK: Verify video ID matches before downloading
      const currentVideoId =
        typeof getCurrentVideoId === "function" ? getCurrentVideoId() : null;
      const buttonVideoId = downloadBtn.getAttribute("data-video-id");
      const convertToMp3 =
        downloadBtn.getAttribute("data-convert-mp3") === "true";

      if (
        currentVideoId &&
        buttonVideoId &&
        String(currentVideoId) !== String(buttonVideoId)
      ) {
        console.error(
          "❌ CRITICAL: Video ID mismatch detected at download trigger! Aborting download.",
          {
            currentVideoId,
            buttonVideoId,
            url: url.substring(0, 50) + "...",
          },
        );
        // Destroy button and recreate it
        destroyDownloadButton();
        setTimeout(() => {
          if (typeof injectDownloadButton === "function") {
            injectDownloadButton();
          }
        }, 500);
        return;
      }

      const extension = convertToMp3
        ? "mp3"
        : url.includes(".mp4")
          ? "mp4"
          : url.includes(".m3u8")
            ? "m3u8"
            : "mp4";
      // Never put "Dailymotion Video" in filename
      const titleForFilename =
        (typeof cleanVideoTitle === "function"
          ? cleanVideoTitle(videoTitle)
          : null) ||
        videoTitle ||
        "video";
      const baseTitle =
        !titleForFilename || /dailymotion\s+video/i.test(titleForFilename)
          ? "video"
          : titleForFilename;
      const sanitizedTitle =
        baseTitle
          .replace(/[<>:"/\\|?*]/g, "_")
          .trim()
          .substring(0, 100) || "video";
      const filename = convertToMp3
        ? `${sanitizedTitle} - MP3.mp3`
        : qualityLabel
          ? `${sanitizedTitle} - ${qualityLabel}.${extension}`
          : `${sanitizedTitle}.${extension}`;

      // Trigger download
      safeSendMessage(
        {
          action: "download",
          url: url,
          type: type,
          filename: filename,
          qualityLabel: qualityLabel,
          convertToMp3: convertToMp3,
          // Send correct dailymotion videoId for restore filtering
          videoId: currentVideoId,
        },
        (downloadResponse) => {
          if (downloadResponse && downloadResponse.success) {
            if (DEBUG) console.log("Download started from page button");
          } else if (downloadResponse && downloadResponse.error) {
            // Only show alert for actual errors, not for cancellations or duplicates
            const errorMsg = downloadResponse.error.toLowerCase();
            if (
              !errorMsg.includes("already being downloaded") &&
              !errorMsg.includes("duplicate") &&
              !errorMsg.includes("cancelled") &&
              !errorMsg.includes("cancel")
            ) {
              // Only show alert for real failures
              if (DEBUG)
                console.log("Download failed:", downloadResponse.error);
              // Don't show alert - silently fail
            }
          }
          // If no response or no success, silently fail (don't show alert)
        },
      );
    }
  });

  // Assemble button group
  buttonGroup.appendChild(downloadBtn);
  buttonGroup.appendChild(dropdownBtn);
  buttonGroup.appendChild(qualityMenu);
  buttonWrapper.appendChild(buttonGroup);

  // Prepend to action bar so Download is first (same row as Like, Share, Bookmark)
  buttonContainer.insertBefore(buttonWrapper, buttonContainer.firstChild);

  console.log(DM_BTN_LOG, "button visible: appended to DOM", {
    videoId:
      typeof getCurrentVideoId === "function" ? getCurrentVideoId() : null,
  });
}

const FEED_BTN_CLASS = "dm-download-feed-btn";
const FEED_WRAPPER_CLASS = "dm-download-feed-wrapper";

function ensureFeedDownloadStyles() {
  if (document.getElementById("dm-feed-download-styles")) return;
  const style = document.createElement("style");
  style.id = "dm-feed-download-styles";
  style.textContent = `
    .dm-download-feed-wrapper { position: relative !important; z-index: 2147483647 !important; pointer-events: auto !important; display: flex !important; flex-direction: column !important; align-items: center !important; }
.dm-download-feed-wrapper.dm-feed-btn-native { background: rgb(245, 245, 245) !important; color: #0D0D0D !important; border: none !important; padding: 0 !important; width: 40px !important; height: 40px !important; border-radius: 8px !important; cursor: pointer !important; display: flex !important; align-items: center !important; justify-content: center !important; margin-right: 0 !important; }
    .dm-download-feed-wrapper.dm-feed-btn-native:hover { background: #fff !important; color: #0D0D0D !important; }
    @media (max-width: 767px) {
      .dm-download-feed-wrapper.dm-feed-btn-native { margin-right: 8px !important; height: auto !important; }
    }
    @media (min-width: 768px) {
      .dm-download-feed-wrapper.dm-feed-btn-native { margin-right: 0 !important; height: 40px !important; }
    }
.dm-download-feed-wrapper.dm-feed-btn-native .dm-download-feed-btn,
.dm-download-feed-wrapper.dm-feed-btn-native svg,
.dm-download-feed-wrapper.dm-feed-btn-native img { height: 24px; object-fit: contain; }
    .dm-feed-quality-menu { position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); margin-bottom: 4px; background: #fff; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); max-height: 200px; overflow-y: auto; min-width: 160px; padding: 4px 0; list-style: none; z-index: 2147483647; pointer-events: auto !important; }
    .dm-feed-quality-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; cursor: pointer; font-size: 13px; font-weight: 500; color: #0d0d0d; }
    .dm-feed-quality-item:hover { background: #f0f0f0; }
    .dm-feed-quality-item.disabled { opacity: 0.7; cursor: default; }
    .dm-feed-quality-item .quality-resolution { flex: 0 0 auto; }
    .dm-feed-quality-item .quality-tag { flex: 0 0 auto; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em; padding: 2px 6px; border-radius: 4px; background: rgba(0,0,0,0.08); color: #0d0d0d; }
  `;
  document.head.appendChild(style);
}

// Same classes as feed action buttons (e.g. Like) so our Download button matches native styling
const FEED_BTN_NATIVE_CLASSES =
  "HomeVideoCardButtons__buttonStyles___KhxTE LikeButton__likeButton___mqkhv Button__button___ro5TM Button__small___A3HdU Button__tertiary___lEWU7 Button__isButtonIcon___yfUeV";

// Download icon: thick rounded arrow above U-shaped tray with small gap (matches reference screenshot).
const FEED_DOWNLOAD_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" role="img" aria-hidden="true" fill="none" stroke="#0D0D0D" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5v9M12 11.5l-3.5 4.2M12 11.5l3.5 4.2"/><path d="M5.5 17.5h2v3h9v-3h2"/></svg>';

/** Inject one Download button for a feed video. Wrapper (with native classes) is direct child of container; click on wrapper opens quality dropdown. */
function appendFeedButtonToContainer(container, videoId) {
  const wrapper = document.createElement("div");
  wrapper.className = [
    FEED_WRAPPER_CLASS,
    "dm-feed-btn-native",
    FEED_BTN_NATIVE_CLASSES,
  ]
    .filter(Boolean)
    .join(" ");
  wrapper.setAttribute("data-video-id", videoId);
  wrapper.setAttribute("role", "button");
  wrapper.setAttribute("tabindex", "0");
  wrapper.setAttribute("aria-label", "Download video");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = FEED_BTN_CLASS;
  btn.setAttribute("data-video-id", videoId);
  btn.style.border = "none";
  btn.style.background = "none";
  btn.style.padding = "0";
  btn.style.cursor = "inherit";
  const iconImg = document.createElement("img");
  iconImg.src =
    typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL
      ? chrome.runtime.getURL("assets/feed-download-icon.png")
      : "";
  iconImg.alt = "Download";
  iconImg.setAttribute("width", "18");
  iconImg.setAttribute("height", "18");
  iconImg.style.width = "18px";
  iconImg.style.height = "18px";
  iconImg.style.display = "block";
  iconImg.style.pointerEvents = "none";
  iconImg.onerror = () => {
    btn.innerHTML = FEED_DOWNLOAD_ICON_SVG;
  };
  if (iconImg.src) btn.appendChild(iconImg);
  else btn.innerHTML = FEED_DOWNLOAD_ICON_SVG;

  const menu = document.createElement("div");
  menu.className = "dm-feed-quality-menu";
  menu.setAttribute("role", "list");
  menu.style.display = "none";

  function closeMenu() {
    menu.style.display = "none";
    document.removeEventListener("click", docClick);
  }
  function docClick(e) {
    if (wrapper.contains(e.target)) return;
    closeMenu();
  }

  function openMenuWithQualities(urls, title) {
    menu.innerHTML = "";
    document.removeEventListener("click", docClick);

    const filenameBase = (
      typeof sanitizeFilenameForDownload === "function"
        ? sanitizeFilenameForDownload(title)
        : title
    )
      .replace(/[\\/:*?"<>|]/g, "_")
      .slice(0, 80);

    // Deduplicate by quality label so we don't show the same quality twice when scrolling back
    const seen = new Set();
    const deduped = urls.filter((v) => {
      const key =
        typeof formatQualityLabel === "function"
          ? formatQualityLabel(v)
          : v.type || v.url || "";
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    deduped.forEach((v) => {
      const qualityLabel =
        typeof formatQualityLabel === "function"
          ? formatQualityLabel(v)
          : v.type || "Video";
      const tag =
        typeof getQualityTag === "function"
          ? getQualityTag(qualityLabel)
          : null;
      const item = document.createElement("div");
      item.className = "dm-feed-quality-item";
      item.setAttribute("role", "option");
      const resSpan = document.createElement("span");
      resSpan.className = "quality-resolution";
      resSpan.textContent = qualityLabel;
      item.appendChild(resSpan);
      if (tag) {
        const tagSpan = document.createElement("span");
        tagSpan.className = "quality-tag";
        tagSpan.textContent = tag;
        item.appendChild(tagSpan);
      }
      item.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        closeMenu();
        const ext = "mp4";
        const filename = qualityLabel
          ? `${filenameBase} - ${qualityLabel}.${ext}`
          : filenameBase + "." + ext;
        safeSendMessage(
          {
            action: "download",
            url: v.url,
            filename: filename,
            type: v.type,
            tabId: null,
            videoId: v.videoId || videoId,
          },
          () => {},
        );
      });
      menu.appendChild(item);
    });

    // MP3 option (convert lowest quality to MP3)
    const lowest = deduped[deduped.length - 1];
    if (lowest && lowest.url) {
      const mp3Item = document.createElement("div");
      mp3Item.className = "dm-feed-quality-item";
      mp3Item.setAttribute("role", "option");
      const mp3Res = document.createElement("span");
      mp3Res.className = "quality-resolution";
      mp3Res.textContent = "MP3";
      mp3Item.appendChild(mp3Res);
      const mp3Tag = document.createElement("span");
      mp3Tag.className = "quality-tag";
      mp3Tag.textContent = "MP3";
      mp3Item.appendChild(mp3Tag);
      mp3Item.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        closeMenu();
        const filename = `${filenameBase} - MP3.mp3`;
        safeSendMessage(
          {
            action: "download",
            url: lowest.url,
            filename: filename,
            type: lowest.type,
            tabId: null,
            videoId: lowest.videoId || videoId,
            convertToMp3: true,
          },
          () => {},
        );
      });
      menu.appendChild(mp3Item);
    }

    menu.style.display = "block";
    document.addEventListener("click", docClick);
  }

  wrapper.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (menu.style.display === "block") {
      closeMenu();
      return;
    }
    safeSendMessage(
      { action: "getVideoData", tabId: null, videoId: videoId },
      (response) => {
        if (
          !response ||
          !response.videoData ||
          !response.videoData.urls ||
          response.videoData.urls.length === 0
        ) {
          menu.innerHTML = "";
          document.removeEventListener("click", docClick);
          const item = document.createElement("div");
          item.className = "dm-feed-quality-item disabled";
          item.textContent = "Play this video first to load options";
          menu.appendChild(item);
          menu.style.display = "block";
          document.addEventListener("click", docClick);
          return;
        }
        const urls = response.videoData.urls.filter((v) => {
          if (
            v.type &&
            (v.type.includes("mp4-full") ||
              v.type === "config" ||
              v.type === "hls-master")
          )
            return false;
          if (
            v.url &&
            (v.url.includes("master.json") || v.url.includes("config"))
          )
            return false;
          if (
            v.type &&
            (v.type.includes("hls") || v.type.includes("m3u8")) &&
            !v.type.match(/hls-\d+p?/i) &&
            !v.type.match(/\d+p/i)
          )
            return false;
          return true;
        });
        const title = (response.videoData.videoTitle || "video")
          .replace(/[\\/:*?"<>|]/g, "_")
          .slice(0, 80);
        if (urls.length === 0) {
          menu.innerHTML = "";
          document.removeEventListener("click", docClick);
          const item = document.createElement("div");
          item.className = "dm-feed-quality-item disabled";
          item.textContent = "Play this video first to load options";
          menu.appendChild(item);
          menu.style.display = "block";
          document.addEventListener("click", docClick);
          return;
        }
        openMenuWithQualities(urls, title);
      },
    );
  });

  wrapper.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      wrapper.click();
    }
  });

  wrapper.appendChild(btn);
  wrapper.appendChild(menu);
  container.insertBefore(wrapper, container.firstChild);
}

/** Feed: inject one button when we detect a video from the JSON API (geo.dailymotion.com/video/ID.json). Looks inside #homefeed for the card matching videoId. */
function injectFeedButtonForVideoId(videoId, retryCount) {
  if (retryCount === undefined) retryCount = 0;
  const MAX_RETRIES = 5;
  const RETRY_DELAY_MS = 400;

  if (!isExtensionContextValid()) return;
  if (typeof isFeedPage !== "function" || !isFeedPage()) return;

  const homefeed = document.getElementById("homefeed");
  if (!homefeed) {
    if (retryCount < MAX_RETRIES) {
      setTimeout(
        () => injectFeedButtonForVideoId(videoId, retryCount + 1),
        RETRY_DELAY_MS * (retryCount + 1),
      );
    }
    return;
  }

  // Already have a feed download button for this video anywhere in homefeed (e.g. after scrolling back)
  if (
    homefeed.querySelector(`.${FEED_WRAPPER_CLASS}[data-video-id="${videoId}"]`)
  )
    return;

  const el = homefeed.querySelector(
    `[id="${videoId}"], [data-xid="${videoId}"], a[href*="/video/${videoId}"]`,
  );
  if (!el) {
    if (retryCount < MAX_RETRIES) {
      setTimeout(
        () => injectFeedButtonForVideoId(videoId, retryCount + 1),
        RETRY_DELAY_MS * (retryCount + 1),
      );
    }
    return;
  }

  const likeBtn = el.querySelector('[data-testid="like-button"]');
  const container = likeBtn ? likeBtn.parentElement : el.closest("div") || el;
  if (!container || !homefeed.contains(container)) return;
  if (container.querySelector(`.${FEED_BTN_CLASS}[data-video-id="${videoId}"]`))
    return;

  ensureFeedDownloadStyles();
  appendFeedButtonToContainer(container, videoId);
}

/** Feed/reels page: one download button per reel, tied to that video ID (from DOM link /video/ID or data-video-id) */
// function injectFeedDownloadButtons() {
//   console.log("[DM Downloader] Feed: injectFeedDownloadButtons");
//   if (!isExtensionContextValid()) return;
//   if (typeof isFeedPage !== "function" || !isFeedPage()) return;

//   // Remove only feed buttons so we can re-run (e.g. after scroll)
//   document
//     .querySelectorAll("." + FEED_WRAPPER_CLASS)
//     .forEach((w) => w.remove());

//   // Find video links: /video/ID or full URL or relative video/ID
//   let links = Array.from(
//     document.querySelectorAll(
//       'a[href*="/video/"], a[href*="video/"], a[href*="dailymotion.com/video"]',
//     ),
//   );

//   console.log("[DM Downloader] Feed: found", links, links.length, "link(s)");
//   // Fallback: containers with data-video-id / data-xid (no <a>)
//   const dataContainers = document.querySelectorAll(
//     "[data-video-id], [data-xid]",
//   );
//   const seenContainers = new Set();
//   let injectedCount = 0;

//   const processLink = (link, videoIdFromAttr) => {
//     let videoId = videoIdFromAttr;
//     if (!videoId) {
//       const href = (link.getAttribute("href") || link.href || "").trim();
//       const match =
//         href.match(/\/video\/([a-zA-Z0-9]+)/) ||
//         href.match(/video\/([a-zA-Z0-9]+)/);
//       if (!match) return;
//       videoId = match[1];
//     }

//     let container =
//       link.closest("section") ||
//       link.closest("article") ||
//       link.closest('[class*="Reel"]') ||
//       link.closest('[class*="Card"]') ||
//       link.closest('[class*="Item"]') ||
//       link.closest('[class*="cell"]') ||
//       link.closest('[class*="Tile"]') ||
//       link.closest("div");
//     if (!container || container === document.body) return;
//     // Prefer a parent that wraps a single reel (one link per container)
//     for (let i = 0; i < 6 && container && container !== document.body; i++) {
//       const linksInside = container.querySelectorAll(
//         'a[href*="/video/"], a[href*="video/"]',
//       );
//       if (linksInside.length === 1) break;
//       container = container.parentElement;
//     }
//     if (!container || seenContainers.has(container)) return;
//     seenContainers.add(container);

//     if (container.querySelector("." + FEED_WRAPPER_CLASS)) return;

//     // Prefer the action bar next to like / share / bookmark so Download sits with them
//     let actionBar =
//       container.querySelector('[class*="VideoAction"]') ||
//       container.querySelector('[class*="video-action"]') ||
//       container.querySelector('[class*="ActionBar"]') ||
//       container.querySelector('[class*="Actions"]') ||
//       container.querySelector('[class*="Stack"][class*="vertical"]') ||
//       container.querySelector('[class*="vertical"][class*="Stack"]');
//     if (!actionBar) {
//       Array.from(container.querySelectorAll("div")).some((div) => {
//         const btnCount = div.querySelectorAll("button, [role='button']").length;
//         if (btnCount >= 2 && btnCount <= 8 && container.contains(div)) {
//           actionBar = div;
//           return true;
//         }
//         return false;
//       });
//     }
//     const insertTarget = actionBar || container;
//     const placeInActionBar = !!actionBar;

//     ensureFeedDownloadStyles();
//     appendFeedButtonToContainer(
//       container,
//       videoId,
//       insertTarget,
//       placeInActionBar,
//     );
//     injectedCount++;
//   };

//   links.forEach((link) => processLink(link, null));

//   dataContainers.forEach((el) => {
//     const vid = el.getAttribute("data-video-id") || el.getAttribute("data-xid");
//     if (!vid || seenContainers.has(el)) return;
//     if (el.querySelector("." + FEED_WRAPPER_CLASS)) return;
//     let container = el;
//     if (container === document.body) return;
//     seenContainers.add(container);

//     let actionBar =
//       container.querySelector('[class*="VideoAction"]') ||
//       container.querySelector('[class*="video-action"]') ||
//       container.querySelector('[class*="ActionBar"]') ||
//       container.querySelector('[class*="Actions"]') ||
//       container.querySelector('[class*="Stack"][class*="vertical"]') ||
//       container.querySelector('[class*="vertical"][class*="Stack"]');
//     if (!actionBar) {
//       Array.from(container.querySelectorAll("div")).some((div) => {
//         const btnCount = div.querySelectorAll("button, [role='button']").length;
//         if (btnCount >= 2 && btnCount <= 8) {
//           actionBar = div;
//           return true;
//         }
//         return false;
//       });
//     }
//     const insertTarget = actionBar || container;
//     const placeInActionBar = !!actionBar;

//     ensureFeedDownloadStyles();
//     appendFeedButtonToContainer(container, vid, insertTarget, placeInActionBar);
//     injectedCount++;
//   });

//   if (injectedCount > 0 || links.length > 0 || dataContainers.length > 0) {
//     console.log(
//       "[DM Downloader] Feed: found",
//       links.length,
//       "link(s),",
//       dataContainers.length,
//       "data-video-id element(s), injected",
//       injectedCount,
//       "button(s)",
//     );
//   }
// }

// function startFeedDownloadButtonObserver() {

//   setTimeout(() => badge.remove(), 2500);
//   if (!isExtensionContextValid()) return;
//   if (typeof isFeedPage !== "function" || !isFeedPage()) return;
//   // Buttons are injected only when background detects a video JSON API call (geo.dailymotion.com/video/ID.json) and sends feedVideoFromApi; no DOM observer.
// }
