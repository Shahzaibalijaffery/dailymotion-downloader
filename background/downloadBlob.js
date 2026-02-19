async function downloadBlob(
  input,
  filename,
  downloadId,
  downloadControllers,
  activeChromeDownloads,
) {
  filename = sanitizeFilenameForDownload(filename);
  if (!input?.blobId)
    throw new Error("downloadBlob: input must be { blobId, mimeType? }");
  const blobId = input.blobId;
  const mimeType = input.mimeType || "video/mp4";
  console.log("[downloadBlob] start", { downloadId, blobId, filename });

  if (downloadControllers?.get(downloadId)?.controller?.signal?.aborted) {
    if (blobId) cleanupIndexedDBBlob(blobId);
    throw new Error("Download cancelled");
  }
  const cancelled = await chrome.storage.local.get([
    `downloadCancelled_${downloadId}`,
  ]);
  if (cancelled[`downloadCancelled_${downloadId}`]) {
    if (blobId) cleanupIndexedDBBlob(blobId);
    throw new Error("Download cancelled");
  }

  await setupOffscreenDocument();

  const response = await new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        action: "downloadBlobFromIndexedDB",
        blobId,
        mimeType,
      },
      (r) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(r || { success: false });
        }
      },
    );
  });

  if (!response?.success || !response?.blobUrl) {
    console.error("[downloadBlob] offscreen returned no blobUrl", { downloadId, blobId, error: response?.error });
    cleanupIndexedDBBlob(blobId);
    throw new Error(response?.error || "Failed to get blob URL from offscreen");
  }

  const blobUrl = response.blobUrl;
  console.log("[downloadBlob] got blobUrl, starting chrome.downloads", { downloadId });

  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url: blobUrl, filename, saveAs: true },
      (chromeDownloadId) => {
        if (chrome.runtime.lastError || chromeDownloadId === undefined) {
          console.error("[downloadBlob] chrome.downloads.download failed", {
            downloadId,
            blobId,
            lastError: chrome.runtime.lastError?.message,
            chromeDownloadId,
          });
          try {
            chrome.runtime.sendMessage(
              { action: "revokeBlobUrl", blobUrl },
              () => {},
            );
          } catch (e) {}
          cleanupIndexedDBBlob(blobId);
          reject(
            new Error(chrome.runtime.lastError?.message || "Download failed"),
          );
          return;
        }
        console.log("[downloadBlob] chrome.downloads.download started", { downloadId, chromeDownloadId });

        if (downloadControllers?.get(downloadId)) {
          downloadControllers.get(downloadId).chromeDownloadId =
            chromeDownloadId;
        }
        activeChromeDownloads.set(chromeDownloadId, {
          downloadId,
          blobUrl,
          blobId,
        });

        let done = false;
        const revokeAndCleanup = () => {
          if (done) return;
          done = true;
          try {
            chrome.runtime.sendMessage(
              { action: "revokeBlobUrl", blobUrl },
              () => {},
            );
          } catch (e) {}
          cleanupIndexedDBBlob(blobId);
          activeChromeDownloads.delete(chromeDownloadId);
        };

        const poll = setInterval(() => {
          chrome.downloads.search({ id: chromeDownloadId }, (results) => {
            if (done || !results?.length) return;
            const state = results[0].state;
            if (state === "complete") {
              clearInterval(poll);
              clearTimeout(timeoutId);
              revokeAndCleanup();
              resolve();
            } else if (state === "interrupted") {
              clearInterval(poll);
              clearTimeout(timeoutId);
              revokeAndCleanup();
              reject(new Error(results[0].error || "Download interrupted"));
            }
          });
        }, 1000);

        const timeoutId = setTimeout(() => {
          clearInterval(poll);
          revokeAndCleanup();
          resolve();
        }, 600000);
      },
    );
  });
}
