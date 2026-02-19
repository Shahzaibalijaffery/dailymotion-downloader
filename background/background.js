// In Chrome (service worker) we use importScripts. In Firefox (background.scripts) the manifest loads these first.
if (typeof importScripts !== "undefined") {
  importScripts(
    "/scripts/utils.js",
    "/scripts/storage.js",
    "/scripts/messaging.js",
    "/background/state.js",
    "/background/videoData.js",
    "/background/cancelDownload.js",
    "/background/startDownload.js",
    "/background/downloadBlob.js",
    "/background/downloadM3U8.js",
    "/background/configParser.js",
  );
}

function injectContentScriptIntoTab(tabId) {
  if (!chrome.scripting || !chrome.scripting.executeScript)
    return Promise.resolve();
  return chrome.scripting
    .executeScript({
      target: { tabId },
      files: CONTENT_SCRIPT_FILES,
    })
    .then(() => {
      console.log("[DM Downloader] Injected content script into tab", tabId);
      // Content script will try at ~4.5s; if DOM wasn't ready, request again at 6s and 12s
      INJECT_BUTTON_RETRY_DELAYS_MS.forEach((delayMs) => {
        setTimeout(() => {
          chrome.tabs.sendMessage(
            tabId,
            { action: "requestInjectButton" },
            () => {
              if (chrome.runtime.lastError) {
                // Tab closed or script not ready; ignore
              }
            },
          );
        }, delayMs);
      });
    })
    .catch((err) => {
      console.warn(
        "[DM Downloader] Failed to inject content script into tab",
        tabId,
        err,
      );
    });
}

// On install/update: inject content scripts into all existing Dailymotion tabs so the download button appears without refresh
chrome.runtime.onInstalled.addListener((details) => {
  if (!chrome.scripting || !chrome.scripting.executeScript) return;
  chrome.tabs.query({ url: "*://*.dailymotion.com/*" }, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id) injectContentScriptIntoTab(tab.id);
    });
  });
});

// Clean up on service worker suspend (when extension is disabled/removed)
if (chrome.runtime.onSuspend) {
  chrome.runtime.onSuspend.addListener(() => {
    cleanupAllResources();
    chrome.storage.local.clear(() => {});
  });
}

// We can detect this by checking if we can still access chrome.runtime
let removalCheckInterval = null;

// Listen for network requests to capture video URLs
webRequestListener = (details) => {
  const url = details.url;

  if (!details.tabId || details.tabId < 0) {
    return; // Invalid tabId, skip
  }

  chrome.tabs.get(details.tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !tab.url) {
      return; // Can't verify page, skip
    }

    if (
      !isVideoPage(tab.url) &&
      !(typeof isFeedPage === "function" && isFeedPage(tab.url))
    ) {
      return; // Not a video or feed page, skip URL detection
    }

    // When page requests HLS master playlist, parse it and store variants (same path as config, no master URL stored)
    if (url.includes(".m3u8") && !isSegmentPlaylist(url)) {
      parseAndStoreHLSVariants(
        details.tabId,
        url,
        extractVideoId(url),
        null,
        videoData,
        storeVideoUrl,
        parsingHLSVariants,
        getVideoTitleFromDailymotionApi,
      ).catch((err) => {
        console.warn("Error parsing HLS variants from network:", err);
      });
    }

    // Feed: detect video JSON API (e.g. geo.dailymotion.com/video/xa06sri.json) and tell content to inject button for that video ID
    if (
      (url.includes("geo.dailymotion.com") ||
        url.includes("dailymotion.com")) &&
      url.includes("/video/") &&
      url.includes(".json")
    ) {
      const feedMatch = url.match(/\/video\/([a-zA-Z0-9]+)\.json/);

      if (
        feedMatch &&
        typeof isFeedPage === "function" &&
        isFeedPage(tab.url)
      ) {
        const videoId = feedMatch[1];
        chrome.tabs
          .sendMessage(details.tabId, { action: "feedVideoFromApi", videoId })
          .catch(() => {});
      }
    }
  });
};

chrome.webRequest.onBeforeRequest.addListener(webRequestListener, {
  urls: [
    "*://*.dailymotion.com/*",
    "*://*.dmcdn.net/*",
    "*://*.dm-event.net/*",
    "*://*.dmcloud.net/*",
  ],
});

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle ping to wake up service worker
  if (request.action === "ping") {
    sendResponse({ success: true });
    return true;
  }

  // Handle offscreen document ready signal
  if (request.action === "offscreenReady") {
    sendResponse({ received: true });
    return true;
  }

  if (request.action === "convertProgress" && request.downloadId != null) {
    const p = request.progress;
    chrome.storage.local
      .set({
        [`downloadStatus_${request.downloadId}`]:
          typeof p === "number"
            ? `Converting to MP4... ${Math.round(p * 100)}%`
            : "Converting to MP4...",
      })
      .catch(() => {});
    return false;
  }

  if (request.action === "getVideoData") {
    let tabId = request.tabId;
    if (!tabId && sender && sender.tab && sender.tab.id) {
      tabId = sender.tab.id;
    }

    const raw = videoData[tabId] || { urls: [] };
    // Feed page can request data for a specific videoId (reel); otherwise use active video
    const requestedVideoId = request.videoId || null;
    const activeVideoId = getActiveVideoId(tabId);
    const filterVideoId = requestedVideoId || activeVideoId;
    let urls = filterVideoId
      ? raw.urls.filter((v) => v.videoId === filterVideoId)
      : raw.urls;

    (async () => {
      // Parse one HLS quality to get segment count; if > 1500, show only max 720p
      const SEGMENT_LIMIT = 1500;
      const MAX_QUALITY_WHEN_HIGH_SEGMENTS = 720;
      const firstHls = urls.find(
        (v) =>
          v &&
          v.url &&
          (v.type?.includes("hls") ||
            v.type?.includes("m3u8") ||
            v.url.includes("m3u8")),
      );

      if (firstHls?.url && typeof getSegmentCountForM3u8Url === "function") {
        try {
          const { segmentCount } = await getSegmentCountForM3u8Url(
            firstHls.url,
            tabId,
          );
          if (
            segmentCount > SEGMENT_LIMIT &&
            typeof extractQuality === "function"
          ) {
            urls = urls.filter((v) => {
              const q = extractQuality(v.type, v.url);
              return q == null || q <= MAX_QUALITY_WHEN_HIGH_SEGMENTS;
            });
          }
        } catch (_) {
          // ignore
        }
      }

      const videoIds = raw.videoIds || {};
      const titleVideoId = filterVideoId || activeVideoId;
      const data = {
        urls,
        activeUrl: raw.activeUrl,
        videoTitle:
          titleVideoId && videoIds[titleVideoId]?.title
            ? videoIds[titleVideoId].title
            : raw.videoTitle,
        videoIds:
          titleVideoId && videoIds[titleVideoId]
            ? { [titleVideoId]: videoIds[titleVideoId] }
            : videoIds,
      };

      if (tabId) {
        updateBadge(tabId);
      }

      sendResponse({ videoData: data });
    })();
    return true;
  } else if (request.action === "getDownloadInfo") {
    // Return download info for a specific download ID
    // First check in-memory Map, then try storage (for persistence across service worker restarts)
    let info = downloadInfo.get(request.downloadId);

    if (!info) {
      // Try to restore from storage
      chrome.storage.local.get(
        [`downloadInfo_${request.downloadId}`],
        (items) => {
          if (items[`downloadInfo_${request.downloadId}`]) {
            try {
              info = JSON.parse(items[`downloadInfo_${request.downloadId}`]);
              // Restore to in-memory Map for future use
              downloadInfo.set(request.downloadId, info);
              sendResponse({ info: info });
            } catch (e) {
              console.warn("Failed to parse stored download info:", e);
              sendResponse({ info: null });
            }
          } else {
            sendResponse({ info: null });
          }
        },
      );
      return true; // Keep channel open for async response
    }

    sendResponse({ info: info || null });
  } else if (request.action === "download") {
    return handleDownloadAction(
      request,
      sender,
      sendResponse,
      activeDownloads,
      downloadInfo,
      downloadControllers,
      videoData,
      activeChromeDownloads,
    );
  } else if (request.action === "downloadBlobUrl") {
    // Download using blob URL created by content script
    chrome.downloads.download(
      {
        url: request.blobUrl,
        filename: request.filename,
        saveAs: true,
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            success: false,
            error: chrome.runtime.lastError.message,
          });
        } else {
          console.log("Download started with blob URL, ID:", downloadId);
          sendResponse({ success: true });
        }
      },
    );
    return true; // Keep channel open
  } else if (request.action === "cancelDownload") {
    const downloadId = request.downloadId;
    if (!downloadId) {
      sendResponse({ success: false, error: "No downloadId provided" });
      return true;
    }

    // CRITICAL: Set cancellation flag and abort controller IMMEDIATELY
    // This ensures cancellation is detected even if service worker restarts
    chrome.storage.local.set({
      [`downloadCancelled_${downloadId}`]: true,
      [`downloadStatus_${downloadId}`]: "Download cancelled",
    });

    // Abort controller immediately if it exists
    const controllerInfo = downloadControllers.get(downloadId);
    if (controllerInfo?.controller) {
      controllerInfo.controller.abort();
    }

    // Do full cleanup asynchronously
    cancelDownload(
      downloadId,
      downloadControllers,
      activeChromeDownloads,
      activeDownloads,
      downloadInfo,
    )
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
  return true;
});

// Clean up old data when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  delete videoData[tabId];
});

// Update badge when tab is updated (navigation, back/forward, refresh)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.url || !tab.url.includes("dailymotion.com")) return;
  if (
    changeInfo.status === "loading" &&
    isVideoPage(tab.url) &&
    videoData[tabId]
  ) {
    videoData[tabId].urls = [];
    videoData[tabId].activeUrl = null;
    videoData[tabId].videoTitle = null;
    videoData[tabId].videoIds = {};
    return;
  }
  if (changeInfo.status === "complete" && videoData[tabId]?.urls?.length > 0) {
    updateActiveVideo(tabId, extractVideoId(tab.url));
    updateBadge(tabId);
  }
});

function updateBadge(tabId) {
  if (!videoData[tabId]) return;

  try {
    const videoCount = videoData[tabId].urls.filter(isVideoUrlForTab).length;

    chrome.action.setBadgeText({
      text: videoCount > 0 ? videoCount.toString() : "",
      tabId: tabId,
    });
    chrome.action.setBadgeBackgroundColor({ color: "#4CAF50" });
  } catch (e) {
    console.warn("Failed to set badge:", e);
  }
}

async function restoreDownloadInfoFromStorage() {
  try {
    const items = await new Promise((resolve) => {
      chrome.storage.local.get(null, (result) => {
        resolve(result || {});
      });
    });

    // Find all download progress keys
    const downloadKeys = Object.keys(items).filter((key) =>
      key.startsWith("downloadProgress_"),
    );

    for (const key of downloadKeys) {
      const downloadId = key.replace("downloadProgress_", "");
      const progress = items[key];
      const status = items[`downloadStatus_${downloadId}`];
      const isCancelled = items[`downloadCancelled_${downloadId}`];

      // Don't restore if cancelled
      if (isCancelled) {
        continue;
      }

      // Only restore if download is in progress
      if (
        progress !== undefined &&
        progress < 100 &&
        status &&
        !status.toLowerCase().includes("complete") &&
        !status.toLowerCase().includes("failed") &&
        !status.toLowerCase().includes("error") &&
        !status.toLowerCase().includes("cancelled")
      ) {
        // Try to get download info from storage (if we stored it)
        const storedInfo = items[`downloadInfo_${downloadId}`];
        if (storedInfo) {
          try {
            const info = JSON.parse(storedInfo);
            downloadInfo.set(downloadId, info);
          } catch (e) {
            console.warn("Failed to parse stored download info:", e);
          }
        }
      }
    }
  } catch (error) {
    console.warn("Error restoring download info from storage:", error);
  }
}

restoreDownloadInfoFromStorage();
