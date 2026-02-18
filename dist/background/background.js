// Import utility functions (paths must be absolute from extension root for service worker)
importScripts("/scripts/utils.js");
importScripts("/scripts/storage.js");
importScripts("/scripts/messaging.js");
importScripts("/background/cancelDownload.js");
importScripts("/background/startDownload.js");
importScripts("/background/downloadBlob.js");
importScripts("/background/downloadM3U8.js");
importScripts("/background/configParser.js");

// Store detected video URLs
let videoData = {};
const processedConfigs = new Set(); // dedupe config/master.json fetches
const activeDownloads = new Map(); // Track active downloads by URL: Map<url, downloadId>
const downloadControllers = new Map(); // Track AbortControllers by downloadId: Map<downloadId, { controller, chromeDownloadId }>
const downloadInfo = new Map(); // Track download info by downloadId: Map<downloadId, { url, filename, tabId, videoId }>
const parsingHLSVariants = new Set(); // Track HLS playlists currently being parsed to prevent duplicate parsing

// Store listener references for cleanup
let webRequestListener = null;
let messageListener = null;
let downloadsListener = null;

// Track active Chrome downloads to monitor their state
// Only primitives/strings here (downloadId, blobUrl string, blobId, filename) — no Blob/ArrayBuffer
const activeChromeDownloads = new Map(); // Map of chromeDownloadId -> { downloadId, blobUrl, blobId, filename }

// Function to clean up all resources
function cleanupAllResources() {
  console.log("Cleaning up all extension resources...");
  try {
    // Remove webRequest listener
    if (webRequestListener) {
      try {
        chrome.webRequest.onBeforeRequest.removeListener(webRequestListener);
        webRequestListener = null;
      } catch (e) {
        // Ignore if already removed
      }
    }

    // Cancel all active downloads
    downloadControllers.forEach(({ controller, chromeDownloadId }) => {
      try {
        if (controller && !controller.signal.aborted) {
          controller.abort();
        }
        // Cancel Chrome download if exists
        if (chromeDownloadId) {
          chrome.downloads.cancel(chromeDownloadId, () => {});
        }
      } catch (e) {
        // Ignore errors during cleanup
      }
    });

    // Clear all data structures
    downloadControllers.clear();
    activeDownloads.clear();
    downloadInfo.clear();
    activeChromeDownloads.clear();
    processedConfigs.clear();
    parsingHLSVariants.clear();
    videoData = {};
    if (
      typeof pendingFileSizes !== "undefined" &&
      pendingFileSizes &&
      pendingFileSizes.clear
    ) {
      pendingFileSizes.clear();
    }

    console.log("Cleanup complete");
  } catch (e) {
    console.warn("Error during cleanup:", e);
  }
}

// Content script files (same order as manifest) — for programmatic injection into tabs that were open before install
const CONTENT_SCRIPT_FILES = [
  "scripts/utils.js",
  "scripts/storage.js",
  "scripts/messaging.js",
  "content/utils.js",
  "content/videoExtraction.js",
  "content/restoreDownloads.js",
  "content/downloadNotifications.js",
  "content/pageTracking.js",
  "content/downloadButton.js",
  "content/content.js",
];

/**
 * Inject content scripts into a Dailymotion tab (e.g. tab was open before extension install).
 * @param {number} tabId
 * @returns {Promise<void>}
 */
// Delays (ms) to ask content script to inject the button after programmatic inject (DOM/React may not be ready at first)
const INJECT_BUTTON_RETRY_DELAYS_MS = [6000, 12000];

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

/**
 * If the tab has no content script (e.g. page was open before install), inject so the download button can appear.
 * @param {number} tabId
 */
function ensureContentScriptInTab(tabId) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, { action: "ping" }, (response) => {
    const err = chrome.runtime.lastError?.message || "";
    if (
      err.includes("Receiving end does not exist") ||
      err.includes("Could not establish connection")
    ) {
      injectContentScriptIntoTab(tabId);
    }
  });
}

// On install/update: inject content scripts into all existing Dailymotion tabs so the download button appears without refresh
chrome.runtime.onInstalled.addListener((details) => {
  if (!chrome.scripting || !chrome.scripting.executeScript) return;
  chrome.tabs.query({ url: "*://*.dailymotion.com/*" }, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id) injectContentScriptIntoTab(tab.id);
    });
    if (tabs.length > 0) {
      console.log(
        "[DM Downloader] Injected content scripts into",
        tabs.length,
        "existing Dailymotion tab(s)",
      );
    }
  });
});

// Clean up on service worker suspend (when extension is disabled/removed)
if (chrome.runtime.onSuspend) {
  chrome.runtime.onSuspend.addListener(() => {
    console.log("Service worker suspending, cleaning up all resources...");
    cleanupAllResources();
    // Clear storage
    chrome.storage.local.clear(() => {});
  });
}

// Stream download from IDB chunks (avoids 2GB allocation when assembly failed)
const STREAM_PATH = "stream";
self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  const base = chrome.runtime.getURL(STREAM_PATH);
  if (!url.startsWith(base) || !url.includes("blobId=")) return;
  event.respondWith(
    (async () => {
      let blobId, chunkCount, totalSize;
      try {
        const u = new URL(url);
        blobId = u.searchParams.get("blobId");
        chunkCount = parseInt(u.searchParams.get("chunkCount"), 10);
        totalSize = parseInt(u.searchParams.get("totalSize"), 10);
        if (
          !blobId ||
          !Number.isFinite(chunkCount) ||
          !Number.isFinite(totalSize)
        ) {
          return new Response("Invalid stream params", { status: 400 });
        }
      } catch (e) {
        return new Response("Bad URL", { status: 400 });
      }
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("DailymotionDownloaderDB", 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = (e) => {
          if (!e.target.result.objectStoreNames.contains("blobs")) {
            e.target.result.createObjectStore("blobs");
          }
        };
      });
      let index = 0;
      const deleteChunksAndClose = () => {
        const tx = db.transaction(["blobs"], "readwrite");
        const store = tx.objectStore("blobs");
        for (let i = 0; i < chunkCount; i++) {
          store.delete(`${blobId}_chunk_${i}`);
        }
        tx.oncomplete = () => db.close();
        tx.onerror = () => db.close();
      };
      const stream = new ReadableStream({
        async pull(controller) {
          if (index >= chunkCount) {
            controller.close();
            deleteChunksAndClose();
            return;
          }
          const chunk = await new Promise((resolve, reject) => {
            const tx = db.transaction(["blobs"], "readonly");
            const req = tx.objectStore("blobs").get(`${blobId}_chunk_${index}`);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          if (!chunk || !(chunk instanceof ArrayBuffer)) {
            controller.close();
            db.close();
            return;
          }
          controller.enqueue(chunk);
          index++;
          if (index >= chunkCount) {
            controller.close();
            deleteChunksAndClose();
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Length": String(totalSize),
          "Content-Type": "video/mp2t",
        },
      });
    })(),
  );
});

// Monitor for extension removal attempts
// When extension is being removed, Chrome will invalidate the runtime context
// We can detect this by checking if we can still access chrome.runtime
let removalCheckInterval = null;

// Periodically prune memory and storage to prevent throttle/freeze
let _cleanupTick = 0;
function checkForRemoval() {
  _cleanupTick += 1;

  // 1) Prune pendingFileSizes
  if (pendingFileSizes.size > 250) {
    const keysToDelete = [...pendingFileSizes.keys()].slice(0, 150);
    keysToDelete.forEach((k) => pendingFileSizes.delete(k));
  }

  // 2) Prune videoData for closed tabs (avoid unbounded growth)
  chrome.tabs.query({}, (tabs) => {
    if (chrome.runtime.lastError) return;
    const existingTabIds = new Set((tabs || []).map((t) => t.id));
    Object.keys(videoData).forEach((tabIdStr) => {
      const tabId = parseInt(tabIdStr, 10);
      if (!existingTabIds.has(tabId)) {
        delete videoData[tabId];
      }
    });
  });

  // 3) Cap in-memory Sets to prevent unbounded growth
  if (processedConfigs.size > 100) {
    const arr = [...processedConfigs];
    arr.slice(0, 50).forEach((x) => processedConfigs.delete(x));
  }
  if (parsingHLSVariants.size > 20) {
    const arr = [...parsingHLSVariants];
    arr.slice(0, 10).forEach((x) => parsingHLSVariants.delete(x));
  }

  // 4) Every 3rd tick: clean stale activeDownloadIds and orphan storage keys
  if (_cleanupTick % 3 === 0) {
    chrome.storage.local.get(["activeDownloadIds"], (r) => {
      const activeIds = r.activeDownloadIds || [];
      if (activeIds.length === 0) return;
      const keysToCheck = activeIds.flatMap((id) => [
        `downloadProgress_${id}`,
        `downloadStatus_${id}`,
      ]);
      chrome.storage.local.get(keysToCheck, (progressResult) => {
        if (!progressResult) progressResult = {};
        const stillActive = activeIds.filter((id) => {
          const progress = progressResult[`downloadProgress_${id}`];
          const status = (
            progressResult[`downloadStatus_${id}`] || ""
          ).toLowerCase();
          if (progress === undefined) return false;
          if (progress === 100) return false;
          if (
            status.includes("complete") ||
            status.includes("cancelled") ||
            status.includes("failed")
          )
            return false;
          return true;
        });
        const staleIds = activeIds.filter((id) => !stillActive.includes(id));
        chrome.storage.local.set({ activeDownloadIds: stillActive }, () => {
          // Remove orphan storage keys for stale download IDs
          staleIds.forEach((id) => {
            chrome.storage.local.remove([
              `downloadProgress_${id}`,
              `downloadStatus_${id}`,
              `downloadInfo_${id}`,
              `downloadCancelled_${id}`,
              `blobReady_${id}`,
            ]);
          });
        });
      });
    });
  }

  // 5) Check extension removal
  if (downloadControllers.size === 0 && activeDownloads.size === 0) {
    try {
      chrome.runtime.id;
    } catch (e) {
      if (e.message && e.message.includes("Extension context invalidated")) {
        cleanupAllResources();
        if (removalCheckInterval) {
          clearInterval(removalCheckInterval);
          removalCheckInterval = null;
        }
      }
    }
  }
}

// Start monitoring (check every 5 seconds when idle)
if (!removalCheckInterval) {
  removalCheckInterval = setInterval(checkForRemoval, 5000);
}

// Listen for network requests to capture video URLs
webRequestListener = (details) => {
  const url = details.url;

  // Only detect URLs if we're on a video page (not country/home pages)
  // Check the tab URL to see if it's a video page
  // Validate tabId first (must be >= 0)
  if (!details.tabId || details.tabId < 0) {
    return; // Invalid tabId, skip
  }

  chrome.tabs.get(details.tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !tab.url) {
      return; // Can't verify page, skip
    }

    // Process if we're on a video page or feed (reels) page
    if (
      !isVideoPage(tab.url) &&
      !(typeof isFeedPage === "function" && isFeedPage(tab.url))
    ) {
      return; // Not a video or feed page, skip URL detection
    }

    // When page requests HLS master playlist, parse it and store variants (same path as config, no master URL stored)
    if (url.includes(".m3u8") && !isSegmentPlaylist(url)) {
      console.log("M3U8 master playlist requested:", url);
      getVideoTitleFromTab(details.tabId).then(({ videoTitle, videoId }) => {
        const finalVideoId = videoId || extractVideoId(url);
        parseAndStoreHLSVariants(
          details.tabId,
          url,
          finalVideoId,
          videoTitle,
          videoData,
          storeVideoUrl,
          parsingHLSVariants,
          getVideoTitleFromDailymotionApi,
        ).catch((err) => {
          console.warn("Error parsing HLS variants from network:", err);
        });
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

      console.log("[DM Downloader] Feed: feedMatch", feedMatch);
      if (
        feedMatch &&
        typeof isFeedPage === "function" &&
        isFeedPage(tab.url)
      ) {
        const videoId = feedMatch[1];

        console.log(
          "[DM Downloader] Feed: sending message to content script",
          videoId,
        );
        chrome.tabs
          .sendMessage(details.tabId, { action: "feedVideoFromApi", videoId })
          .catch(() => {});
      }
    }

    // Config path: master.json → extract HLS master URL(s) → parseAndStoreHLSVariants stores each variant
    // Detect config files (Dailymotion metadata) - fetch and parse it (deduped)
    // Dailymotion may use different config file patterns (config.json, player.json, etc.)
    if (
      url.includes("master.json") ||
      url.includes("config") ||
      url.includes("player.json") ||
      url.includes("metadata.json")
    ) {
      const norm = normalizeConfigUrl(url);
      if (!shouldSkipConfig(norm, processedConfigs)) {
        console.log("Config detected:", url);
        fetchAndParseMasterJson(
          details.tabId,
          url,
          norm,
          videoData,
          storeVideoUrl,
          getVideoTitleFromTab,
          processedConfigs,
          getVideoTitleFromDailymotionApi,
        );
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

// Monitor Chrome downloads to track completion and failures
if (!downloadsListener) {
  downloadsListener = (downloadDelta) => {
    const chromeDownloadId = downloadDelta.id;
    const downloadInfo = activeChromeDownloads.get(chromeDownloadId);

    if (downloadInfo) {
      console.log("Chrome download state changed:", {
        id: chromeDownloadId,
        state: downloadDelta.state,
        error: downloadDelta.error,
        filename: downloadInfo.filename,
      });

      if (downloadDelta.state && downloadDelta.state.current === "complete") {
        console.log("Download completed successfully:", downloadInfo.filename);

        // Clean up verification interval if it exists
        if (downloadInfo.verificationInterval) {
          clearInterval(downloadInfo.verificationInterval);
        }

        // Clear cleanup timer if it exists
        if (downloadInfo.cleanupTimer) {
          clearTimeout(downloadInfo.cleanupTimer);
        }

        // Revoke blob URL in offscreen so GC can free RAM (no global/closure ref to Blob)
        if (downloadInfo.blobUrl) {
          try {
            chrome.runtime.sendMessage(
              { action: "revokeBlobUrl", blobUrl: downloadInfo.blobUrl },
              () => {},
            );
          } catch (e) {}
        }
        activeChromeDownloads.delete(chromeDownloadId);
        cleanupIndexedDBBlob(downloadInfo.blobId);
        console.log(
          "[MEMORY] Released blob references (revoked URL, cleaned IDB) for downloadId:",
          downloadInfo.downloadId,
        );
      } else if (
        downloadDelta.state &&
        downloadDelta.state.current === "interrupted"
      ) {
        const errorMsg = downloadDelta.error?.current || "Unknown error";
        console.error(
          "Download interrupted:",
          errorMsg,
          "for download:",
          chromeDownloadId,
        );

        // Check if we should retry
        if (errorMsg !== "USER_CANCELED") {
          // Try to get more info about the download
          chrome.downloads.search({ id: chromeDownloadId }, (results) => {
            if (results && results.length > 0) {
              const download = results[0];
              console.error("Interrupted download details:", {
                id: chromeDownloadId,
                state: download.state,
                error: download.error,
                bytesReceived: download.bytesReceived,
                totalBytes: download.totalBytes,
                filename: download.filename,
              });
            }
          });
        }

        // Clean up verification interval if it exists
        if (downloadInfo.verificationInterval) {
          clearInterval(downloadInfo.verificationInterval);
        }

        // Clear cleanup timer if it exists
        if (downloadInfo.cleanupTimer) {
          clearTimeout(downloadInfo.cleanupTimer);
        }

        // Revoke blob URL in offscreen so GC can free RAM
        if (downloadInfo.blobUrl) {
          try {
            chrome.runtime.sendMessage(
              { action: "revokeBlobUrl", blobUrl: downloadInfo.blobUrl },
              () => {},
            );
          } catch (e) {}
        }
        activeChromeDownloads.delete(chromeDownloadId);
        cleanupIndexedDBBlob(downloadInfo.blobId);
        console.log(
          "[MEMORY] Released blob references (interrupted, revoked URL, cleaned IDB) for downloadId:",
          downloadInfo.downloadId,
        );
      } else if (
        downloadDelta.state &&
        downloadDelta.state.current === "in_progress"
      ) {
        // Log progress updates
        if (downloadDelta.bytesReceived) {
          const progress = downloadDelta.bytesReceived.current;
          const total = downloadDelta.totalBytes?.current;
          if (total) {
            const percent = Math.round((progress / total) * 100);
            console.log(
              `Download progress: ${percent}% (${Math.round(progress / 1024 / 1024)}MB / ${Math.round(total / 1024 / 1024)}MB)`,
            );
          }
        }
      }
    }
  };

  chrome.downloads.onChanged.addListener(downloadsListener);
  console.log("Chrome downloads listener registered");

  // Check download settings on startup
  checkDownloadSettings();
}

// Map to temporarily store file sizes before URLs are stored
let pendingFileSizes = new Map();

// Listen for response headers to get file sizes
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const url = details.url;

    // Only check file size for MP4 files (HLS playlists don't have meaningful sizes)
    if (url.includes(".mp4") && !isChunkedRangeUrl(url)) {
      const contentLength = details.responseHeaders?.find(
        (h) => h.name.toLowerCase() === "content-length",
      );

      if (contentLength && contentLength.value) {
        const fileSize = parseInt(contentLength.value, 10);
        if (!isNaN(fileSize) && fileSize > 0) {
          // Update the stored URL with file size
          const tabId = details.tabId;
          if (tabId && tabId > 0 && videoData[tabId]) {
            const existingUrl = videoData[tabId].urls.find(
              (item) => item.url === url,
            );
            if (existingUrl) {
              existingUrl.fileSize = fileSize;
            } else {
              // URL not stored yet, store size temporarily for later use
              pendingFileSizes.set(url, fileSize);
            }
          } else if (tabId && tabId > 0) {
            // Tab data doesn't exist yet, store size temporarily
            pendingFileSizes.set(url, fileSize);
            // Cap pendingFileSizes to prevent unbounded memory growth
            if (pendingFileSizes.size > 300) {
              const keysToDelete = [...pendingFileSizes.keys()].slice(0, 100);
              keysToDelete.forEach((k) => pendingFileSizes.delete(k));
            }
          }
        }
      }
    }
  },
  {
    urls: [
      "*://*.dailymotion.com/*",
      "*://*.dmcdn.net/*",
      "*://*.dm-event.net/*",
      "*://*.dmcloud.net/*",
    ],
  },
  ["responseHeaders"],
);

// Get video title: prefer Dailymotion oEmbed API by video ID, fallback to tab title (cleanVideoTitle)
function getVideoTitleFromTab(tabId) {
  return new Promise((resolve) => {
    if (!tabId || tabId < 0) {
      resolve({ videoTitle: null, videoId: null });
      return;
    }

    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab || !tab.url) {
        resolve({ videoTitle: null, videoId: null });
        return;
      }

      const videoId = extractVideoId(tab.url);
      const fallbackTitle = tab.title ? cleanVideoTitle(tab.title) : null;

      // Prefer title from Dailymotion API when we have a video ID
      if (videoId) {
        getVideoTitleFromDailymotionApi(videoId)
          .then((apiTitle) => {
            resolve({
              videoTitle: apiTitle || fallbackTitle,
              videoId,
            });
          })
          .catch(() => {
            resolve({ videoTitle: fallbackTitle, videoId });
          });
      } else {
        resolve({ videoTitle: fallbackTitle, videoId });
      }
    });
  });
}

/** Fetch video title from Dailymotion oEmbed API by video ID (no page title needed). */
async function getVideoTitleFromDailymotionApi(videoId) {
  if (!videoId || typeof videoId !== "string") return null;
  try {
    const url = `https://www.dailymotion.com/services/oembed?url=https://www.dailymotion.com/video/${encodeURIComponent(videoId)}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const title = j && typeof j.title === "string" ? j.title.trim() : null;
    if (title)
      console.log("[title] from Dailymotion API for", videoId, ":", title);
    return title || null;
  } catch (e) {
    console.warn("getVideoTitleFromDailymotionApi failed:", e?.message || e);
    return null;
  }
}

/** Returns the videoId of the currently active URL for this tab, or null. */
function getActiveVideoId(tabId) {
  const data = videoData[tabId];
  if (!data || !data.activeUrl || !Array.isArray(data.urls)) return null;
  return data.urls.find((u) => u.url === data.activeUrl)?.videoId ?? null;
}

/** True if url entry is a real video (HLS variant, etc.), not config or legacy type. */
function isVideoUrlForTab(item) {
  return (
    item.type !== "config" &&
    !item.url.includes("master.json") &&
    !item.url.includes("config") &&
    !item.type.includes("mp4-full")
  );
}

function storeVideoUrl(
  tabId,
  url,
  type,
  fromNetworkRequest = false,
  videoTitle = null,
  videoId = null,
  fileSize = null,
) {
  // Fix URL encoding issues before storing (using utility function)
  url = fixUrlEncoding(url);

  // Skip if tabId is invalid
  if (!tabId || tabId < 0) {
    console.warn("Invalid tabId, skipping URL storage:", { tabId, url, type });
    return;
  }

  // Check if we have a pending file size for this URL (from onHeadersReceived)
  if (fileSize === null && pendingFileSizes && pendingFileSizes.has(url)) {
    fileSize = pendingFileSizes.get(url);
    pendingFileSizes.delete(url); // Clean up
  }

  // Filter out files smaller than 300KB (using utility function)
  if (isFileTooSmall(fileSize)) {
    console.log(
      `Skipping file smaller than 300KB: ${url} (${fileSize ? Math.round(fileSize / 1024) + "KB" : "unknown size"})`,
    );
    return; // Don't store files smaller than 300KB
  }

  if (!videoData[tabId]) {
    videoData[tabId] = {
      urls: [],
      activeUrl: null,
      videoTitle: null,
      videoIds: {},
    };
  }

  // Extract video ID if not provided (using utility function)
  if (!videoId) {
    videoId = extractVideoId(url);
  }

  const currentVideoId = getActiveVideoId(tabId);

  // If we have a new videoId that's different from the current one, clear the old tab-level title
  if (videoId && currentVideoId && videoId !== currentVideoId) {
    console.log(
      `New video detected (${videoId} vs ${currentVideoId}), clearing old title`,
    );
    videoData[tabId].videoTitle = null; // Clear old title when switching videos
  }

  // Store video title per video ID (not just at tab level)
  // CRITICAL: Only update title if it doesn't exist yet, or if this URL is for the CURRENT active video
  // This prevents old videos from getting overwritten with the current page's title
  if (videoTitle && videoId) {
    const isActiveVideo = getActiveVideoId(tabId) === videoId;

    if (!videoData[tabId].videoIds[videoId]) {
      // No title exists for this videoId - create it
      videoData[tabId].videoIds[videoId] = { title: videoTitle };
    } else if (!videoData[tabId].videoIds[videoId].title) {
      // Title exists but is empty/null - set it
      videoData[tabId].videoIds[videoId].title = videoTitle;
    } else if (isActiveVideo) {
      // Title exists AND this is the active video - update it (title might have changed)
      videoData[tabId].videoIds[videoId].title = videoTitle;
    }
    // If title exists and this is NOT the active video, DON'T overwrite it
    // This prevents old videos from getting the wrong title when URLs are detected late
  }

  // Store at tab level only for the currently active video (for backward compatibility)
  // Don't update tab-level title if we're storing a URL for a different video
  // This prevents old videos from getting the new video's title
  if (videoTitle && videoId) {
    const activeVideoId = getActiveVideoId(tabId);
    if (
      !activeVideoId ||
      activeVideoId === videoId ||
      !videoData[tabId].videoTitle
    ) {
      videoData[tabId].videoTitle = videoTitle;
    }
  } else if (videoTitle && !videoData[tabId].videoTitle) {
    // If no videoId but we have a title and no tab-level title, set it
    videoData[tabId].videoTitle = videoTitle;
  }

  // Mark if this came from a network request (actual video being played)
  // vs from config parsing (just available options)
  // This parameter is set by the caller to indicate the source
  const timestamp = Date.now();

  // Avoid duplicates - check exact URL match
  const existingUrl = videoData[tabId].urls.find((item) => item.url === url);
  if (!existingUrl) {
    // When storing HLS variant, drop any stale hls-master entries for same video (we only store variants)
    if (videoId && type.startsWith("hls-") && type !== "hls-master") {
      videoData[tabId].urls = videoData[tabId].urls.filter(
        (item) =>
          !(item.type === "hls-master" && item.videoId === videoId) ||
          item.url === url,
      );
    }

    // Get title for this specific video ID - only use videoId-specific title or provided title, NOT tab-level title
    // This ensures each URL keeps its own title and doesn't get updated when tab-level title changes
    // If videoTitle is null (content script detected URL from different video), preserve existing title
    const urlVideoTitle =
      videoTitle || // Use provided title if available
      (videoId && videoData[tabId].videoIds[videoId]?.title) || // Fallback to stored title for this videoId
      null;

    videoData[tabId].urls.push({
      url,
      type,
      timestamp: timestamp,
      fromNetworkRequest: fromNetworkRequest,
      videoTitle: urlVideoTitle,
      videoId: videoId,
      fileSize: fileSize,
    });
    // Cap URLs per tab to prevent unbounded memory growth (keep most recent)
    const MAX_URLS_PER_TAB = 120;
    if (videoData[tabId].urls.length > MAX_URLS_PER_TAB) {
      videoData[tabId].urls = videoData[tabId].urls.slice(-MAX_URLS_PER_TAB);
      if (
        videoData[tabId].activeUrl &&
        !videoData[tabId].urls.some((u) => u.url === videoData[tabId].activeUrl)
      ) {
        videoData[tabId].activeUrl =
          videoData[tabId].urls[videoData[tabId].urls.length - 1]?.url || null;
      }
    }
    // Cap videoIds per tab: keep only IDs still referenced in urls
    const videoIdKeys = Object.keys(videoData[tabId].videoIds || {});
    if (videoIdKeys.length > 30) {
      const inUse = new Set();
      videoData[tabId].urls.forEach((u) => {
        if (u.videoId != null) {
          inUse.add(u.videoId);
          inUse.add(String(u.videoId));
        }
      });
      const newVideoIds = {};
      videoIdKeys.forEach((k) => {
        if (inUse.has(k)) newVideoIds[k] = videoData[tabId].videoIds[k];
      });
      videoData[tabId].videoIds = newVideoIds;
    }
    console.log("Stored video URL:", {
      tabId,
      url,
      type,
      fromNetworkRequest: fromNetworkRequest,
      videoId: videoId,
      videoTitle: urlVideoTitle,
    });
  } else {
    // Update existing URL timestamp if this is a network request (more recent = more likely playing)
    if (fromNetworkRequest) {
      existingUrl.timestamp = timestamp;
      existingUrl.fromNetworkRequest = true;
    }
    // Update video ID and title
    if (videoId) {
      // If videoId changed, update it
      if (existingUrl.videoId !== videoId) {
        // VideoId changed - the existing title is likely for the old videoId
        // Clear it and use the new videoId's title if available
        existingUrl.videoId = videoId;

        // If the new videoId already has a title stored, use that
        if (videoData[tabId].videoIds[videoId]?.title) {
          existingUrl.videoTitle = videoData[tabId].videoIds[videoId].title;
        } else {
          // No title for new videoId - clear existing title (it's for old videoId)
          existingUrl.videoTitle = null;
        }
      }
    }

    const activeVideoId = getActiveVideoId(tabId);
    const isActiveVideo = activeVideoId === videoId;
    const hasExistingTitle =
      existingUrl.videoTitle &&
      existingUrl.videoTitle !== "Dailymotion Video" &&
      !existingUrl.videoTitle
        .toLowerCase()
        .includes("dailymotion video player");

    if (videoTitle) {
      // Only update if: no existing title, OR this is the active video, OR title is from network request
      if (!hasExistingTitle || isActiveVideo || fromNetworkRequest) {
        existingUrl.videoTitle = videoTitle;
      }
      // If has existing title AND not active video AND not from network request, preserve existing title
    } else if (videoId && videoData[tabId].videoIds[videoId]?.title) {
      // Fallback to videoId's title if no title provided AND existing title is generic/missing
      if (!hasExistingTitle) {
        existingUrl.videoTitle = videoData[tabId].videoIds[videoId].title;
      }
    }
    // Update file size if provided and not already set
    if (fileSize !== null && fileSize !== undefined && !existingUrl.fileSize) {
      existingUrl.fileSize = fileSize;
    }
  }

  // Update active video: the most recent video from a network request is the one playing
  // This happens after storing/updating, so we can find the most recent one
  updateActiveVideo(tabId);

  // Update badge (only if tabId is valid)
  updateBadge(tabId);
}

// Update which video is marked as active (currently playing)
// On feed pages we skip pruning so multiple reels keep their URLs for per-reel download buttons
function updateActiveVideo(tabId, currentVideoId = null) {
  if (!videoData[tabId] || !videoData[tabId].urls.length) return;

  chrome.tabs.get(tabId, (tab) => {
    const skipPrune =
      tab && typeof isFeedPage === "function" && isFeedPage(tab.url);

    const videoUrls = videoData[tabId].urls.filter(isVideoUrlForTab);
    if (videoUrls.length === 0) return;

    const previousActiveVideoId = getActiveVideoId(tabId);
    videoData[tabId].urls.forEach((item) => (item.active = false));

    if (currentVideoId) {
      const matchingVideos = videoUrls.filter(
        (v) => v.videoId === currentVideoId,
      );
      if (matchingVideos.length > 0) {
        // Mark all videos with matching videoId as active
        matchingVideos.forEach((v) => (v.active = true));
        // Set the most recent one as the active URL
        const mostRecent = matchingVideos.reduce((latest, current) =>
          (current.timestamp || 0) > (latest.timestamp || 0) ? current : latest,
        );
        videoData[tabId].activeUrl = mostRecent.url;

        // If video changed, clear old tab-level title and update with new one
        if (previousActiveVideoId && previousActiveVideoId !== currentVideoId) {
          console.log(
            `Video changed from ${previousActiveVideoId} to ${currentVideoId}, clearing old title`,
          );
          videoData[tabId].videoTitle = null;
          // Try to get fresh title from tab
          getVideoTitleFromTab(tabId).then(({ videoTitle }) => {
            if (videoTitle) {
              videoData[tabId].videoTitle = videoTitle;
              // Update videoId-specific title mapping
              if (currentVideoId) {
                if (!videoData[tabId].videoIds[currentVideoId]) {
                  videoData[tabId].videoIds[currentVideoId] = {
                    title: videoTitle,
                  };
                } else {
                  videoData[tabId].videoIds[currentVideoId].title = videoTitle;
                }
              }
              // Update only URLs for this specific videoId with the new title
              // But only if they don't already have a valid title (preserve existing titles)
              videoData[tabId].urls.forEach((url) => {
                if (url.videoId === currentVideoId) {
                  const hasValidTitle =
                    url.videoTitle &&
                    url.videoTitle !== "Dailymotion Video" &&
                    !url.videoTitle
                      .toLowerCase()
                      .includes("dailymotion video player");
                  // Only update if no valid title exists (preserve existing titles)
                  if (!hasValidTitle) {
                    url.videoTitle = videoTitle;
                  }
                }
              });
            }
          });
        }

        if (!skipPrune) {
          const activeVideoIdForPrune = currentVideoId;
          videoData[tabId].urls = videoData[tabId].urls.filter(
            (u) => u.videoId === activeVideoIdForPrune,
          );
          if (videoData[tabId].videoIds && activeVideoIdForPrune) {
            const keepTitle = videoData[tabId].videoIds[activeVideoIdForPrune];
            videoData[tabId].videoIds = keepTitle
              ? { [activeVideoIdForPrune]: keepTitle }
              : {};
          }
        }

        console.log("Active video updated (by videoId):", {
          videoId: currentVideoId,
          url: mostRecent.url,
          type: mostRecent.type,
          count: matchingVideos.length,
        });
        return;
      }
    }

    // Find the most recent video that came from a network request (not from config parsing)
    const networkRequestVideos = videoUrls.filter((v) => v.fromNetworkRequest);

    if (networkRequestVideos.length === 0) {
      // If no network request videos, use the most recent video overall (but not config)
      const mostRecent = videoUrls.reduce((latest, current) =>
        (current.timestamp || 0) > (latest.timestamp || 0) ? current : latest,
      );
      if (mostRecent) {
        mostRecent.active = true;
        videoData[tabId].activeUrl = mostRecent.url;
        if (!skipPrune && mostRecent.videoId) {
          const activeVideoIdForPrune = mostRecent.videoId;
          videoData[tabId].urls = videoData[tabId].urls.filter(
            (u) => u.videoId === activeVideoIdForPrune,
          );
          if (videoData[tabId].videoIds) {
            const keepTitle = videoData[tabId].videoIds[activeVideoIdForPrune];
            videoData[tabId].videoIds = keepTitle
              ? { [activeVideoIdForPrune]: keepTitle }
              : {};
          }
        }
      }
      return;
    }

    // Group network request videos by video ID
    // If multiple videos share the same video ID, they're likely the same video (different qualities)
    // In this case, prefer the one with the most recent timestamp
    const videosByVideoId = {};
    networkRequestVideos.forEach((v) => {
      const key = v.videoId || "unknown";
      if (
        !videosByVideoId[key] ||
        (v.timestamp || 0) > (videosByVideoId[key].timestamp || 0)
      ) {
        videosByVideoId[key] = v;
      }
    });

    // Find the most recent video (across all video IDs)
    const mostRecentNetwork = Object.values(videosByVideoId).reduce(
      (latest, current) =>
        (current.timestamp || 0) > (latest.timestamp || 0) ? current : latest,
    );

    // Mark the most recent network request video as active
    mostRecentNetwork.active = true;
    videoData[tabId].activeUrl = mostRecentNetwork.url;

    // Also mark all videos with the same video ID as active (they're the same video, different qualities)
    if (mostRecentNetwork.videoId) {
      videoUrls.forEach((v) => {
        if (v.videoId === mostRecentNetwork.videoId) {
          v.active = true;
        }
      });
    }

    if (!skipPrune && mostRecentNetwork.videoId) {
      const activeVideoIdForPrune = mostRecentNetwork.videoId;
      videoData[tabId].urls = videoData[tabId].urls.filter(
        (u) => u.videoId === activeVideoIdForPrune,
      );
      if (videoData[tabId].videoIds) {
        const keepTitle = videoData[tabId].videoIds[activeVideoIdForPrune];
        videoData[tabId].videoIds = keepTitle
          ? { [activeVideoIdForPrune]: keepTitle }
          : {};
      }
    }

    console.log("Active video updated:", {
      url: mostRecentNetwork.url,
      type: mostRecentNetwork.type,
      videoId: mostRecentNetwork.videoId,
      videoTitle: mostRecentNetwork.videoTitle,
      timestamp: mostRecentNetwork.timestamp,
    });
  });
}

// normalizeConfigUrl is now in utils.js - using it directly
// Config parsing functions (fetchAndParseMasterJson, shouldSkipConfig) are now in configParser.js

// URL utility functions (isChunkedRangeUrl, extractBaseUrlFromRange) are now in scripts/utils.js

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle ping to wake up service worker
  if (request.action === "ping") {
    sendResponse({ success: true });
    return true;
  }

  // Handle offscreen document ready signal
  if (request.action === "offscreenReady") {
    console.log(
      "Offscreen document sent ready signal. FFmpegHelper available:",
      request.ffmpegAvailable === true,
    );
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
    // If tabId is null/undefined, try to get it from sender
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

      console.log(
        "Sending video data for tabId:",
        tabId,
        "(current video only, URLs:",
        data.urls.length,
        ")",
      );
      sendResponse({ videoData: data });
      if (tabId && data.urls.length > 0) {
        ensureContentScriptInTab(tabId);
      }
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
      cleanupIndexedDBBlob,
      setupOffscreenDocument,
      blobToDataUrl,
    );
  } else if (request.action === "storeFromContent") {
    // URLs only come from config → parseAndStoreHLSVariants; no storage from content script.
    sendResponse({ success: true });
  } else if (request.action === "parseConfig") {
    // Manually parse a config file
    fetchAndParseMasterJson(
      request.tabId,
      request.url,
      normalizeConfigUrl(request.url),
      videoData,
      storeVideoUrl,
      getVideoTitleFromTab,
      processedConfigs,
      getVideoTitleFromDailymotionApi,
    )
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((err) => {
        console.error("Parse config error:", err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep channel open for async
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
      cleanupIndexedDBBlob,
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

// Download starting functions are now in startDownload.js
// Blob download functions (downloadFullVideoFile, downloadVideo, setupOffscreenDocument,
// blobToDataUrl, cleanupIndexedDBBlob, supportsObjectUrl) are now in downloadBlob.js
// HLS/M3U8 functions (getFetchOptionsWithHeaders, parseM3U8, parseMasterPlaylist,
// downloadAndMergeM3U8, findDailymotionTabId in downloadM3U8.js; parseAndStoreHLSVariants in configParser.js
// Config parsing functions (fetchAndParseMasterJson, shouldSkipConfig) are now in configParser.js
// URL utilities (isChunkedRangeUrl, extractBaseUrlFromRange) are now in scripts/utils.js

// Check Chrome download settings and warn if downloads might be blocked
async function checkDownloadSettings() {
  try {
    // Check if downloads are disabled
    chrome.downloads.search({}, (results) => {
      // This will fail if downloads API is blocked
      if (chrome.runtime.lastError) {
        console.warn(
          "Chrome downloads API error:",
          chrome.runtime.lastError.message,
        );
        console.warn(
          "This might indicate downloads are blocked in this Chrome profile",
        );
      }
    });
  } catch (e) {
    console.warn("Could not check download settings:", e);
  }
}

// Clean up old data when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  delete videoData[tabId];
});

// Update badge when tab is updated (navigation, back/forward, refresh)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only process Dailymotion tabs
  if (!tab.url || !tab.url.includes("dailymotion.com")) {
    return;
  }

  // When navigation starts (including refresh), clear stored URLs for this tab
  // so we don't accumulate duplicates when the same page is refreshed
  if (changeInfo.status === "loading") {
    if (isVideoPage(tab.url) && videoData[tabId]) {
      videoData[tabId].urls = [];
      videoData[tabId].activeUrl = null;
      videoData[tabId].videoTitle = null;
      videoData[tabId].videoIds = {};
    }
    return;
  }

  // When page finishes loading, update badge and reset active flags for new page
  if (changeInfo.status === "complete") {
    // Extract video ID from current URL
    const currentVideoId = extractVideoId(tab.url);

    // If we have video data for this tab, update active flags based on current page
    if (videoData[tabId] && videoData[tabId].urls.length > 0) {
      // Update active video based on current page's videoId
      updateActiveVideo(tabId, currentVideoId);

      // Update badge count
      updateBadge(tabId);
    }
  }
});

// Helper function to update badge for a tab
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

console.log("Dailymotion Downloader background script loaded");

// Restore download info from storage when service worker starts
// This ensures downloads can be tracked even after service worker restart
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
        console.log(
          "Skipping cancelled download info restoration:",
          downloadId,
        );
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
            console.log(
              "Restored download info from storage:",
              downloadId,
              info.filename,
            );
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

// Restore download info on startup
restoreDownloadInfoFromStorage();
