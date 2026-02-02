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
        sendResponse({ success: false, error: "Missing blobId, chunkCount or totalSize" });
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

// Send ready signal to background script
const ffmpegAvailable = false;
console.log("Sending offscreenReady signal to background script (no FFmpeg)...");
try {
  chrome.runtime.sendMessage({ action: "offscreenReady", ffmpegAvailable }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn(
        "❌ Error sending offscreenReady:",
        chrome.runtime.lastError.message,
      );
    } else {
      console.log("✅ Offscreen document ready signal sent successfully!");
    }
  });
} catch (error) {
  console.error("❌ Error sending offscreenReady:", error);
}

console.log("========================================");
console.log("✅ Offscreen document fully initialized and ready!");
console.log("FFmpeg (ffmpeg.wasm) available:", false);
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

// All FFmpeg-related helpers have been removed. This offscreen document now only
// handles blob assembly/storage and download helpers; it no longer performs any
// media format conversion.
