// Offscreen document script
// This runs in an offscreen document that shares IndexedDB with the service worker
// and has access to URL.createObjectURL

// Log immediately when script executes
console.log("========================================");
console.log("Offscreen document script EXECUTING!");
console.log("Script location:", window.location.href);
console.log("Chrome runtime available:", typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');
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
    
    if (request.action === "downloadBlobFromIndexedDB") {
      console.log("Processing downloadBlobFromIndexedDB request:", {
        blobId: request.blobId,
        filename: request.filename,
        mimeType: request.mimeType,
        expectedSize: request.expectedSize
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
console.log("Sending offscreenReady signal to background script...");
try {
  chrome.runtime.sendMessage({ action: 'offscreenReady' }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn("❌ Error sending offscreenReady:", chrome.runtime.lastError.message);
    } else {
      console.log("✅ Offscreen document ready signal sent successfully!");
    }
  });
} catch (error) {
  console.error("❌ Error sending offscreenReady:", error);
}

console.log("========================================");
console.log("✅ Offscreen document fully initialized and ready!");
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

    const arrayBuffer = await new Promise((resolve, reject) => {
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

    // Create blob and blob URL
    const blob = new Blob([arrayBuffer], { type: mimeType || "video/mp4" });
    const blobUrl = URL.createObjectURL(blob);

    console.log(`Created blob URL: ${blobUrl.substring(0, 50)}...`);

    // Return blob URL to background script (which has chrome.downloads access)
    // The background script will handle the actual download
    return blobUrl;
  } catch (error) {
    console.error("Failed to download blob from IndexedDB:", error);
    throw error;
  }
}
