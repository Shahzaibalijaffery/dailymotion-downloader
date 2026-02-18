// Offscreen document script
// This runs in an offscreen document that shares IndexedDB with the service worker
// and has access to URL.createObjectURL

// Log immediately when script executes
console.log("========================================");
console.log("Offscreen document script EXECUTING!");
console.log("Script location:", window.location.href);
console.log(
  "Chrome runtime available:",
  typeof chrome !== "undefined" && typeof chrome.runtime !== "undefined",
);
console.log("========================================");

// Only FFmpegHelper (ffmpeg-helper-umd.cjs). No wasm, core, or 814.
// Helper URL and protocol match Royal Video Downloader (convert-to-mp3, exec).
const FFmpegHelperClass = typeof FFmpegHelper !== "undefined" ? FFmpegHelper : null;
const FFMPEG_HELPER_URL = "https://helper.addoncrop.com/?build=full";

// Set up message listener immediately (don't wait for DOM)
// This ensures the listener is ready as soon as possible
console.log("Setting up chrome.runtime.onMessage listener...");
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    console.log("Offscreen document received message:", request.action);

    if (request.action === "ping") {
      // Respond to ping to verify we're ready
      console.log("Offscreen document responding to ping");
      sendResponse({ success: true, ready: true });
      return true;
    }

    if (request.action === "checkFFmpeg") {
      ensureFFmpegReady()
        .then(() => sendResponse({ success: true }))
        .catch((err) => {
          console.warn("checkFFmpeg failed:", err);
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }

    if (request.action === "revokeBlobUrl" && request.blobUrl) {
      try {
        URL.revokeObjectURL(request.blobUrl);
        console.log("Revoked blob URL to free RAM");
      } catch (e) {
        console.warn("revokeBlobUrl failed:", e);
      }
      sendResponse({ success: true });
      return true;
    }

    if (request.action === "buildBlobFromChunksForDownload") {
      const { blobId, chunkCount } = request;
      if (!blobId || chunkCount == null) {
        sendResponse({ success: false, error: "Missing blobId or chunkCount" });
        return true;
      }
      (async () => {
        try {
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
          const parts = [];
          for (let i = 0; i < chunkCount; i++) {
            const chunkKey = `${blobId}_chunk_${i}`;
            const chunk = await new Promise((resolve, reject) => {
              const tx = db.transaction(["blobs"], "readonly");
              const req = tx.objectStore("blobs").get(chunkKey);
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
            if (!chunk || !(chunk instanceof ArrayBuffer)) {
              throw new Error(`Missing or invalid chunk ${i}`);
            }
            parts.push(chunk);
          }
          const blob = new Blob(parts, { type: "video/mp2t" });
          const blobUrl = URL.createObjectURL(blob);
          await new Promise((resolve, reject) => {
            const tx = db.transaction(["blobs"], "readwrite");
            const store = tx.objectStore("blobs");
            for (let i = 0; i < chunkCount; i++) {
              store.delete(`${blobId}_chunk_${i}`);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
          db.close();
          sendResponse({ success: true, blobUrl });
        } catch (err) {
          console.error("buildBlobFromChunksForDownload failed:", err);
          sendResponse({ success: false, error: err.message });
        }
      })();
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
          const result = new Uint8Array(totalSize);
          let offset = 0;
          for (let i = 0; i < chunkCount; i++) {
            const chunkKey = `${blobId}_chunk_${i}`;
            const chunk = await new Promise((resolve, reject) => {
              const tx = db.transaction(["blobs"], "readonly");
              const req = tx.objectStore("blobs").get(chunkKey);
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
            if (!chunk || !(chunk instanceof ArrayBuffer)) {
              throw new Error(`Missing or invalid chunk ${i}`);
            }
            result.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
          }
          await new Promise((resolve, reject) => {
            const tx = db.transaction(["blobs"], "readwrite");
            const store = tx.objectStore("blobs");
            store.put(result.buffer, blobId);
            for (let i = 0; i < chunkCount; i++) {
              store.delete(`${blobId}_chunk_${i}`);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
          db.close();
          sendResponse({ success: true });
        } catch (err) {
          console.error("assembleChunksForConvert failed:", err);
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (request.action === "storeBlobFromUrl") {
      const { blobUrl, blobId } = request;
      if (!blobUrl || !blobId) {
        sendResponse({ success: false, error: "Missing blobUrl or blobId" });
        return true;
      }
      (async () => {
        try {
          const res = await fetch(blobUrl);
          if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
          const arrayBuffer = await res.arrayBuffer();
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
          await new Promise((resolve, reject) => {
            const tx = db.transaction(["blobs"], "readwrite");
            tx.objectStore("blobs").put(arrayBuffer, blobId);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
          db.close();
          sendResponse({ success: true });
        } catch (err) {
          console.error("storeBlobFromUrl failed:", err);
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (request.action === "convertToMp4") {
      handleConvertToMp4(request.blobId, request.downloadId, (progress) => {
        try {
          chrome.runtime.sendMessage({
            action: "convertProgress",
            downloadId: request.downloadId,
            progress,
          });
        } catch (e) {}
      })
        .then((result) => sendResponse(result))
        .catch((err) => {
          console.error("convertToMp4 error:", err);
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }

    if (request.action === "convertToMp3") {
      handleConvertToMp3(request.blobId, request.inputFormat || "ts")
        .then((result) => sendResponse(result))
        .catch((err) => {
          console.error("convertToMp3 error:", err);
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }

    if (request.action === "deleteChunksForBlob") {
      const { blobId, chunkCount } = request;
      if (!blobId || chunkCount == null) {
        sendResponse({ success: false, error: "Missing blobId or chunkCount" });
        return true;
      }
      (async () => {
        try {
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
          const tx = db.transaction(["blobs"], "readwrite");
          const store = tx.objectStore("blobs");
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
          console.error("deleteChunksForBlob failed:", err);
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (request.action === "downloadBlobFromIndexedDB") {
      console.log("Processing downloadBlobFromIndexedDB request:", {
        blobId: request.blobId,
        filename: request.filename,
        mimeType: request.mimeType,
        expectedSize: request.expectedSize,
      });

      handleBlobDownload(
        request.blobId,
        request.filename,
        request.mimeType,
        request.expectedSize,
      )
        .then((blobUrl) => {
          // Send blob URL back to background script for download
          console.log("Blob download successful, sending response");
          sendResponse({ success: true, blobUrl: blobUrl });
        })
        .catch((error) => {
          console.error("Blob download error:", error);
          sendResponse({ success: false, error: error.message });
        });
      return true; // Keep channel open for async response
    }

    console.log("Unknown action:", request.action);
    return false;
  } catch (error) {
    console.error("Error in offscreen message listener:", error);
    sendResponse({ success: false, error: error.message });
    return false;
  }
});

console.log("✅ Message listener set up successfully!");

// Send ready signal to background script (include FFmpeg helper availability)
const ffmpegAvailable = FFmpegHelperClass !== null;
console.log("Sending offscreenReady signal to background script...");
try {
  chrome.runtime.sendMessage(
    { action: "offscreenReady", ffmpegAvailable },
    (response) => {
      if (chrome.runtime.lastError) {
        console.warn(
          "❌ Error sending offscreenReady:",
          chrome.runtime.lastError.message,
        );
      } else {
        console.log("✅ Offscreen document ready signal sent successfully!");
      }
    },
  );
} catch (error) {
  console.error("❌ Error sending offscreenReady:", error);
}

console.log("========================================");
console.log("✅ Offscreen document fully initialized and ready!");
console.log("FFmpegHelper available:", FFmpegHelperClass !== null);
console.log("Message listener is active and waiting for messages");
console.log("========================================");

async function handleBlobDownload(blobId, filename, mimeType, expectedSize) {
  try {
    console.log(`Retrieving blob from IndexedDB with ID: ${blobId}...`);

    // Open IndexedDB (offscreen document shares the same IndexedDB as service worker)
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("DailymotionDownloaderDB", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("blobs")) {
          db.createObjectStore("blobs");
        }
      };
    });

    // Retrieve ArrayBuffer
    const transaction = db.transaction(["blobs"], "readonly");
    const store = transaction.objectStore("blobs");

    let arrayBuffer = await new Promise((resolve, reject) => {
      const request = store.get(blobId);
      request.onsuccess = () => {
        const data = request.result;
        if (!data || !(data instanceof ArrayBuffer)) {
          reject(new Error(`Blob not found in IndexedDB. Blob ID: ${blobId}`));
        } else {
          resolve(data);
        }
      };
      request.onerror = () => {
        reject(request.error || new Error("IndexedDB read error"));
      };
    });

    db.close();

    const actualSize = arrayBuffer.byteLength;
    const sizeMB = Math.round(actualSize / 1024 / 1024);
    console.log(
      `Retrieved ${sizeMB}MB blob (${actualSize} bytes) from IndexedDB`,
    );

    if (expectedSize && actualSize !== expectedSize) {
      console.warn(
        `Size mismatch: expected ${expectedSize}, got ${actualSize}`,
      );
    }

    // Create blob and blob URL (Blob holds the data; we drop local ref so only blobUrl keeps it alive until revoke)
    const blob = new Blob([arrayBuffer], { type: mimeType || "video/mp4" });
    const blobUrl = URL.createObjectURL(blob);
    arrayBuffer = null; // No closure/global ref: only blob (via URL) holds data until revokeBlobUrl

    console.log(`Created blob URL: ${blobUrl.substring(0, 50)}...`);

    // Return blob URL to background script (which has chrome.downloads access)
    // The background script will handle the actual download
    return blobUrl;
  } catch (error) {
    console.error("Failed to download blob from IndexedDB:", error);
    throw error;
  }
}

/** Timeout for helper.run() so we don't hang if the external helper doesn't respond (ms). */
const HELPER_RUN_TIMEOUT_MS = 5 * 60 * 1000;

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
      }
    );
  });
}

/** Ensure FFmpeg helper iframe is ready (used by checkFFmpeg). No wasm, core, or 814. */
async function ensureFFmpegReady() {
  if (!FFmpegHelperClass) {
    throw new Error("FFmpegHelper not loaded. Check offscreen script order.");
  }
  const ffmpeg = new FFmpegHelperClass(FFMPEG_HELPER_URL, "error");
  await ffmpeg.Ready;
}

function openBlobsDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("DailymotionDownloaderDB", 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      if (!e.target.result.objectStoreNames.contains("blobs")) {
        e.target.result.createObjectStore("blobs");
      }
    };
  });
}

/** Convert TS blob to MP4 via helper. API: ffmpeg.run(action, data, transferList, onProgress) -> { outputBuffer, extension, mimeType } */
async function handleConvertToMp4(blobId, downloadId, onProgress) {
  if (!FFmpegHelperClass) {
    throw new Error("FFmpegHelper not loaded. Check offscreen script order.");
  }
  const db = await openBlobsDB();
  const arrayBuffer = await new Promise((resolve, reject) => {
    const tx = db.transaction(["blobs"], "readonly");
    const req = tx.objectStore("blobs").get(blobId);
    req.onsuccess = () => {
      const data = req.result;
      if (!data || !(data instanceof ArrayBuffer)) {
        reject(new Error("Blob not found: " + blobId));
      } else {
        resolve(data);
      }
    };
    req.onerror = () => reject(req.error);
  });
  db.close();

  // Royal iframe: action "exec" with files, args, outputFilename -> { outputBuffer, extension, mimeType }
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
            const p = typeof progress === "number" ? progress : (progress && progress.progress);
            onProgress(Math.min(1, Math.max(0, p != null ? p : 0)));
          } catch (e) {}
        }
      }
    ),
    HELPER_RUN_TIMEOUT_MS,
    "Conversion (MP4) timed out. The helper at " + FFMPEG_HELPER_URL + " did not respond."
  );

  const outputBuffer = result && result.outputBuffer;
  if (!outputBuffer || !(outputBuffer instanceof ArrayBuffer)) {
    throw new Error(result && result.message ? result.message : "Helper did not return outputBuffer");
  }
  const outputBlobId = "convert_" + Date.now() + "_" + Math.random().toString(36).slice(2, 11);
  const db2 = await openBlobsDB();
  await new Promise((resolve, reject) => {
    const tx = db2.transaction(["blobs"], "readwrite");
    tx.objectStore("blobs").put(outputBuffer, outputBlobId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db2.close();

  return {
    success: true,
    outputBlobId,
    extension: result.extension || "mp4",
    mimeType: result.mimeType || "video/mp4",
  };
}

/**
 * Convert video (TS or MP4) in IDB to MP3 via helper. Used when user selects "MP3" in download dropdown.
 */
async function handleConvertToMp3(blobId, inputFormat) {
  if (!FFmpegHelperClass) {
    throw new Error("FFmpegHelper not loaded. Check offscreen script order.");
  }
  const db = await openBlobsDB();
  const arrayBuffer = await new Promise((resolve, reject) => {
    const tx = db.transaction(["blobs"], "readonly");
    const req = tx.objectStore("blobs").get(blobId);
    req.onsuccess = () => {
      const data = req.result;
      if (!data || !(data instanceof ArrayBuffer)) {
        reject(new Error("Blob not found: " + blobId));
      } else {
        resolve(data);
      }
    };
    req.onerror = () => reject(req.error);
  });
  db.close();

  // Royal iframe: action "convert-to-mp3" with audioBuffer -> { outputBuffer, extension, mimeType }
  const ffmpeg = new FFmpegHelperClass(FFMPEG_HELPER_URL, "error");
  await ffmpeg.Ready;
  const result = await withTimeout(
    ffmpeg.run(
      "convert-to-mp3",
      { audioBuffer: arrayBuffer },
      [arrayBuffer],
      undefined
    ),
    HELPER_RUN_TIMEOUT_MS,
    "Conversion (MP3) timed out. The helper at " + FFMPEG_HELPER_URL + " did not respond."
  );

  const outputBuffer = result && result.outputBuffer;
  if (!outputBuffer || !(outputBuffer instanceof ArrayBuffer)) {
    throw new Error(result && result.message ? result.message : "Helper did not return outputBuffer");
  }
  const outputBlobId = "mp3_" + Date.now() + "_" + Math.random().toString(36).slice(2, 11);
  const db2 = await openBlobsDB();
  await new Promise((resolve, reject) => {
    const tx = db2.transaction(["blobs"], "readwrite");
    tx.objectStore("blobs").put(outputBuffer, outputBlobId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db2.close();

  return {
    success: true,
    outputBlobId,
    extension: result.extension || "mp3",
    mimeType: result.mimeType || "audio/mpeg",
  };
}
