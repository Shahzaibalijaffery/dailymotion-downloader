/**
 * Config file parsing functionality
 * Handles fetching and parsing Dailymotion master.json/config files to extract video URLs
 */

/** Returns the videoId of the active URL for this tab from videoData, or null. */
function getActiveVideoId(videoData, tabId) {
  const data = videoData[tabId];
  if (!data || !data.activeUrl || !Array.isArray(data.urls)) return null;
  return data.urls.find((u) => u.url === data.activeUrl)?.videoId ?? null;
}

/**
 * Fetch and parse HLS master playlist in configParser; store variants via storeVideoUrl.
 * Uses parseMasterPlaylistToVariants from downloadM3U8 for M3U8 text parsing only.
 */
async function parseAndStoreHLSVariants(
  tabId,
  masterPlaylistUrl,
  providedVideoId = null,
  providedVideoTitle = null,
  videoData,
  storeVideoUrl,
  parsingHLSVariants,
  getVideoTitleFromApi = null,
) {
  const normalizedUrl = fixUrlEncoding(masterPlaylistUrl);
  console.log("[parse HLS] url:", normalizedUrl);
  if (parsingHLSVariants.has(normalizedUrl)) return;
  parsingHLSVariants.add(normalizedUrl);
  setTimeout(() => parsingHLSVariants.delete(normalizedUrl), 30000);

  try {
    if (!tabId || tabId < 0) {
      const foundTabId = await findDailymotionTabId(normalizedUrl, videoData);
      if (foundTabId) tabId = foundTabId;
      else {
        console.warn(
          "Could not find valid tabId for HLS variants, skipping storage",
        );
        parsingHLSVariants.delete(normalizedUrl);
        return;
      }
    }
    masterPlaylistUrl = normalizedUrl;

    let fetchOptions;
    try {
      fetchOptions = await getFetchOptionsWithHeaders(masterPlaylistUrl, tabId);
    } catch (e) {
      fetchOptions = {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.9",
        },
      };
    }

    let response;
    try {
      response = await fetch(masterPlaylistUrl, fetchOptions);
      if (!response.ok) return;
    } catch (err) {
      try {
        response = await fetch(masterPlaylistUrl, {
          method: "GET",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });
        if (!response.ok) return;
      } catch (retryErr) {
        parsingHLSVariants.delete(normalizedUrl);
        return;
      }
    }

    const playlistText = await response.text();
    const { variants, audioTracks } = parseMasterPlaylistToVariants(
      playlistText,
      masterPlaylistUrl,
    );
    if (variants.length === 0 && audioTracks.length === 0) {
      parsingHLSVariants.delete(normalizedUrl);
      return;
    }

    if (!videoData[tabId]) {
      videoData[tabId] = {
        urls: [],
        activeUrl: null,
        videoTitle: null,
        videoIds: {},
      };
    }
    const psidMatch = masterPlaylistUrl.match(/psid=([^&\/]+)/);
    if (psidMatch && videoData[tabId].urls.length > 0) {
      const psid = psidMatch[1];
      const existingVariants = videoData[tabId].urls.filter(
        (v) =>
          v.type &&
          v.type.startsWith("hls-") &&
          v.type !== "hls-master" &&
          v.url.includes(psid),
      );
      if (existingVariants.length >= 3) {
        parsingHLSVariants.delete(normalizedUrl);
        return;
      }
    }

    // Prefer tab's current URL for videoId/title (handles SPA/autoplay: by now the tab may have updated)
    let videoId = null;
    let videoTitle = null;
    if (tabId) {
      try {
        const tab = await new Promise((resolve) => {
          chrome.tabs.get(tabId, (t) =>
            resolve(chrome.runtime.lastError ? null : t),
          );
        });
        if (tab?.url && isVideoPage(tab.url)) {
          videoId = extractVideoId(tab.url);
          // Prefer live title from content script (document.title) – tab.title can be stale after SPA nav
          let pageTitle = null;
          try {
            pageTitle = await new Promise((resolve) => {
              chrome.tabs.sendMessage(
                tabId,
                { action: "getPageTitle" },
                (response) => {
                  if (chrome.runtime.lastError) resolve(null);
                  else resolve(response?.title ?? null);
                },
              );
            });
          } catch (e) {}
          if (pageTitle && pageTitle.length > 1) {
            videoTitle = pageTitle;
          } else {
            const cleaned = tab.title ? cleanVideoTitle(tab.title) : null;
            if (cleaned) videoTitle = cleaned;
            else if (videoId && videoData[tabId].videoIds?.[videoId])
              videoTitle = videoData[tabId].videoIds[videoId].title;
          }
        }
      } catch (e) {}
    }
    if (!videoId) videoId = providedVideoId;
    if (!videoTitle) videoTitle = providedVideoTitle;
    if (
      videoId &&
      !videoTitle &&
      videoData[tabId].videoIds &&
      videoData[tabId].videoIds[videoId]
    ) {
      videoTitle = videoData[tabId].videoIds[videoId].title;
    }
    if (!videoId && videoData[tabId].urls) {
      const sorted = [...videoData[tabId].urls].sort(
        (a, b) => (b.timestamp || 0) - (a.timestamp || 0),
      );
      const recent = sorted.find((v) => v.videoId);
      if (recent) {
        videoId = recent.videoId;
        if (!videoTitle) videoTitle = recent.videoTitle;
      }
    }
    if (!videoId && videoData[tabId].videoIds) {
      const keys = Object.keys(videoData[tabId].videoIds);
      if (keys.length > 0) {
        const withTitle = keys.find(
          (id) => videoData[tabId].videoIds[id]?.title,
        );
        videoId = withTitle || keys[keys.length - 1];
        if (!videoTitle) videoTitle = videoData[tabId].videoIds[videoId]?.title;
      }
    }
    if (!videoId) videoId = extractVideoId(masterPlaylistUrl);

    // Fallback: fetch title from Dailymotion oEmbed API when we have videoId but no usable title
    const isGenericTitle =
      !videoTitle ||
      videoTitle === "Dailymotion Video" ||
      videoTitle.toLowerCase().includes("dailymotion video player");
    if (
      videoId &&
      isGenericTitle &&
      typeof getVideoTitleFromApi === "function"
    ) {
      try {
        const apiTitle = await getVideoTitleFromApi(videoId);
        if (apiTitle) videoTitle = apiTitle;
      } catch (e) {}
    }

    console.log(
      "[M3U8] Storing variants with videoId:",
      videoId,
      "| videoTitle:",
      videoTitle,
      "| masterPlaylistUrl:",
      masterPlaylistUrl?.substring(0, 80) + "...",
    );

    let storedCount = 0;
    variants.forEach((variant, index) => {
      let quality = null;
      if (variant.resolution && variant.resolution !== "unknown") {
        const m = variant.resolution.match(/(\d+)x(\d+)/);

        console.log(m, "[bg configParser] m");
        let minSide = Math.min(m[1], m[2]);
        if (m) quality = normalizeToDailymotionQuality(parseInt(minSide, 10));
      }
      if (!quality && variant.bandwidth) {
        if (variant.bandwidth < 800000) quality = 240;
        else if (variant.bandwidth < 1500000) quality = 380;
        else if (variant.bandwidth < 3000000) quality = 480;
        else if (variant.bandwidth < 6000000) quality = 720;
        else if (variant.bandwidth < 9000000) quality = 1080;
        else if (variant.bandwidth < 15000000) quality = 1440;
        else if (variant.bandwidth < 25000000) quality = 2160;
        else quality = 4320; // 8K
      }
      const type = quality ? `hls-${quality}p` : `hls-variant-${index + 1}`;

      storeVideoUrl(tabId, variant.url, type, false, videoTitle, videoId);
      storedCount++;
    });
    audioTracks.forEach((track, index) => {
      const type =
        audioTracks.length > 1
          ? `hls-audio-${track.name.replace(/\s+/g, "_")}`
          : "hls-audio";
      storeVideoUrl(tabId, track.url, type, false, videoTitle, videoId);
      storedCount++;
    });
  } catch (error) {
    console.error("Failed to parse HLS master playlist for variants:", error);
  } finally {
    parsingHLSVariants.delete(normalizedUrl);
  }
}

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
 * Fetch and parse master.json to extract video id/title and store in videoData.
 * HLS variants are not read from master.json (they come from M3U8 requests only).
 *
 * @param {number} tabId - The tab ID
 * @param {string} configUrl - The config URL to fetch
 * @param {string} normKey - Normalized URL key for deduplication
 * @param {Object} videoData - Video data object
 * @param {Function} storeVideoUrl - Function to store video URLs (unused; kept for API compatibility)
 * @param {Function} getVideoTitleFromTab - Function to get video title from tab
 * @param {Set} processedConfigs - Set of processed config URLs
 * @param {Function} [getVideoTitleFromApi] - Optional: fetch title by video ID (e.g. Dailymotion oEmbed)
 * @returns {Promise<void>}
 */
async function fetchAndParseMasterJson(
  tabId,
  configUrl,
  normKey,
  videoData,
  storeVideoUrl,
  getVideoTitleFromTab,
  processedConfigs,
  getVideoTitleFromApi = null,
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

    console.log(
      "[master.json] Parsed config keys:",
      config ? Object.keys(config) : [],
    );

    // Extract video ID from config URL
    const videoId = extractVideoId(configUrl);
    console.log(
      "[master.json] videoId from config URL:",
      videoId,
      "| configUrl:",
      configUrl,
    );

    // Extract video title from config if available (try multiple paths)
    let videoTitle = null;
    let titleSource = null;
    if (config.video && config.video.title) {
      videoTitle = config.video.title;
      titleSource = "config.video.title";
    } else if (config.title) {
      videoTitle = config.title;
      titleSource = "config.title";
    } else if (
      config.request &&
      config.request.files &&
      config.request.files.video &&
      config.request.files.video.title
    ) {
      videoTitle = config.request.files.video.title;
      titleSource = "config.request.files.video.title";
    } else if (config.metadata && config.metadata.title) {
      videoTitle = config.metadata.title;
      titleSource = "config.metadata.title";
    } else if (config.info && config.info.title) {
      videoTitle = config.info.title;
      titleSource = "config.info.title";
    }
    console.log(
      "[master.json] title from response:",
      videoTitle,
      "| source:",
      titleSource || "none",
    );

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

    // Fallback: fetch title from Dailymotion oEmbed API when we have videoId but no usable title
    if (
      videoId &&
      (!videoTitle ||
        videoTitle === "Dailymotion Video" ||
        videoTitle.toLowerCase().includes("dailymotion video player")) &&
      typeof getVideoTitleFromApi === "function"
    ) {
      try {
        const apiTitle = await getVideoTitleFromApi(videoId);
        if (apiTitle) videoTitle = apiTitle;
      } catch (e) {}
    }

    console.log(
      "[master.json] final videoId:",
      videoId,
      "| final videoTitle:",
      videoTitle,
    );

    // Ensure videoData entry exists for this tab (parseAndStoreHLSVariants will store variants here)
    if (!videoData[tabId]) {
      videoData[tabId] = {
        urls: [],
        activeUrl: null,
        videoTitle: null,
        videoIds: {},
      };
    }

    // Store video title per video ID
    if (videoTitle && videoId) {
      const isActiveVideo = getActiveVideoId(videoData, tabId) === videoId;

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
        isActiveVideo
          ? "(active video)"
          : "(not active, preserving existing title)",
      );

      // Update all existing URLs with this videoId to have the title
      // BUT only if they don't already have a valid title (preserve existing titles)
      // This prevents overwriting correct titles with wrong ones
      if (videoData[tabId].urls) {
        let updatedCount = 0;
        const isActiveVideo = getActiveVideoId(videoData, tabId) === videoId;

        videoData[tabId].urls.forEach((url) => {
          if (url.videoId === videoId) {
            const hasValidTitle =
              url.videoTitle &&
              url.videoTitle !== "Dailymotion Video" &&
              !url.videoTitle
                .toLowerCase()
                .includes("dailymotion video player");

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

    const currentActiveVideoId = getActiveVideoId(videoData, tabId);

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

    // HLS master URL extraction from master.json removed: config never contained
    // HLS URLs in practice; variants come from M3U8 requests only.
  } catch (error) {
    console.error("Failed to parse master.json:", error);
  }
}
