/**
 * Config file parsing functionality
 * Handles fetching and parsing Dailymotion master.json/config files to extract video URLs
 */

/**
 * Check if a config URL should be skipped (already processed)
 * @param {string} normUrl - Normalized config URL
 * @param {Set} processedConfigs - Set of processed config URLs
 * @returns {boolean} - True if should skip
 */
function shouldSkipConfig(normUrl, processedConfigs) {
  if (processedConfigs.has(normUrl)) return true;
  processedConfigs.add(normUrl);
  // auto-expire after 60s in case a later, valid config arrives
  setTimeout(() => processedConfigs.delete(normUrl), 60000);
  return false;
}

/**
 * Fetch and parse master.json to extract full video URLs
 * @param {number} tabId - The tab ID
 * @param {string} configUrl - The config URL to fetch
 * @param {string} normKey - Normalized URL key for deduplication
 * @param {Object} videoData - Video data object
 * @param {Function} storeVideoUrl - Function to store video URLs
 * @param {Function} parseAndStoreHLSVariants - Function to parse HLS variants
 * @param {Function} getVideoTitleFromTab - Function to get video title from tab
 * @param {Set} processedConfigs - Set of processed config URLs
 * @param {Set} parsingHLSVariants - Set to track parsing state
 * @returns {Promise<void>}
 */
async function fetchAndParseMasterJson(
  tabId,
  configUrl,
  normKey,
  videoData,
  storeVideoUrl,
  parseAndStoreHLSVariants,
  getVideoTitleFromTab,
  processedConfigs,
  parsingHLSVariants,
) {
  try {
    console.log("Fetching master.json from:", configUrl);
    const response = await fetch(configUrl);

    // Get response text first
    const responseText = await response.text();

    // Validate JSON response using utility function
    if (!validateJsonResponse(response, responseText)) {
      console.warn(
        "Config URL response does not appear to be valid JSON, skipping:",
        configUrl,
      );
      return;
    }

    // Parse as JSON
    let config;
    try {
      config = JSON.parse(responseText);
    } catch (parseError) {
      console.warn(
        "Failed to parse config as JSON:",
        parseError,
        "Response preview:",
        responseText.substring(0, 200),
      );
      return;
    }

    console.log("Parsed master.json config:", config);

    // Extract video ID from config URL
    const videoId = extractVideoId(configUrl);
    console.log(
      "Extracted video ID from config URL:",
      videoId,
      "from URL:",
      configUrl,
    );

    // Extract video title from config if available (try multiple paths)
    let videoTitle = null;
    if (config.video && config.video.title) {
      videoTitle = config.video.title;
    } else if (config.title) {
      videoTitle = config.title;
    } else if (
      config.request &&
      config.request.files &&
      config.request.files.video &&
      config.request.files.video.title
    ) {
      videoTitle = config.request.files.video.title;
    } else if (config.metadata && config.metadata.title) {
      videoTitle = config.metadata.title;
    } else if (config.info && config.info.title) {
      videoTitle = config.info.title;
    }

    // If no title in config, get it from tab title
    if (
      !videoTitle ||
      videoTitle.toLowerCase().includes("dailymotion video player")
    ) {
      try {
        const titleResult = await getVideoTitleFromTab(tabId);
        if (titleResult.videoTitle) {
          const lowerTitle = titleResult.videoTitle.toLowerCase();
          if (
            !lowerTitle.includes("dailymotion video player") &&
            !lowerTitle.match(
              /^(dailymotion|video|dailymotion video player|video player)$/i,
            )
          ) {
            videoTitle = titleResult.videoTitle;
          }
        }
      } catch (e) {
        console.warn("Could not get title from tab:", e.message);
      }
    }

    // Store video title per video ID
    if (videoTitle && videoId) {
      if (!videoData[tabId]) {
        videoData[tabId] = {
          urls: [],
          activeUrl: null,
          videoTitle: null,
          videoIds: {},
        };
      }
      // Only update title if it doesn't exist yet, or if this is the active video
      // Prevents overwriting old video titles with current page's title
      const activeVideoId = videoData[tabId].activeUrl
        ? videoData[tabId].urls.find((u) => u.url === videoData[tabId].activeUrl)?.videoId
        : null;
      const isActiveVideo = activeVideoId === videoId;
      
      if (!videoData[tabId].videoIds[videoId]) {
        videoData[tabId].videoIds[videoId] = { title: videoTitle };
      } else if (!videoData[tabId].videoIds[videoId].title) {
        videoData[tabId].videoIds[videoId].title = videoTitle;
      } else if (isActiveVideo) {
        // Only update if this is the active video (title might have changed)
        videoData[tabId].videoIds[videoId].title = videoTitle;
      }
      // If title exists and this is NOT the active video, DON'T overwrite it
      
      console.log(
        "Extracted video title for video ID",
        videoId,
        ":",
        videoTitle,
        isActiveVideo ? "(active video)" : "(not active, preserving existing title)",
      );

      // Update all existing URLs with this videoId to have the title
      // BUT only if they don't already have a valid title (preserve existing titles)
      // This prevents overwriting correct titles with wrong ones
      if (videoData[tabId].urls) {
        let updatedCount = 0;
        const activeVideoId = videoData[tabId].activeUrl
          ? videoData[tabId].urls.find((u) => u.url === videoData[tabId].activeUrl)?.videoId
          : null;
        const isActiveVideo = activeVideoId === videoId;
        
        videoData[tabId].urls.forEach((url) => {
          if (url.videoId === videoId) {
            const hasValidTitle = url.videoTitle && 
              url.videoTitle !== "Dailymotion Video" &&
              !url.videoTitle.toLowerCase().includes("dailymotion video player");
            
            // Only update if: no valid title exists, OR this is the active video
            if (!hasValidTitle || isActiveVideo) {
              url.videoTitle = videoTitle;
              updatedCount++;
            }
          }
        });
        if (updatedCount > 0) {
          console.log(
            `Updated ${updatedCount} existing URL(s) with title: ${videoTitle}`,
          );
        }
      }
    }

    // Store video title at tab level - always update if we have a valid title
    // Check if this is a different video than what's currently active
    const currentActiveVideoId = videoData[tabId].activeUrl
      ? videoData[tabId].urls.find((u) => u.url === videoData[tabId].activeUrl)
          ?.videoId
      : null;

    // If videoId changed, clear old title first
    if (videoId && currentActiveVideoId && videoId !== currentActiveVideoId) {
      console.log(
        `Video changed in config (${currentActiveVideoId} -> ${videoId}), clearing old title`,
      );
      videoData[tabId].videoTitle = null;
    }

    // Always update title if we have a valid one
    if (
      videoTitle &&
      (!videoData[tabId].videoTitle ||
        videoData[tabId].videoTitle === "Dailymotion Video" ||
        videoData[tabId].videoTitle
          .toLowerCase()
          .includes("dailymotion video player"))
    ) {
      videoData[tabId].videoTitle = videoTitle;
      console.log("Extracted video title:", videoTitle);
    }

    // Try multiple config structures
    let foundUrls = false;

    // Structure 1: config.request.files.progressive
    if (config.request?.files?.progressive) {
      config.request.files.progressive.forEach((file) => {
        if (file.url && !isChunkedRangeUrl(file.url)) {
          storeVideoUrl(
            tabId,
            file.url,
            `mp4-${file.quality || file.height || file.width || "unknown"}p`,
            false,
            videoTitle,
            videoId,
          );
          foundUrls = true;
        }
      });
    }

    // Structure 2: config.video.progressive
    if (config.video?.progressive) {
      config.video.progressive.forEach((file) => {
        if (file.url && !isChunkedRangeUrl(file.url)) {
          storeVideoUrl(
            tabId,
            file.url,
            `mp4-${file.quality || file.height || "unknown"}p`,
            false,
            videoTitle,
            videoId,
          );
          foundUrls = true;
        }
      });
    }

    // Structure 3: config.files.progressive
    if (config.files?.progressive) {
      config.files.progressive.forEach((file) => {
        if (file.url && !isChunkedRangeUrl(file.url)) {
          storeVideoUrl(
            tabId,
            file.url,
            `mp4-${file.quality || file.height || "unknown"}p`,
            false,
            videoTitle,
            videoId,
          );
          foundUrls = true;
        }
      });
    }

    // Structure 4: Direct progressive array
    if (Array.isArray(config.progressive)) {
      config.progressive.forEach((file) => {
        if (file.url && !isChunkedRangeUrl(file.url)) {
          storeVideoUrl(
            tabId,
            file.url,
            `mp4-${file.quality || file.height || "unknown"}p`,
            false,
            videoTitle,
            videoId,
          );
          foundUrls = true;
        }
      });
    }

    // Extract HLS master playlist URLs - Structure 1
    if (config.request?.files?.hls) {
      const hls = config.request.files.hls;
      if (hls.cdns) {
        Object.values(hls.cdns).forEach((cdn) => {
          if (cdn.url) {
            storeVideoUrl(
              tabId,
              cdn.url,
              "hls-master",
              false,
              videoTitle,
              videoId,
            );
            // Parse and store all quality variants - pass videoId and videoTitle
            parseAndStoreHLSVariants(
              tabId,
              cdn.url,
              videoId,
              videoTitle,
              videoData,
              storeVideoUrl,
              parsingHLSVariants,
            );
            foundUrls = true;
          }
        });
      }
      if (hls.default_cdn && hls.cdns?.[hls.default_cdn]?.url) {
        const defaultUrl = hls.cdns[hls.default_cdn].url;
        storeVideoUrl(
          tabId,
          defaultUrl,
          "hls-default",
          false,
          videoTitle,
          videoId,
        );
        // Parse and store all quality variants - pass videoId and videoTitle
        parseAndStoreHLSVariants(
          tabId,
          defaultUrl,
          videoId,
          videoTitle,
          videoData,
          storeVideoUrl,
          parsingHLSVariants,
        );
        foundUrls = true;
      }
      // Also check for direct url property
      if (hls.url) {
        storeVideoUrl(tabId, hls.url, "hls-direct", false, videoTitle, videoId);
        // Parse and store all quality variants - pass videoId and videoTitle
        parseAndStoreHLSVariants(
          tabId,
          hls.url,
          videoId,
          videoTitle,
          videoData,
          storeVideoUrl,
          parsingHLSVariants,
        );
        foundUrls = true;
      }
    }

    // Extract HLS - Structure 2
    if (config.video?.hls) {
      if (config.video.hls.url) {
        storeVideoUrl(
          tabId,
          config.video.hls.url,
          "hls",
          false,
          videoTitle,
          videoId,
        );
        // Parse and store all quality variants - pass videoId and videoTitle
        parseAndStoreHLSVariants(
          tabId,
          config.video.hls.url,
          videoId,
          videoTitle,
          videoData,
          storeVideoUrl,
          parsingHLSVariants,
        );
        foundUrls = true;
      }
      if (config.video.hls.cdns) {
        Object.values(config.video.hls.cdns).forEach((cdn) => {
          if (cdn.url) {
            storeVideoUrl(
              tabId,
              cdn.url,
              "hls-master",
              false,
              videoTitle,
              videoId,
            );
            // Parse and store all quality variants - pass videoId and videoTitle
            parseAndStoreHLSVariants(
              tabId,
              cdn.url,
              videoId,
              videoTitle,
              videoData,
              storeVideoUrl,
              parsingHLSVariants,
            );
            foundUrls = true;
          }
        });
      }
    }

    // Extract HLS - Structure 3
    if (config.files?.hls) {
      const hls = config.files.hls;
      if (hls.url) {
        storeVideoUrl(tabId, hls.url, "hls", false, videoTitle, videoId);
        // Parse and store all quality variants - pass videoId and videoTitle
        parseAndStoreHLSVariants(
          tabId,
          hls.url,
          videoId,
          videoTitle,
          videoData,
          storeVideoUrl,
          parsingHLSVariants,
        );
        foundUrls = true;
      }
      if (hls.cdns) {
        Object.values(hls.cdns).forEach((cdn) => {
          if (cdn.url) {
            storeVideoUrl(
              tabId,
              cdn.url,
              "hls-master",
              false,
              videoTitle,
              videoId,
            );
            // Parse and store all quality variants - pass videoId and videoTitle
            parseAndStoreHLSVariants(
              tabId,
              cdn.url,
              videoId,
              videoTitle,
              videoData,
              storeVideoUrl,
              parsingHLSVariants,
            );
            foundUrls = true;
          }
        });
      }
    }

    // Deep search for any video URLs in the config
    if (!foundUrls) {
      console.log(
        "No standard structure found, searching for URLs in config...",
      );
      const urlPattern = /https?:\/\/[^\s"']+\.(?:mp4|m3u8)[^\s"']*/g;
      const configStr = JSON.stringify(config);
      const matches = configStr.match(urlPattern);
      if (matches) {
        matches.forEach((url) => {
          if (!isChunkedRangeUrl(url)) {
            const type = url.includes(".m3u8") ? "hls" : "mp4";
            storeVideoUrl(tabId, url, type, false, videoTitle, videoId);
            foundUrls = true;
          }
        });
      }
    }

    if (!foundUrls) {
      console.warn(
        "No video URLs found in master.json, storing config URL as fallback",
      );
      storeVideoUrl(tabId, configUrl, "config");
    }
  } catch (error) {
    console.error("Failed to parse master.json:", error);
    // Fallback: store the config URL itself
    storeVideoUrl(tabId, configUrl, "config");
  }
}
