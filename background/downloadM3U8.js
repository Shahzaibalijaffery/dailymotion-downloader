function getBaseUrl(url) {
  return url.substring(0, url.lastIndexOf("/") + 1);
}

function resolvePlaylistUri(uri, baseUrl) {
  if (uri.startsWith("http://") || uri.startsWith("https://")) return uri;
  if (uri.startsWith("/")) {
    const urlObj = new URL(baseUrl);
    return `${urlObj.protocol}//${urlObj.host}${uri}`;
  }
  if (uri.startsWith("./")) return baseUrl + uri.substring(2);
  return baseUrl + uri;
}

function getMasterPlaylistInfo(playlistText) {
  const hasVideoVariants =
    playlistText && playlistText.includes("#EXT-X-STREAM-INF");
  const hasAudioMedia =
    playlistText && /#EXT-X-MEDIA:.*TYPE=AUDIO/i.test(playlistText);
  return { hasVideoVariants, hasAudioMedia };
}

async function getFetchOptionsWithHeaders(
  url,
  tabId = null,
  abortController = null,
) {
  const options = {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://www.dailymotion.com/",
      Origin: "https://www.dailymotion.com",
    },
  };

  if (abortController?.signal) options.signal = abortController.signal;
  if (tabId && tabId !== -1) {
    try {
      const cookies = await chrome.cookies.getAll({
        url: "https://www.dailymotion.com",
      });
      if (cookies && cookies.length > 0) {
        const cookieString = cookies
          .map((c) => `${c.name}=${c.value}`)
          .join("; ");
        options.headers["Cookie"] = cookieString;
      }
    } catch (e) {
      console.warn("Could not get cookies for tab:", e);
    }
  }

  return options;
}

const BLOB_DB_NAME = "DailymotionDownloaderDB";
const BLOB_STORE = "blobs";

function openBlobDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BLOB_DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      if (!e.target.result.objectStoreNames.contains(BLOB_STORE)) {
        e.target.result.createObjectStore(BLOB_STORE);
      }
    };
  });
}

async function putBlobInIDB(blob) {
  const blobId = `blob_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  const buf = await blob.arrayBuffer();
  const db = await openBlobDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction([BLOB_STORE], "readwrite");
    tx.objectStore(BLOB_STORE).put(buf, blobId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      console.error("[downloadM3U8] putBlobInIDB tx error", tx.error);
      reject(tx.error);
    };
  });
  db.close();
  return blobId;
}

async function putBlobChunksInIDB(db, blobIdPrefix, blobs, options = {}) {
  const { onProgress, downloadId } = options;
  for (let i = 0; i < blobs.length; i++) {
    const buf =
      blobs[i] instanceof ArrayBuffer ? blobs[i] : await blobs[i].arrayBuffer();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([BLOB_STORE], "readwrite");
      tx.objectStore(BLOB_STORE).put(buf, `${blobIdPrefix}_chunk_${i}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    if (onProgress) onProgress(i + 1, blobs.length);
    if (downloadId && i % 15 === 0 && blobs.length > 15) {
      await chrome.storage.local.set({
        [`downloadStatus_${downloadId}`]: `Storing (batch ${i + 1}/${blobs.length})...`,
      });
    }
  }
}

function buffersToSegmentBlobs(
  segmentBuffers,
  blobBatchSize,
  mimeType = "video/mp4",
) {
  const out = [];
  for (let i = 0; i < segmentBuffers.length; i += blobBatchSize) {
    const batch = segmentBuffers.slice(
      i,
      Math.min(i + blobBatchSize, segmentBuffers.length),
    );
    out.push(new Blob(batch, { type: mimeType }));
  }
  return out;
}

async function setDownloadProgress(downloadId, percent, status) {
  const payload = { [`downloadProgress_${downloadId}`]: percent };
  if (status != null) payload[`downloadStatus_${downloadId}`] = status;
  await chrome.storage.local.set(payload);
}

function parseM3U8(playlistText, baseUrl) {
  const lines = playlistText.split("\n");
  const segments = [];
  let initSegmentUrl = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const upper = line.toUpperCase();

    if (upper.startsWith("#EXT-X-MAP")) {
      const uriMatch =
        line.match(/URI=["']?([^"'\s]+)["']?/i) ||
        line.match(/(https?:\/\/[^\s"']+|\.\/[^\s"']+|\/[^\s"']+)/);
      if (uriMatch) {
        try {
          initSegmentUrl = resolvePlaylistUri(
            decodeURIComponent(uriMatch[1].trim()),
            baseUrl,
          );
        } catch (e) {
          initSegmentUrl = resolvePlaylistUri(uriMatch[1].trim(), baseUrl);
        }
      }
      continue;
    }
    if (line.startsWith("#") || !line) continue;
    if (line) segments.push(resolvePlaylistUri(line, baseUrl));
  }
  return { segments, initSegmentUrl };
}

function parseMasterPlaylist(playlistText, baseUrl) {
  const lines = playlistText.split("\n");
  const variants = [];
  let currentVariant = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith("#EXT-X-STREAM-INF")) {
      // Extract quality/bandwidth info
      const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
      const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
      const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0;
      const resolution = resolutionMatch ? resolutionMatch[1] : "unknown";

      currentVariant = { bandwidth, resolution };
    } else if (line && !line.startsWith("#") && currentVariant) {
      currentVariant.url = resolvePlaylistUri(line, baseUrl);
      variants.push(currentVariant);
      currentVariant = null;
    }
  }

  variants.sort((a, b) => b.bandwidth - a.bandwidth);
  return variants;
}

function parseMasterPlaylistAudio(playlistText, baseUrl) {
  const lines = playlistText.split("\n");
  const audioTracks = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXT-X-MEDIA:")) continue;

    const typeMatch = line.match(/TYPE=([^,]+)/i);
    if (!typeMatch || typeMatch[1].toUpperCase() !== "AUDIO") continue;

    const uriMatch = line.match(/URI="([^"]+)"/) || line.match(/URI='([^']+)'/);
    if (!uriMatch || !uriMatch[1]) continue;

    const nameMatch =
      line.match(/NAME="([^"]+)"/) || line.match(/NAME='([^']+)'/);
    const name = nameMatch ? nameMatch[1] : "Audio";
    try {
      const trackUrl = resolvePlaylistUri(uriMatch[1].trim(), baseUrl);
      audioTracks.push({ url: trackUrl, name });
    } catch (e) {
      continue;
    }
  }

  return audioTracks;
}

async function getSegmentCountForM3u8Url(m3u8Url, tabId = null) {
  if (!m3u8Url || typeof m3u8Url !== "string") return { segmentCount: 0 };
  try {
    const url = fixUrlEncoding(m3u8Url);
    const opts = await getFetchOptionsWithHeaders(url, tabId, null);
    const res = await fetch(url, opts);
    if (!res.ok) return { segmentCount: 0 };
    const text = await res.text();
    if (!text || !text.trim()) return { segmentCount: 0 };
    const baseUrl = getBaseUrl(url);
    const { hasVideoVariants: isMaster } = getMasterPlaylistInfo(text);
    let segments;
    if (isMaster) {
      const variants = parseMasterPlaylist(text, baseUrl);
      if (variants.length === 0) return { segmentCount: 0 };
      const variantUrl = fixUrlEncoding(variants[0].url);
      const vOpts = await getFetchOptionsWithHeaders(variantUrl, tabId, null);
      const vRes = await fetch(variantUrl, vOpts);
      if (!vRes.ok) return { segmentCount: 0 };
      const vText = await vRes.text();
      segments = parseM3U8(vText || "", getBaseUrl(variantUrl)).segments || [];
    } else {
      segments = parseM3U8(text, baseUrl).segments || [];
    }
    return { segmentCount: segments.length };
  } catch (e) {
    return { segmentCount: 0 };
  }
}

function parseMasterPlaylistToVariants(playlistText, masterPlaylistUrl) {
  const { hasVideoVariants, hasAudioMedia } =
    getMasterPlaylistInfo(playlistText);
  const baseUrl = getBaseUrl(masterPlaylistUrl);
  return {
    variants: hasVideoVariants
      ? parseMasterPlaylist(playlistText, baseUrl)
      : [],
    audioTracks: hasAudioMedia
      ? parseMasterPlaylistAudio(playlistText, baseUrl)
      : [],
  };
}

async function convertVideoToMp3AndDownload(
  blobId,
  inputFormat,
  mp3Filename,
  downloadId,
  downloadControllers,
  activeChromeDownloads,
) {
  await setupOffscreenDocument();
  const CONVERT_MP3_TIMEOUT_MS = 6 * 60 * 1000; // 6 min (offscreen has 5 min helper timeout)
  const result = await new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      resolve({
        success: false,
        error:
          "MP3 conversion timed out. The helper may not support convertToMp3 or did not respond.",
      });
    }, CONVERT_MP3_TIMEOUT_MS);
    chrome.runtime.sendMessage(
      { action: "convertToMp3", blobId, inputFormat },
      (r) => {
        clearTimeout(timeoutId);
        resolve(r || { success: false });
      },
    );
  });
  if (!result.success || !result.outputBlobId) {
    throw new Error(result.error || "MP3 conversion failed");
  }
  await chrome.storage.local.set({
    [`downloadStatus_${downloadId}`]: "Saving MP3...",
  });
  await downloadBlob(
    {
      blobId: result.outputBlobId,
      mimeType: result.mimeType || "audio/mpeg",
    },
    mp3Filename,
    downloadId,
    downloadControllers,
    activeChromeDownloads,
  );
  cleanupIndexedDBBlob(result.outputBlobId);
}

const M3U8_STORAGE_KEYS = [
  "downloadProgress",
  "downloadStatus",
  "downloadInfo",
  "downloadCancelled",
  "downloadSegments",
  "blobReady",
];

function cleanupM3U8Storage(downloadId, delayMs) {
  const keys = M3U8_STORAGE_KEYS.map((k) => `${k}_${downloadId}`);
  setTimeout(() => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError)
        console.error(
          "Error cleaning up download storage:",
          chrome.runtime.lastError,
        );
    });
  }, delayMs);
}

async function getSegmentsAndInitFromPlaylist(m3u8Url, tabId, abortController) {
  m3u8Url = fixUrlEncoding(m3u8Url);
  const fetchOpts = await getFetchOptionsWithHeaders(
    m3u8Url,
    tabId,
    abortController,
  );
  const playlistResponse = await fetch(m3u8Url, fetchOpts);
  if (!playlistResponse.ok) {
    throw new Error(
      `Failed to fetch playlist: HTTP ${playlistResponse.status} ${playlistResponse.statusText}`,
    );
  }
  let playlistText = await playlistResponse.text();
  if (!playlistText || !playlistText.trim()) {
    throw new Error("Playlist file is empty or invalid");
  }

  const { hasVideoVariants: isMasterPlaylist } =
    getMasterPlaylistInfo(playlistText);
  let segments = [];
  let initSegmentUrl = null;

  if (isMasterPlaylist) {
    const baseUrl = getBaseUrl(m3u8Url);
    const variantPlaylists = parseMasterPlaylist(playlistText, baseUrl);
    if (variantPlaylists.length === 0) {
      throw new Error("No variant playlists found in master playlist");
    }
    let variantUrl = fixUrlEncoding(variantPlaylists[0].url);
    if (abortController.signal.aborted) {
      throw new DOMException("Download cancelled", "AbortError");
    }
    const variantOpts = await getFetchOptionsWithHeaders(
      variantUrl,
      tabId,
      abortController,
    );
    const variantResponse = await fetch(variantUrl, variantOpts);
    if (!variantResponse.ok) {
      throw new Error(
        `Failed to fetch variant playlist: HTTP ${variantResponse.status} ${variantResponse.statusText}`,
      );
    }
    const variantText = await variantResponse.text();
    if (!variantText || !variantText.trim()) {
      throw new Error("Variant playlist file is empty or invalid");
    }
    const parsed = parseM3U8(variantText, getBaseUrl(variantUrl));
    segments = parsed.segments;
    initSegmentUrl =
      parsed.initSegmentUrl || parseM3U8(playlistText, baseUrl).initSegmentUrl;
  } else {
    const parsed = parseM3U8(playlistText, getBaseUrl(m3u8Url));
    segments = parsed.segments;
    initSegmentUrl = parsed.initSegmentUrl;
  }

  if (segments.length === 0) {
    throw new Error("No segments found in playlist");
  }

  const isMPEGTS = segments.some(
    (seg) => seg.includes(".ts") || seg.endsWith(".ts"),
  );
  return { segments, initSegmentUrl, isMPEGTS };
}

async function downloadInitSegmentWithRetry(
  initSegmentUrl,
  tabId,
  abortController,
  retries = 3,
) {
  initSegmentUrl = fixUrlEncoding(initSegmentUrl);
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (abortController.signal.aborted) {
      throw new DOMException("Download cancelled", "AbortError");
    }
    try {
      const opts = await getFetchOptionsWithHeaders(
        initSegmentUrl,
        tabId,
        abortController,
      );
      const res = await fetch(initSegmentUrl, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = await res.arrayBuffer();
      if (data.byteLength < 8) throw new Error("Init segment too small");
      const view = new Uint8Array(data);
      const hasFtyp =
        view[4] === 0x66 &&
        view[5] === 0x74 &&
        view[6] === 0x79 &&
        view[7] === 0x70;
      if (!hasFtyp) throw new Error("Init segment missing ftyp box");
      return data;
    } catch (err) {
      if (err.name === "AbortError" || abortController.signal.aborted)
        throw err;
      if (attempt === retries) return null;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return null;
}

async function downloadSegmentsToSegmentData(
  segments,
  tabId,
  abortController,
  downloadId,
  batchSize = 10,
) {
  const MIN_SUCCESS_RATE = 0.98;
  const segmentData = [];
  const failedSegments = [];

  const downloadOne = async (segmentUrl, index, retries = 4) => {
    const url = fixUrlEncoding(segmentUrl);
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (
        abortController.signal.aborted ||
        (await isDownloadCancelled(downloadId))
      ) {
        throw new DOMException("Download cancelled", "AbortError");
      }
      try {
        const opts = await getFetchOptionsWithHeaders(
          url,
          tabId,
          abortController,
        );
        const res = await fetch(url, opts);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const buf = await res.arrayBuffer();
        return { success: true, data: buf, index };
      } catch (err) {
        if (err.name === "AbortError" || abortController.signal.aborted)
          throw err;
        if (await isDownloadCancelled(downloadId))
          throw new DOMException("Download cancelled", "AbortError");
        if (attempt === retries) {
          return {
            success: false,
            index,
            url: segmentUrl,
            error: err.message || "Unknown",
          };
        }
        await new Promise((r) =>
          setTimeout(r, 1000 * (attempt + 1) + Math.random() * 500),
        );
      }
    }
    return { success: false, index, url: segmentUrl, error: "Unknown" };
  };

  for (
    let batchStart = 0;
    batchStart < segments.length;
    batchStart += batchSize
  ) {
    if (
      abortController.signal.aborted ||
      (await isDownloadCancelled(downloadId))
    ) {
      throw new DOMException("Download cancelled", "AbortError");
    }
    const batchEnd = Math.min(batchStart + batchSize, segments.length);
    const batchNum = Math.floor(batchStart / batchSize) + 1;
    const totalBatches = Math.ceil(segments.length / batchSize);
    await chrome.storage.local.set({
      [`downloadProgress_${downloadId}`]: Math.round(
        (batchStart / segments.length) * 85,
      ),
      [`downloadStatus_${downloadId}`]: `Downloading ${batchNum}/${totalBatches} (${batchStart + 1}-${batchEnd}/${segments.length})`,
    });
    const promises = [];
    for (let i = batchStart; i < batchEnd; i++) {
      promises.push(downloadOne(segments[i], i));
    }
    const results = await Promise.all(promises);
    for (const r of results) {
      if (r.success) segmentData.push(r);
      else failedSegments.push(r);
    }
    if (batchStart + batchSize < segments.length) {
      await new Promise((r) =>
        setTimeout(r, segments.length > 500 ? 200 : 100),
      );
    }
  }

  // Retry failed segments once with more attempts
  if (failedSegments.length > 0) {
    await chrome.storage.local.set({
      [`downloadProgress_${downloadId}`]: 85,
      [`downloadStatus_${downloadId}`]: `Retrying ${failedSegments.length} segments...`,
    });
    for (const failed of failedSegments) {
      if (
        abortController.signal.aborted ||
        (await isDownloadCancelled(downloadId))
      ) {
        throw new DOMException("Download cancelled", "AbortError");
      }
      const retryResult = await downloadOne(failed.url, failed.index, 6);
      if (retryResult.success) segmentData.push(retryResult);
    }
  }

  segmentData.sort((a, b) => a.index - b.index);
  const successRate = segmentData.length / segments.length;
  if (successRate < MIN_SUCCESS_RATE) {
    const msg = `Too many segments failed (${segmentData.length}/${segments.length}, ${(successRate * 100).toFixed(1)}%). Please try again or use MP4 if available.`;
    await chrome.storage.local.set({
      [`downloadProgress_${downloadId}`]: 0,
      [`downloadStatus_${downloadId}`]: msg,
    });
    throw new Error(msg);
  }
  const missingIndices = [];
  for (let i = 0; i < segments.length; i++) {
    if (!segmentData.some((s) => s.index === i)) missingIndices.push(i);
  }
  if (
    missingIndices.length > 0 &&
    missingIndices.filter((i) => i < 10).length > 0
  ) {
    throw new Error(
      "Critical segments missing at the beginning. Please try again.",
    );
  }
  return segmentData;
}

// download streaming
async function downloadAndMergeM3U8(
  m3u8Url,
  filename,
  downloadId,
  abortController,
  tabId = null,
  downloadControllers,
  activeChromeDownloads,
  convertToMp3 = false,
) {
  const mp3Filename = convertToMp3
    ? filename.replace(/\.[^.]+$/, "") + ".mp3"
    : filename;
  try {
    await setDownloadProgress(
      downloadId,
      1,
      convertToMp3 ? "Fetching playlist (MP3)..." : "Fetching playlist...",
    );
    if (abortController.signal.aborted) {
      throw new DOMException("Download cancelled", "AbortError");
    }

    const { segments, initSegmentUrl, isMPEGTS } =
      await getSegmentsAndInitFromPlaylist(m3u8Url, tabId, abortController);
    await setDownloadProgress(downloadId, 2, "Parsing playlist...");
    await chrome.storage.local.set({
      [`downloadSegments_${downloadId}`]: segments.length,
    });

    let initSegmentData = null;
    if (initSegmentUrl) {
      try {
        initSegmentData = await downloadInitSegmentWithRetry(
          initSegmentUrl,
          tabId,
          abortController,
        );
      } catch (e) {
        if (e.name === "AbortError") throw e;
        initSegmentData = null;
      }
    }

    let segmentData = await downloadSegmentsToSegmentData(
      segments,
      tabId,
      abortController,
      downloadId,
      segments.length > 800 ? 5 : 10,
    );
    console.log("[downloadM3U8] Segments downloaded", { downloadId, segmentCount: segmentData.length, expected: segments.length });

    await chrome.storage.local.set({
      [`downloadProgress_${downloadId}`]: 95,
      [`downloadStatus_${downloadId}`]: "Merging segments...",
    });

    let segmentBuffers = segmentData.map((s) => s.data);
    const blobBatchSize = 50;
    const segmentMimeType = isMPEGTS ? "video/mp2t" : "video/mp4";
    let validBuffers = segmentBuffers.filter((b) => b.byteLength > 0);
    let segmentBlobs = [];
    for (let i = 0; i < validBuffers.length; i += blobBatchSize) {
      const batch = validBuffers.slice(
        i,
        Math.min(i + blobBatchSize, validBuffers.length),
      );
      segmentBlobs.push(new Blob(batch, { type: segmentMimeType }));
    }

    let finalBlobs = [];
    if (initSegmentData && !isMPEGTS) {
      finalBlobs.push(new Blob([initSegmentData], { type: "video/mp4" }));
    }
    finalBlobs.push(...segmentBlobs.filter((b) => b.size > 0));

    let finalFilename = filename || "dailymotion_video.mp4";
    if (finalFilename.includes(".m3u8")) {
      finalFilename = isMPEGTS
        ? finalFilename.replace(/\.m3u8$/i, ".ts").replace(/\.m3u8\./i, ".ts.")
        : finalFilename
            .replace(/\.m3u8$/i, ".mp4")
            .replace(/\.m3u8\./i, ".mp4.");
    } else if (!finalFilename.match(/\.(mp4|ts|mpegts|mkv|webm)$/i)) {
      finalFilename =
        finalFilename.replace(/\.[^.]*$/, "") + (isMPEGTS ? ".ts" : ".mp4");
    }

    const MAX_SIZE_GB = 1.5 * 1024 * 1024 * 1024;
    const finalMimeType = isMPEGTS ? "video/mp2t" : "video/mp4";
    let validatedBlob = new Blob(finalBlobs, { type: finalMimeType });
    console.log("[downloadM3U8] Merged blob", { downloadId, size: validatedBlob.size, isMPEGTS });
    if (validatedBlob.size === 0)
      throw new Error("Merged video file is empty.");
    if (validatedBlob.size < 8) throw new Error("Merged video file too small.");

    const mp4Filename = finalFilename.replace(
      /\.(ts|mpegts|mkv|webm)$/i,
      ".mp4",
    );
    const alreadyMp4 = /\.mp4$/i.test(finalFilename);

    await setDownloadProgress(downloadId, 100, "Preparing download...");

    // Path 1: Already MP4 — put in IDB, then MP3 or download
    if (alreadyMp4) {
      let blobId;
      try {
        blobId = await putBlobInIDB(validatedBlob);
        console.log("[downloadM3U8] Path1 putBlobInIDB ok", { downloadId, blobId });
      } catch (idbErr) {
        console.error("[downloadM3U8] Path1 putBlobInIDB failed", downloadId, idbErr);
        throw idbErr;
      }
      segmentData =
        segmentBuffers =
        validBuffers =
        segmentBlobs =
        finalBlobs =
          null;
      validatedBlob = null;
      initSegmentData = null;
      try {
        if (convertToMp3) {
          console.log("[downloadM3U8] Path1 convertToMp3", { downloadId });
          await convertVideoToMp3AndDownload(
            blobId,
            "mp4",
            mp3Filename,
            downloadId,
            downloadControllers,
            activeChromeDownloads,
          );
        } else {
          console.log("[downloadM3U8] Path1 downloadBlob", { downloadId, blobId, finalFilename });
          await downloadBlob(
            { blobId },
            finalFilename,
            downloadId,
            downloadControllers,
            activeChromeDownloads,
          );
        }
        console.log("[downloadM3U8] Path1 complete", downloadId);
      } catch (path1Err) {
        console.error("[downloadM3U8] Path1 failed", downloadId, path1Err?.message, path1Err);
        throw path1Err;
      } finally {
        cleanupIndexedDBBlob(blobId);
      }
      cleanupM3U8Storage(downloadId, 15000);
      return;
    }

    // Path 2: TS and too big to convert — put in IDB, then MP3 or download as .ts
    if (validatedBlob.size > MAX_SIZE_GB) {
      let blobId;
      try {
        blobId = await putBlobInIDB(validatedBlob);
        console.log("[downloadM3U8] Path2 putBlobInIDB ok", { downloadId, blobId });
      } catch (idbErr) {
        console.error("[downloadM3U8] Path2 putBlobInIDB failed", downloadId, idbErr);
        throw idbErr;
      }
      segmentData =
        segmentBuffers =
        validBuffers =
        segmentBlobs =
        finalBlobs =
          null;
      validatedBlob = null;
      initSegmentData = null;
      try {
        if (convertToMp3) {
          console.log("[downloadM3U8] Path2 convertToMp3", { downloadId });
          await convertVideoToMp3AndDownload(
            blobId,
            "ts",
            mp3Filename,
            downloadId,
            downloadControllers,
            activeChromeDownloads,
          );
        } else {
          console.log("[downloadM3U8] Path2 downloadBlob (.ts)", { downloadId, blobId });
          await downloadBlob(
            { blobId, mimeType: "video/mp2t" },
            finalFilename,
            downloadId,
            downloadControllers,
            activeChromeDownloads,
          );
        }
        console.log("[downloadM3U8] Path2 complete", downloadId);
      } catch (path2Err) {
        console.error("[downloadM3U8] Path2 failed", downloadId, path2Err?.message, path2Err);
        throw path2Err;
      } finally {
        cleanupIndexedDBBlob(blobId);
      }
      cleanupM3U8Storage(downloadId, 15000);
      return;
    }

    // Path 3: TS, try convert to MP4 then MP3 or download MP4; on failure download as .ts
    const inputBlobId = `convert_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const CHUNK_SIZE = 32 * 1024 * 1024;
    const totalSize = validatedBlob.size;
    const chunkCount = Math.ceil(totalSize / CHUNK_SIZE);
    let blobsToStore = [];
    for (let i = 0; i < chunkCount; i++) {
      blobsToStore.push(
        validatedBlob.slice(
          i * CHUNK_SIZE,
          Math.min((i + 1) * CHUNK_SIZE, totalSize),
        ),
      );
    }
    const db = await openBlobDB();
    await putBlobChunksInIDB(db, inputBlobId, blobsToStore, { downloadId });
    db.close();
    segmentData =
      segmentBuffers =
      validBuffers =
      segmentBlobs =
      finalBlobs =
        null;
    validatedBlob = blobsToStore = null;
    initSegmentData = null;

    await setDownloadProgress(downloadId, 95, "Converting to MP4...");
    console.log("[downloadM3U8] Path3 setup offscreen, assembling chunks", { downloadId, inputBlobId, chunkCount });
    await setupOffscreenDocument();
    const assembleResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: "assembleChunksForConvert",
          blobId: inputBlobId,
          chunkCount,
          totalSize,
        },
        (r) =>
          resolve(
            chrome.runtime.lastError
              ? { success: false, error: chrome.runtime.lastError.message }
              : r || { success: false },
          ),
      );
    });
    if (!assembleResult?.success) {
      console.error("[downloadM3U8] Path3 assemble failed", { downloadId, error: assembleResult?.error });
      for (let i = 0; i < chunkCount; i++)
        cleanupIndexedDBBlob(`${inputBlobId}_chunk_${i}`);
      throw new Error(assembleResult?.error || "Failed to assemble");
    }
    console.log("[downloadM3U8] Path3 assemble ok, checking FFmpeg", { downloadId });

    const checkFFmpeg = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "checkFFmpeg" }, (r) =>
        resolve(!chrome.runtime.lastError && r?.success),
      );
    });
    if (!checkFFmpeg) {
      cleanupIndexedDBBlob(inputBlobId);
      throw new Error("FFmpeg is not available");
    }

    let convertResult = null;
    try {
      convertResult = await new Promise((resolve, reject) => {
        const t = setTimeout(
          () => reject(new Error("Conversion timed out")),
          7 * 60 * 1000,
        );
        chrome.runtime.sendMessage(
          { action: "convertToMp4", blobId: inputBlobId, downloadId },
          (r) => {
            clearTimeout(t);
            if (chrome.runtime.lastError)
              reject(new Error(chrome.runtime.lastError.message));
            else resolve(r);
          },
        );
      });
    } catch (convertErr) {
      console.warn(
        "Convert to MP4 failed, saving as .ts:",
        convertErr?.message,
      );
    }

    if (convertResult?.success && convertResult?.outputBlobId) {
      try {
        if (convertToMp3) {
          await convertVideoToMp3AndDownload(
            convertResult.outputBlobId,
            "mp4",
            mp3Filename,
            downloadId,
            downloadControllers,
            activeChromeDownloads,
          );
        } else {
          await downloadBlob(
            { blobId: convertResult.outputBlobId },
            mp4Filename,
            downloadId,
            downloadControllers,
            activeChromeDownloads,
          );
        }
      } finally {
        cleanupIndexedDBBlob(convertResult.outputBlobId);
      }
    } else {
      try {
        if (convertToMp3) {
          await convertVideoToMp3AndDownload(
            inputBlobId,
            "ts",
            mp3Filename,
            downloadId,
            downloadControllers,
            activeChromeDownloads,
          );
        } else {
          await downloadBlob(
            { blobId: inputBlobId, mimeType: "video/mp2t" },
            finalFilename,
            downloadId,
            downloadControllers,
            activeChromeDownloads,
          );
        }
      } finally {
        cleanupIndexedDBBlob(inputBlobId);
      }
    }

    await setDownloadProgress(downloadId, 100, "Download complete!");
    cleanupM3U8Storage(downloadId, 15000);
  } catch (error) {
    console.error("[downloadM3U8] catch", downloadId, error?.message, error?.stack || error);
    if (error.name === "AbortError" || abortController.signal.aborted) {
      await chrome.storage.local.set({
        [`downloadProgress_${downloadId}`]: 0,
        [`downloadStatus_${downloadId}`]: "Download cancelled",
      });
      cleanupM3U8Storage(downloadId, 2000);
      throw new Error("Download cancelled by user");
    }
    let errorMessage = error?.message ? `Download failed: ${error.message}` : "Download failed";

    await chrome.storage.local.set({
      [`downloadProgress_${downloadId}`]: 0,
      [`downloadStatus_${downloadId}`]: errorMessage,
    });
    cleanupM3U8Storage(downloadId, 10000);
    throw new Error(errorMessage);
  }
}

async function findDailymotionTabId(masterPlaylistUrl, videoData) {
  try {
    const tabs = await chrome.tabs.query({ url: "*://*.dailymotion.com/*" });
    if (tabs.length === 0) return null;
    for (const tab of tabs) {
      if (videoData[tab.id]?.urls?.length) return tab.id;
    }
    const active = tabs.find((t) => t.active) || tabs[0];
    return active ? active.id : null;
  } catch (e) {
    return null;
  }
}
