function extractVideoId(url) {
  if (!url || typeof url !== "string") {
    return null;
  }

  try {
    // Pattern 1: /video/VIDEO_ID (most common - Dailymotion uses alphanumeric IDs like x7abc123)
    let match = url.match(/\/video\/([a-zA-Z0-9]+)/);
    if (match) {
      return match[1];
    }

    // Pattern 2: dailymotion.com/video/VIDEO_ID
    match = url.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/);
    if (match) {
      return match[1];
    }

    // Pattern 3: www.dailymotion.com/video/VIDEO_ID
    match = url.match(/www\.dailymotion\.com\/video\/([a-zA-Z0-9]+)/);
    if (match) {
      return match[1];
    }

    // Pattern 4: video_id in query params
    try {
      const urlObj = new URL(url);
      const params = urlObj.searchParams;
      if (params.has("video_id")) {
        return params.get("video_id");
      }
      // Pattern 5: xid in query params (Dailymotion sometimes uses xid)
      if (params.has("xid")) {
        return params.get("xid");
      }
    } catch (e) {
      // URL parsing failed, continue
    }

    return null;
  } catch (e) {
    return null;
  }
}

function isVideoPage(url) {
  try {
    // If no URL provided and we're in a browser context, use current location
    if (!url && typeof window !== "undefined" && window.location) {
      url = window.location.href;
    }

    if (!url || typeof url !== "string") {
      return false;
    }

    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    // Must have /video/ in pathname followed by a video ID
    const videoPagePattern = /^\/video\/[a-zA-Z0-9]+/;
    return videoPagePattern.test(pathname);
  } catch (e) {
    return false;
  }
}

function cleanVideoTitle(title) {
  if (!title || typeof title !== "string") {
    return null;
  }

  try {
    // Remove common suffixes: " - Dailymotion", " - video Dailymotion", " | Dailymotion", etc.
    let cleaned = title.replace(/\s*[-|]\s*Dailymotion.*$/i, "").trim();
    cleaned = cleaned.replace(/\s*[-|]\s*video\s+Dailymotion.*$/i, "").trim();
    cleaned = cleaned.replace(/\s*[-|]\s*Watch.*Dailymotion.*$/i, "").trim();

    // Remove "Dailymotion Video" and "Dailymotion Video Player" from end or as full title
    cleaned = cleaned
      .replace(/\s*[-|]\s*Dailymotion\s+Video\s+Player.*$/i, "")
      .trim();
    cleaned = cleaned.replace(/\s*[-|]\s*Dailymotion\s+Video\s*$/i, "").trim();
    cleaned = cleaned
      .replace(/^Dailymotion\s+Video\s+Player\s*[-|]?\s*/i, "")
      .trim();
    cleaned = cleaned.replace(/^Dailymotion\s+Video\s*$/i, "").trim();

    // Filter out generic titles (so filename/display never show "Dailymotion Video")
    if (!cleaned || cleaned.length < 2) {
      return null;
    }

    // Strip trailing "video Dailymotion" / "video Dailymotion Player" with or without separator
    cleaned = cleaned
      .replace(/\s+video\s+Dailymotion(\s+Player)?\s*$/i, "")
      .trim();

    const lowerTitle = cleaned.toLowerCase();
    if (
      lowerTitle.match(
        /^(dailymotion|video|dailymotion video|video dailymotion|dailymotion video player|video player)$/i,
      )
    ) {
      return null;
    }

    return cleaned;
  } catch (e) {
    return null;
  }
}

function normalizeToDailymotionQuality(height) {
  if (
    height == null ||
    (typeof height !== "number" && typeof height !== "string")
  )
    return null;
  var n = typeof height === "string" ? parseInt(height, 10) : height;
  if (isNaN(n)) return null;
  if (n <= 240) return 240;
  if (n <= 380) return 380;
  if (n <= 480) return 480;
  if (n <= 720) return 720;
  if (n <= 1080) return 1080;
  if (n <= 1440) return 1440;
  if (n <= 2160) return 2160;
  return 4320; // 8K
}

function getQualityDisplayLabel(quality) {
  if (quality == null) return "Unknown Quality";
  var standard = normalizeToDailymotionQuality(quality);
  return standard != null ? standard + "p" : "Unknown Quality";
}

function getQualityTag(qualityLabel) {
  if (!qualityLabel || typeof qualityLabel !== "string") return null;
  const s = qualityLabel.trim();
  if (s === "MP3") return "MP3";
  const match = s.match(/(\d+)p/i);
  if (!match) return null;
  const p = parseInt(match[1], 10);
  if (p <= 480) return "SD";
  if (p <= 720) return "HD";
  if (p <= 1080) return "FHD";
  if (p <= 1440) return "QHD";
  if (p <= 2160) return "4K";
  if (p <= 4320) return "8K";
  return null;
}

function extractQuality(type, url = "") {
  if (!type && !url) {
    return null;
  }

  // Try to extract from type first (e.g., "mp4-1080p", "hls-1080p", "hls-720p")
  if (type) {
    const match = type.match(/(\d+)p/i);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  // Try to extract from URL if type doesn't have quality
  if (url) {
    const match = url.match(/(\d+)p/i);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return null;
}

function formatQualityLabel(video) {
  if (!video || !video.type) {
    return "Video";
  }

  const quality = extractQuality(video.type, video.url);
  const isMP4 = video.type.includes("mp4") && !video.type.includes("m3u8");
  const isHLS = video.type.includes("m3u8") || video.type.includes("hls");

  let qualityLabel = "";

  if (quality != null) {
    qualityLabel = getQualityDisplayLabel(quality);
  } else if (isHLS && video.type) {
    var typeMatch = video.type.match(/hls-(\d+)p?/i);
    if (typeMatch) {
      qualityLabel = getQualityDisplayLabel(parseInt(typeMatch[1], 10));
    } else if (video.url) {
      if (video.url.includes("4320") || video.url.includes("8k")) {
        qualityLabel = "4320p";
      } else if (video.url.includes("2160") || video.url.includes("4k")) {
        qualityLabel = "2160p";
      } else if (video.url.includes("1440")) {
        qualityLabel = "1440p";
      } else if (video.url.includes("1080") || video.url.includes("hd")) {
        qualityLabel = "1080p";
      } else if (video.url.includes("720")) {
        qualityLabel = "720p";
      } else if (video.url.includes("480")) {
        qualityLabel = "480p";
      } else if (
        video.url.includes("380") ||
        video.url.includes("360") ||
        video.url.includes("288")
      ) {
        qualityLabel = "380p";
      } else if (video.url.includes("240")) {
        qualityLabel = "240p";
      } else {
        qualityLabel = "Unknown Quality";
      }
    } else {
      qualityLabel = "Stream";
    }
  } else {
    if (isHLS) {
      qualityLabel = "Stream";
    } else if (isMP4) {
      qualityLabel = "MP4";
    } else {
      qualityLabel = video.type || "Video";
    }
  }

  // Add format suffix only for MP4; HLS shows quality only (e.g. 720p, 1080p)
  if (isMP4) {
    return `${qualityLabel} (MP4)`;
  }
  return qualityLabel;
}

function fixUrlEncoding(url) {
  if (!url || typeof url !== "string") {
    return url;
  }

  // Fix \\u0026 to & and other common encoding issues
  return url
    .replace(/\\u0026/g, "&")
    .replace(/\\u003d/g, "=")
    .replace(/\\u002f/g, "/");
}

function isChunkedRangeUrl(url) {
  if (!url || typeof url !== "string") {
    return false;
  }

  try {
    const urlObj = new URL(url);
    // Dailymotion range URLs often contain /range/ in the path or a range query param
    if (urlObj.pathname.includes("/range/")) return true;
    if (urlObj.searchParams.has("range") || urlObj.searchParams.has("bytes")) {
      return true;
    }
  } catch (e) {
    // URL parsing failed, check string patterns
  }

  // Check for range request patterns in URL string
  return (
    url.includes("range=") ||
    url.includes("bytes=") ||
    url.match(/\/\d+-\d+\.mp4/) !== null ||
    url.includes("/range/")
  ); // Dailymotion range URLs often contain /range/ in the path
}

function normalizeUrlForDownload(url) {
  if (!url || typeof url !== "string") {
    return url;
  }

  try {
    const urlObj = new URL(url);
    // Remove query params that don't affect the actual video content
    urlObj.searchParams.delete("range");
    urlObj.searchParams.delete("t");
    urlObj.searchParams.delete("timestamp");
    return urlObj.toString();
  } catch (e) {
    return url;
  }
}

function generateDownloadId() {
  return `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function isMP4(type) {
  if (!type || typeof type !== "string") {
    return false;
  }
  return type.includes("mp4") && !type.includes("m3u8");
}

function isHLS(type) {
  if (!type || typeof type !== "string") {
    return false;
  }
  return type.includes("m3u8") || type.includes("hls");
}

function validateJsonResponse(response, responseText) {
  if (!response || !responseText) {
    return false;
  }

  // Check content-type
  const contentType = response.headers.get("content-type") || "";
  const isJson =
    contentType.includes("application/json") ||
    contentType.includes("text/json");

  // Check if response starts with HTML tags (not JSON)
  const trimmed = responseText.trim();
  if (
    trimmed.startsWith("<!DOCTYPE") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<")
  ) {
    return false;
  }

  // If content-type doesn't indicate JSON, check if it looks like JSON
  if (!isJson && !trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return false;
  }

  return true;
}

function formatFileSize(bytes, decimals = 2) {
  if (!bytes || bytes === 0) {
    return "0 Bytes";
  }

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

function isFileTooSmall(fileSize, minSizeBytes = 300 * 1024) {
  if (fileSize === null || fileSize === undefined) {
    return false; // Unknown size, don't filter
  }
  return fileSize < minSizeBytes;
}

function isSegmentPlaylist(url) {
  if (!url || typeof url !== "string") {
    return false;
  }

  return (
    url.includes("/media.m3u8") ||
    (url.includes("/playlist/av/") && url.includes("/avf/"))
  );
}

let firefoxOffscreenIframe = null;

function pingOffscreenDocument() {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 2000);
    chrome.runtime.sendMessage({ action: "ping" }, (response) => {
      clearTimeout(timeout);
      resolve(
        !chrome.runtime.lastError &&
          (response?.ready === true || response?.success === true),
      );
    });
  });
}

async function setupOffscreenDocument() {
  const offscreenPath = "background/offscreen.html";
  const offscreenUrl = chrome.runtime.getURL(offscreenPath);

  // Chrome: use offscreen API
  if (typeof chrome !== "undefined" && chrome.offscreen) {
    try {
      let offscreenExists = false;

      if (chrome.runtime.getContexts) {
        try {
          const contexts = await chrome.runtime.getContexts({
            contextTypes: ["OFFSCREEN_DOCUMENT"],
            documentUrls: [offscreenUrl],
          });
          offscreenExists = contexts.length > 0;
          if (offscreenExists) {
            console.log(
              "Offscreen document already exists (checked via getContexts)",
            );
            return;
          }
        } catch (getContextsError) {
          console.log(
            "getContexts API error, falling back to clients.matchAll():",
            getContextsError,
          );
        }
      }

      if (!offscreenExists) {
        try {
          const allClients = await self.clients.matchAll({
            includeUncontrolled: true,
          });
          for (const client of allClients) {
            if (
              client.url &&
              (client.url.includes("offscreen.html") ||
                client.url === offscreenUrl)
            ) {
              console.log(
                "Offscreen document already exists (checked via clients.matchAll)",
              );
              return;
            }
          }
        } catch (clientsError) {
          console.log(
            "Could not check existing clients, proceeding to create offscreen document",
          );
        }
      }

      console.log("Creating offscreen document at:", offscreenPath);
      await chrome.offscreen.createDocument({
        url: offscreenPath,
        reasons: ["BLOBS"],
        justification:
          "Need to access IndexedDB and create blob URLs for downloads",
      });
      console.log("Offscreen document created successfully");
      await new Promise((resolve) => setTimeout(resolve, 800));
    } catch (error) {
      console.error("Failed to create offscreen document:", error);
      throw error;
    }
    return;
  }

  // Firefox: use a hidden iframe in the background page (same offscreen page, no offscreen API)
  if (typeof document === "undefined" || !document.body) {
    throw new Error(
      "Firefox background has no document (cannot create offscreen iframe).",
    );
  }

  if (firefoxOffscreenIframe && document.contains(firefoxOffscreenIframe)) {
    const ready = await pingOffscreenDocument();
    if (ready) {
      console.log("Firefox: reusing existing hidden offscreen iframe");
      return;
    }
    firefoxOffscreenIframe.remove();
    firefoxOffscreenIframe = null;
  }

  try {
    console.log("Firefox: creating hidden iframe for offscreen page");
    const iframe = document.createElement("iframe");
    iframe.src = offscreenUrl;
    iframe.style.setProperty("position", "fixed");
    iframe.style.setProperty("left", "-9999px");
    iframe.style.setProperty("top", "0");
    iframe.style.setProperty("width", "1px");
    iframe.style.setProperty("height", "1px");
    iframe.style.setProperty("border", "none");
    iframe.style.setProperty("visibility", "hidden");
    iframe.style.setProperty("pointer-events", "none");
    document.body.appendChild(iframe);
    firefoxOffscreenIframe = iframe;

    await new Promise((resolve, reject) => {
      iframe.onload = () => resolve();
      iframe.onerror = () =>
        reject(new Error("Offscreen iframe failed to load"));
    });
    await new Promise((resolve) => setTimeout(resolve, 600));

    const ready = await pingOffscreenDocument();
    if (!ready) {
      throw new Error("Hidden offscreen iframe did not respond to ping");
    }
    console.log("Firefox: hidden offscreen iframe ready");
  } catch (error) {
    if (firefoxOffscreenIframe && firefoxOffscreenIframe.parentNode) {
      firefoxOffscreenIframe.remove();
    }
    firefoxOffscreenIframe = null;
    console.error("Failed to create Firefox hidden offscreen iframe:", error);
    throw error;
  }
}

function cleanupIndexedDBBlob(blobId) {
  try {
    const request = indexedDB.open("DailymotionDownloaderDB", 1);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["blobs"], "readwrite");
      tx.objectStore("blobs").delete(blobId);
      tx.oncomplete = () => {
        db.close();
        console.log("Cleaned up IndexedDB blob:", blobId);
      };
      tx.onerror = () => {
        console.error("Failed to clean up IndexedDB blob:", tx.error);
        db.close();
      };
    };
    request.onerror = () => {
      console.error("Failed to open IndexedDB for cleanup:", request.error);
    };
  } catch (error) {
    console.error("Error cleaning up IndexedDB:", error);
  }
}

function isFeedPage(url) {
  try {
    if (!url && typeof window !== "undefined" && window.location) {
      url = window.location.href;
    }
    if (!url || typeof url !== "string") return false;
    const urlObj = new URL(url);
    const hostname = (urlObj.hostname || "").toLowerCase();
    const pathname = urlObj.pathname.replace(/\/$/, "") || "/";
    const hash = (urlObj.hash || "").toLowerCase();

    // Hash for-you (any path): e.g. dailymotion.com/us#for-you, dailymotion.com/#for-you
    if (hash.includes("for-you")) return true;

    // Explicit feed path
    if (pathname === "/following") return true;

    // Country in path: /pk, /us, /fr, /uk, etc. (2-letter ISO) or /us/for-you, /us/...
    if (/^\/[a-z]{2}(\/|$)/.test(pathname)) return true;

    // Country subdomain: us.dailymotion.com, pk.dailymotion.com, fr.dailymotion.com
    if (/^[a-z]{2}\.(dailymotion\.com|dm\.ly)$/.test(hostname)) return true;

    return false;
  } catch (e) {
    return false;
  }
}

function sanitizeFilenameForDownload(filename) {
  if (!filename || typeof filename !== "string") return "dailymotion_video.mp4";
  const invalid = /[\\/:*?"<>|\u0000-\u001F]/g;
  const lastDot = filename.lastIndexOf(".");
  const ext = lastDot > 0 ? filename.slice(lastDot) : "";
  let base = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  base = base.replace(invalid, " ");
  base = base.replace(/[^\x20-\x7E]/g, " ");
  base = base.replace(/\s+/g, " ").trim();
  base = base.replace(/^[.\s]+|[.\s]+$/g, "");
  if (!base) base = "dailymotion_video";
  const extSafe = /\.(mp4|ts|mkv|webm|mpegts|mp3)$/i.test(ext) ? ext : ".mp4";
  const sanitized = base + extSafe;
  return sanitized.length > 200
    ? base.slice(0, 200 - extSafe.length) + extSafe
    : sanitized;
}

// Export functions for use in different contexts
if (typeof module !== "undefined" && module.exports) {
  // Node.js/CommonJS
  module.exports = {
    extractVideoId,
    isVideoPage,
    cleanVideoTitle,
    extractQuality,
    formatQualityLabel,
    getQualityTag,
    fixUrlEncoding,
    isChunkedRangeUrl,
    normalizeUrlForDownload,
    generateDownloadId,
    isMP4,
    isHLS,
    validateJsonResponse,
    formatFileSize,
    isFileTooSmall,
    isSegmentPlaylist,
    pingOffscreenDocument,
    setupOffscreenDocument,
    cleanupIndexedDBBlob,
    isFeedPage,
    sanitizeFilenameForDownload,
  };
}
