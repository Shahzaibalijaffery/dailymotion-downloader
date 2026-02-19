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

  if (parsingHLSVariants.has(normalizedUrl)) return;
  parsingHLSVariants.add(normalizedUrl);
  setTimeout(() => parsingHLSVariants.delete(normalizedUrl), 30000);

  try {
    if (!tabId || tabId < 0) {
      const foundTabId = await findDailymotionTabId(normalizedUrl, videoData);
      if (foundTabId) tabId = foundTabId;
      else {
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
