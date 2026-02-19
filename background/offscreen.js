/** Offscreen document: IDB blob access, blob URL creation, FFmpeg TS→MP4 / →MP3. Aligns with downloadBlob (blobId only) and downloadM3U8 (assemble → convert → downloadBlob). */
const IDB_NAME = "DailymotionDownloaderDB";
const IDB_STORE = "blobs";
const HELPER_RUN_TIMEOUT_MS = 5 * 60 * 1000;
const FFMPEG_HELPER_URL = "https://helper.addoncrop.com/?build=full";

let FFmpegHelperClass =
  typeof FFmpegHelper !== "undefined" ? FFmpegHelper : null;
let loadFfmpegHelperPromise = null;

function loadOneScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => {
      FFmpegHelperClass =
        typeof FFmpegHelper !== "undefined" ? FFmpegHelper : null;
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load script: " + src));
    (document.head || document.documentElement).appendChild(script);
  });
}

function loadFfmpegHelperScript() {
  if (FFmpegHelperClass) return Promise.resolve();
  if (typeof FFmpegHelper !== "undefined") {
    FFmpegHelperClass = FFmpegHelper;
    return Promise.resolve();
  }
  if (loadFfmpegHelperPromise) return loadFfmpegHelperPromise;
  const getURL =
    typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL
      ? (path) => chrome.runtime.getURL(path)
      : (path) => "/" + path;
  loadFfmpegHelperPromise = (async () => {
    for (const name of ["ffmpeg-helper-umd.js", "ffmpeg-helper-umd.cjs"]) {
      try {
        await loadOneScript(getURL(name));
        if (FFmpegHelperClass) return;
      } catch (e) {}
    }
    throw new Error("Failed to load FFmpeg helper (tried .js and .cjs).");
  })();
  return loadFfmpegHelperPromise;
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message || "Timed out")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// ---- IDB (shared with background/downloadM3U8) ----
function openBlobsDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      if (!e.target.result.objectStoreNames.contains(IDB_STORE)) {
        e.target.result.createObjectStore(IDB_STORE);
      }
    };
  });
}

function getBlobFromDB(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([IDB_STORE], "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => {
      const data = req.result;
      if (!data || !(data instanceof ArrayBuffer)) {
        reject(new Error("Blob not found: " + key));
      } else {
        resolve(data);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

function putBlobInDB(db, key, buffer) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([IDB_STORE], "readwrite");
    tx.objectStore(IDB_STORE).put(buffer, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function ensureFFmpegReady() {
  if (!FFmpegHelperClass) await loadFfmpegHelperScript();
  if (!FFmpegHelperClass) {
    throw new Error("FFmpegHelper not loaded. Check offscreen script order.");
  }
  const ffmpeg = new FFmpegHelperClass(FFMPEG_HELPER_URL, "error");
  await ffmpeg.Ready;
}

// ---- Message handler ----
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    if (request.action === "ping") {
      sendResponse({ success: true, ready: true });
      return true;
    }

    if (request.action === "checkFFmpeg") {
      ensureFFmpegReady()
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (request.action === "revokeBlobUrl" && request.blobUrl) {
      try {
        URL.revokeObjectURL(request.blobUrl);
      } catch (e) {}
      sendResponse({ success: true });
      return true;
    }

    if (request.action === "assembleChunksForConvert") {
      const { blobId, chunkCount, totalSize } = request;
      if (!blobId || chunkCount == null || !totalSize) {
        sendResponse({
          success: false,
          error: "Missing blobId, chunkCount or totalSize",
        });
        return true;
      }
      (async () => {
        try {
          const db = await openBlobsDB();
          const result = new Uint8Array(totalSize);
          let offset = 0;
          for (let i = 0; i < chunkCount; i++) {
            const chunk = await getBlobFromDB(db, `${blobId}_chunk_${i}`);
            if (!chunk || !(chunk instanceof ArrayBuffer)) {
              throw new Error("Missing or invalid chunk " + i);
            }
            result.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
          }
          const tx = db.transaction([IDB_STORE], "readwrite");
          const store = tx.objectStore(IDB_STORE);
          store.put(result.buffer, blobId);
          for (let i = 0; i < chunkCount; i++) {
            store.delete(`${blobId}_chunk_${i}`);
          }
          await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
          db.close();
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (request.action === "convertToMp4") {
      handleConvertToMp4(request.blobId, (progress) => {
        try {
          chrome.runtime.sendMessage({
            action: "convertProgress",
            downloadId: request.downloadId,
            progress,
          });
        } catch (e) {}
      })
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (request.action === "convertToMp3") {
      handleConvertToMp3(request.blobId, request.inputFormat || "ts")
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (request.action === "downloadBlobFromIndexedDB") {
      handleBlobDownload(request.blobId, request.mimeType)
        .then((blobUrl) => sendResponse({ success: true, blobUrl }))
        .catch((err) => {
          console.error("[offscreen] downloadBlobFromIndexedDB failed", request.blobId, err?.message, err);
          sendResponse({ success: false, error: err?.message || String(err) });
        });
      return true;
    }

    return false;
  } catch (error) {
    sendResponse({ success: false, error: error.message });
    return false;
  }
});

// ---- Blob URL for downloadBlob (blobId-only path) ----
async function handleBlobDownload(blobId, mimeType) {
  console.log("[offscreen] handleBlobDownload start", { blobId });
  const db = await openBlobsDB();
  const arrayBuffer = await getBlobFromDB(db, blobId);
  db.close();
  if (!arrayBuffer || !(arrayBuffer instanceof ArrayBuffer)) {
    console.error("[offscreen] handleBlobDownload blob not found or invalid", { blobId });
    throw new Error("Blob not found in IndexedDB or invalid");
  }
  const blob = new Blob([arrayBuffer], { type: mimeType || "video/mp4" });
  const blobUrl = URL.createObjectURL(blob);
  console.log("[offscreen] handleBlobDownload done", { blobId, size: blob.size });
  return blobUrl;
}

// ---- TS → MP4 (used by downloadM3U8 when TS ≤ 1.5 GB) ----
async function handleConvertToMp4(blobId, onProgress) {
  await ensureFFmpegReady();
  const db = await openBlobsDB();
  const arrayBuffer = await getBlobFromDB(db, blobId);
  db.close();

  const ffmpeg = new FFmpegHelperClass(FFMPEG_HELPER_URL, "error");
  await ffmpeg.Ready;
  const result = await withTimeout(
    ffmpeg.run(
      "exec",
      {
        files: { "input.ts": arrayBuffer },
        args: ["-i", "input.ts", "-c", "copy", "output.mp4"],
        outputFilename: "output.mp4",
      },
      [arrayBuffer],
      (progress) => {
        if (typeof onProgress === "function") {
          try {
            const p =
              typeof progress === "number" ? progress : progress?.progress;
            onProgress(Math.min(1, Math.max(0, p != null ? p : 0)));
          } catch (e) {}
        }
      },
    ),
    HELPER_RUN_TIMEOUT_MS,
    "Conversion (MP4) timed out. The helper at " +
      FFMPEG_HELPER_URL +
      " did not respond.",
  );

  const outputBuffer = result?.outputBuffer;
  if (!outputBuffer || !(outputBuffer instanceof ArrayBuffer)) {
    throw new Error(result?.message || "Helper did not return outputBuffer");
  }

  const outputBlobId =
    "convert_" + Date.now() + "_" + Math.random().toString(36).slice(2, 11);
  const db2 = await openBlobsDB();
  await putBlobInDB(db2, outputBlobId, outputBuffer);
  db2.close();

  return {
    success: true,
    outputBlobId,
    extension: result.extension || "mp4",
    mimeType: result.mimeType || "video/mp4",
  };
}

// ---- Video (TS/MP4) → MP3 ----
async function handleConvertToMp3(blobId, inputFormat) {
  await ensureFFmpegReady();
  const db = await openBlobsDB();
  const arrayBuffer = await getBlobFromDB(db, blobId);
  db.close();

  const ffmpeg = new FFmpegHelperClass(FFMPEG_HELPER_URL, "error");
  await ffmpeg.Ready;
  const result = await withTimeout(
    ffmpeg.run(
      "convert-to-mp3",
      { audioBuffer: arrayBuffer },
      [arrayBuffer],
      undefined,
    ),
    HELPER_RUN_TIMEOUT_MS,
    "Conversion (MP3) timed out. The helper at " +
      FFMPEG_HELPER_URL +
      " did not respond.",
  );

  const outputBuffer = result?.outputBuffer;
  if (!outputBuffer || !(outputBuffer instanceof ArrayBuffer)) {
    throw new Error(result?.message || "Helper did not return outputBuffer");
  }

  const outputBlobId =
    "mp3_" + Date.now() + "_" + Math.random().toString(36).slice(2, 11);
  const db2 = await openBlobsDB();
  await putBlobInDB(db2, outputBlobId, outputBuffer);
  db2.close();

  return {
    success: true,
    outputBlobId,
    extension: result.extension || "mp3",
    mimeType: result.mimeType || "audio/mpeg",
  };
}
