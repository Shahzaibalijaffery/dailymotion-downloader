const MAX_CONCURRENT_DOWNLOADS = 3;
const MAX_SEGMENTS_FOR_CONCURRENT = 500;

const DOWNLOAD_STORAGE_KEYS = (id) => [
  `downloadCancelled_${id}`,
  `downloadStatus_${id}`,
  `downloadProgress_${id}`,
  `downloadSegments_${id}`,
  `blobReady_${id}`,
];

function notifyTab(tabId, message) {
  const send = (targetId) => {
    if (targetId) chrome.tabs.sendMessage(targetId, message, () => {});
  };
  if (tabId) send(tabId);
  else chrome.tabs.query({ url: "*://*.dailymotion.com/*" }, (tabs) => send(tabs?.[0]?.id));
}

function getVideoId(request, tabId, videoData, sender) {
  if (request.videoId) return request.videoId;
  if (tabId && videoData?.[tabId]?.urls) {
    const match = videoData[tabId].urls.find(
      (u) => fixUrlEncoding(u?.url || "") === fixUrlEncoding(request.url || ""),
    );
    if (match?.videoId) return match.videoId;
  }
  if (sender?.tab?.url) return extractVideoId(sender.tab.url);
  return extractVideoId(request.url);
}

function downloadDirectUrl(url, filename, downloadId, downloadControllers, activeChromeDownloads) {
  filename = sanitizeFilenameForDownload(filename);
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url, filename, saveAs: true },
      (chromeDownloadId) => {
        if (chrome.runtime.lastError || chromeDownloadId === undefined) {
          reject(new Error(chrome.runtime.lastError?.message || "Download failed"));
          return;
        }
        const controllerInfo = downloadControllers.get(downloadId);
        if (controllerInfo) controllerInfo.chromeDownloadId = chromeDownloadId;
        activeChromeDownloads.set(chromeDownloadId, { downloadId });

        let done = false;
        const cleanup = () => {
          if (done) return;
          done = true;
          activeChromeDownloads.delete(chromeDownloadId);
        };

        const poll = setInterval(() => {
          chrome.downloads.search({ id: chromeDownloadId }, (results) => {
            if (done || !results?.length) return;
            const state = results[0].state;
            if (state === "complete") {
              clearInterval(poll);
              clearTimeout(timeoutId);
              cleanup();
              resolve();
            } else if (state === "interrupted") {
              clearInterval(poll);
              clearTimeout(timeoutId);
              cleanup();
              reject(new Error(results[0].error || "Download interrupted"));
            }
          });
        }, 1000);

        const timeoutId = setTimeout(() => {
          clearInterval(poll);
          cleanup();
          resolve();
        }, 600000);
      },
    );
  });
}

function handleDownloadAction(
  request,
  sender,
  sendResponse,
  activeDownloads,
  downloadInfo,
  downloadControllers,
  videoData,
  activeChromeDownloads,
) {
  const normalizedUrl = normalizeUrlForDownload(request.url);

  if (activeDownloads.has(normalizedUrl)) {
    const existingDownloadId = activeDownloads.get(normalizedUrl);
    const controller = downloadControllers.get(existingDownloadId);
    const info = downloadInfo.get(existingDownloadId);
    if (controller?.controller?.signal?.aborted || !info) {
      activeDownloads.delete(normalizedUrl);
      if (controller) downloadControllers.delete(existingDownloadId);
      downloadInfo.delete(existingDownloadId);
      proceedWithDownload();
      return true;
    }
    notifyTab(request.tabId || sender?.tab?.id, {
      action: "downloadStarted",
      downloadId: existingDownloadId,
      filename: info?.filename || request.filename,
      qualityLabel: info?.qualityLabel || request.qualityLabel || "",
      isExisting: true,
    });
    sendResponse({
      success: false,
      error: "This file is already being downloaded. Please wait for the current download to complete.",
      downloadId: existingDownloadId,
      isExisting: true,
    });
    return true;
  }

  proceedWithDownload();

  function proceedWithDownload() {
    if (activeDownloads.size >= MAX_CONCURRENT_DOWNLOADS) {
      sendResponse({
        success: false,
        error: `Maximum ${MAX_CONCURRENT_DOWNLOADS} downloads at a time. Please wait for one to complete.`,
      });
      notifyTab(request.tabId || sender?.tab?.id, {
        action: "showDownloadBlockedNotification",
        message: "Too many downloads",
        reason: "maxConcurrent",
      });
      return;
    }
    const downloadId = generateDownloadId();
    runDownload(downloadId);
  }

  function clearStorageAfterDelay(downloadId, delayMs) {
    setTimeout(() => {
      downloadInfo.delete(downloadId);
      chrome.storage.local.remove(DOWNLOAD_STORAGE_KEYS(downloadId));
    }, delayMs);
  }

  function runDownload(downloadId) {
    const tabId = request.tabId || sender?.tab?.id;
    const convertToMp3 = request.convertToMp3 === true;
    const filename = convertToMp3
      ? request.filename.replace(/\.[^.]+$/, "") + ".mp3"
      : request.filename;

    const info = {
      url: request.url,
      normalizedUrl,
      filename,
      tabId,
      videoId: getVideoId(request, tabId, videoData, sender),
      qualityLabel: request.qualityLabel || "",
      startTime: Date.now(),
    };
    activeDownloads.set(normalizedUrl, downloadId);
    downloadInfo.set(downloadId, info);

    notifyTab(tabId, {
      action: "downloadStarted",
      downloadId,
      filename: request.filename,
      qualityLabel: request.qualityLabel || "",
    });

    handleDownload(
      request.url,
      filename,
      request.type,
      downloadId,
      downloadControllers,
      videoData,
      activeChromeDownloads,
      convertToMp3,
    )
      .then(() => {
        activeDownloads.delete(normalizedUrl);
        const completedInfo = downloadInfo.get(downloadId);
        if (completedInfo?.tabId) {
          chrome.tabs.get(completedInfo.tabId, (tab) => {
            if (
              !chrome.runtime.lastError &&
              tab?.url?.includes("dailymotion.com") &&
              (!completedInfo.videoId || extractVideoId(tab.url) === completedInfo.videoId)
            ) {
              chrome.tabs.sendMessage(
                completedInfo.tabId,
                { action: "downloadCompleted", downloadId, filename: completedInfo.filename },
                () => {},
              );
            }
          });
        }
        clearStorageAfterDelay(downloadId, 15000);
        sendResponse({ success: true });
      })
      .catch((err) => {
        activeDownloads.delete(normalizedUrl);
        const isCancelled = err.message?.includes("cancelled");
        clearStorageAfterDelay(downloadId, isCancelled ? 2000 : 15000);
        sendResponse({ success: false, error: err.message });
      });
  }

  return true;
}

async function handleDownload(
  url,
  filename,
  type,
  downloadId,
  downloadControllers,
  videoData,
  activeChromeDownloads,
  convertToMp3 = false,
) {
  if (await isDownloadCancelled(downloadId)) {
    throw new DOMException("Download cancelled", "AbortError");
  }

  const abortController = new AbortController();
  downloadControllers.set(downloadId, { controller: abortController, chromeDownloadId: null });

  try {
    await chrome.storage.local.set({
      [`downloadProgress_${downloadId}`]: 0,
      [`downloadStatus_${downloadId}`]: convertToMp3 ? "Preparing MP3 download..." : "Preparing download...",
    });

    const isHLS = url.includes(".m3u8") || type?.includes("m3u8") || type?.includes("hls");
    if (isHLS) {
      let tabId = null;
      for (const [tid, data] of Object.entries(videoData || {})) {
        if (data?.urls?.some((v) => v.url === url || fixUrlEncoding(v?.url) === fixUrlEncoding(url))) {
          tabId = parseInt(tid, 10);
          break;
        }
      }
      if (tabId == null) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true, url: "*://*.dailymotion.com/*" });
        tabId = tabs[0]?.id ?? null;
      }
      if (tabId == null) {
        throw new Error("Open a Dailymotion video page to download HLS (M3U8).");
      }
      const response = await chrome.tabs.sendMessage(tabId, {
        action: "downloadM3U8AndConvert",
        url,
        filename,
        downloadId,
        convertToMp3,
      }, { frameId: 0 });
      if (!response?.success) {
        throw new Error(response?.error || "Download failed");
      }
    } else if (isChunkedRangeUrl(url)) {
      throw new Error("This video format (range URL) is not supported for download.");
    } else {
      await downloadDirectUrl(url, filename, downloadId, downloadControllers, activeChromeDownloads);
    }
  } catch (error) {
    if (error.name === "AbortError" || abortController.signal.aborted) {
      await chrome.storage.local.set({
        [`downloadProgress_${downloadId}`]: 0,
        [`downloadStatus_${downloadId}`]: "Download cancelled",
      });
      throw new Error("Download cancelled by user");
    }
    const status = await chrome.storage.local.get([`downloadStatus_${downloadId}`]);
    const s = status[`downloadStatus_${downloadId}`] || "";
    if (!s.includes("failed") && !s.includes("error")) {
      await chrome.storage.local.set({
        [`downloadProgress_${downloadId}`]: 0,
        [`downloadStatus_${downloadId}`]: error.message || "Download failed",
      });
    }
    throw error;
  } finally {
    downloadControllers.delete(downloadId);
  }
}
