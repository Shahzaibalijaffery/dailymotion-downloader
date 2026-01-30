/**
 * Download initiation functionality
 * Handles starting downloads, validation, and routing to appropriate download methods
 */

/** Maximum number of downloads allowed at the same time */
const MAX_CONCURRENT_DOWNLOADS = 2;
/** If any active download has more than this many segments (HLS), block new downloads until it finishes */
const MAX_SEGMENTS_FOR_CONCURRENT = 1000;

/**
 * Handle download action from message listener
 * @param {Object} request - The download request
 * @param {Object} sender - The message sender
 * @param {Function} sendResponse - Response callback
 * @param {Map} activeDownloads - Map of active downloads
 * @param {Map} downloadInfo - Map of download info
 * @param {Map} downloadControllers - Map of download controllers
 * @param {Object} videoData - Video data object
 * @returns {boolean} - Whether to keep channel open
 */
function handleDownloadAction(
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
) {
  // Normalize URL for duplicate checking (using utility function)
  const normalizedUrl = normalizeUrlForDownload(request.url);

  // Check if this URL is already being downloaded
  // But verify the download is actually still active (not stale) - including storage (handles hung promises)
  if (activeDownloads.has(normalizedUrl)) {
    const existingDownloadId = activeDownloads.get(normalizedUrl);
    console.log(
      "Found existing download entry for URL:",
      normalizedUrl,
      "Download ID:",
      existingDownloadId,
    );

    // First check storage: if download actually completed/failed/cancelled, in-memory state is stale
    // (e.g. promise hung and .then()/.catch() never ran, so controller/info were never cleaned)
    chrome.storage.local.get(
      [
        `downloadProgress_${existingDownloadId}`,
        `downloadStatus_${existingDownloadId}`,
      ],
      (storageResult) => {
        const progress =
          storageResult[`downloadProgress_${existingDownloadId}`];
        const status = (
          storageResult[`downloadStatus_${existingDownloadId}`] || ""
        ).toLowerCase();
        const storageSaysFinished =
          progress === undefined ||
          progress === 100 ||
          status.includes("complete") ||
          status.includes("cancelled") ||
          status.includes("failed");

        if (storageSaysFinished) {
          console.log(
            "Stale download entry (storage says finished), cleaning up:",
            normalizedUrl,
            existingDownloadId,
          );
          activeDownloads.delete(normalizedUrl);
          downloadInfo.delete(existingDownloadId);
          downloadControllers.delete(existingDownloadId);
          proceedWithDownload();
          return;
        }

        // Storage says still in progress - verify in-memory state
        const controllerInfo = downloadControllers.get(existingDownloadId);
        const hasActiveController =
          controllerInfo &&
          controllerInfo.controller &&
          !controllerInfo.controller.signal.aborted;
        const info = downloadInfo.get(existingDownloadId);
        const hasDownloadInfo = !!info;

        if (!hasActiveController && !hasDownloadInfo) {
          console.log(
            "Stale download entry (no active controller or info), cleaning up:",
            normalizedUrl,
            existingDownloadId,
          );
          activeDownloads.delete(normalizedUrl);
          if (controllerInfo) downloadControllers.delete(existingDownloadId);
          proceedWithDownload();
          return;
        }

        // Download appears to be active, block new download
        console.log(
          "Download actually in progress for URL:",
          normalizedUrl,
          "Download ID:",
          existingDownloadId,
          "hasController:",
          hasActiveController,
          "hasInfo:",
          hasDownloadInfo,
        );

        const notifyContentScript = (targetTabId) => {
          chrome.tabs.sendMessage(
            targetTabId,
            {
              action: "downloadStarted",
              downloadId: existingDownloadId,
              filename: info?.filename || request.filename,
              qualityLabel: info?.qualityLabel || request.qualityLabel || "",
              isExisting: true,
            },
            (response) => {
              if (chrome.runtime.lastError) {
                console.log(
                  "Could not send existing download notification to content script:",
                  chrome.runtime.lastError.message,
                );
              }
            },
          );
        };

        const tabId = request.tabId || sender?.tab?.id;
        if (tabId) {
          notifyContentScript(tabId);
        } else {
          chrome.tabs.query({ url: "*://*.dailymotion.com/*" }, (tabs) => {
            if (tabs && tabs.length > 0) {
              notifyContentScript(tabs[0].id);
            }
          });
        }

        sendResponse({
          success: false,
          error:
            "This file is already being downloaded. Please wait for the current download to complete.",
          downloadId: existingDownloadId,
          isExisting: true,
        });
      },
    );
    return true;
  }

  proceedWithDownload();

  function proceedWithDownload() {
    // Limit concurrent downloads using persistent storage (survives service worker restart)
    chrome.storage.local.get(["activeDownloadIds"], (storageResult) => {
      const activeIds = storageResult.activeDownloadIds || [];
      // Build keys to check which downloads are still in progress (not completed)
      const keysToCheck = activeIds.flatMap((id) => [
        `downloadProgress_${id}`,
        `downloadStatus_${id}`,
      ]);
      if (keysToCheck.length === 0) {
        proceedWithCountCheck([], []);
        return;
      }
      const segmentKeys = activeIds.map((id) => `downloadSegments_${id}`);
      chrome.storage.local.get(
        keysToCheck.concat(segmentKeys),
        (progressResult) => {
          if (!progressResult) progressResult = {};
          // Remove stale IDs: completed (progress 100) or already cleaned up (no progress key)
          const stillActive = activeIds.filter((id) => {
            const progress = progressResult[`downloadProgress_${id}`];
            const status = (
              progressResult[`downloadStatus_${id}`] || ""
            ).toLowerCase();
            if (progress === undefined) return false; // cleaned up = completed/failed/cancelled
            if (progress === 100) return false; // completed
            if (
              status.includes("complete") ||
              status.includes("cancelled") ||
              status.includes("failed")
            )
              return false;
            return true;
          });
          // Segment counts for still-active downloads (HLS only; MP4 won't have this key)
          const segmentCounts = stillActive.map((id) => ({
            id,
            segments:
              parseInt(progressResult[`downloadSegments_${id}`], 10) || 0,
          }));
          proceedWithCountCheck(stillActive, segmentCounts);
        },
      );
    });

    function notifyPageDownloadBlocked(message, reason) {
      const tabId = request.tabId || sender?.tab?.id;
      if (tabId) {
        chrome.tabs.sendMessage(
          tabId,
          {
            action: "showDownloadBlockedNotification",
            message: message,
            reason: reason,
          },
          () => {
            if (chrome.runtime.lastError) {
              console.log(
                "Could not send download-blocked notification to content script:",
                chrome.runtime.lastError.message,
              );
            }
          },
        );
      } else {
        chrome.tabs.query({ url: "*://*.dailymotion.com/*" }, (tabs) => {
          if (tabs && tabs.length > 0) {
            chrome.tabs.sendMessage(
              tabs[0].id,
              {
                action: "showDownloadBlockedNotification",
                message: message,
                reason: reason,
              },
              () => {},
            );
          }
        });
      }
    }

    function proceedWithCountCheck(stillActive, segmentCounts) {
      // If any active download has > 500 segments (large HLS file), block new downloads
      const hasLargeFile =
        segmentCounts &&
        segmentCounts.some((s) => s.segments > MAX_SEGMENTS_FOR_CONCURRENT);
      if (hasLargeFile) {
        const msg =
          "A large file is currently downloading (over 500 segments). Please wait for it to complete before starting another download.";
        sendResponse({ success: false, error: msg });
        notifyPageDownloadBlocked(msg, "largeFile");
        return;
      }
      if (stillActive.length >= MAX_CONCURRENT_DOWNLOADS) {
        // Persist cleaned list and reject
        chrome.storage.local.set({ activeDownloadIds: stillActive }, () => {
          const msg = `Maximum ${MAX_CONCURRENT_DOWNLOADS} downloads at a time. Please wait for one to complete.`;
          sendResponse({ success: false, error: msg });
          notifyPageDownloadBlocked(msg, "maxConcurrent");
        });
        return;
      }
      const downloadId = generateDownloadId();
      const newActiveIds = [...stillActive, downloadId];
      chrome.storage.local.set({ activeDownloadIds: newActiveIds }, () => {
        if (chrome.runtime.lastError) {
          sendResponse({
            success: false,
            error: "Failed to register download. Please try again.",
          });
          return;
        }
        runDownloadWithId(downloadId);
      });
    }
  } // end proceedWithDownload

  function removeFromActiveDownloadIds(id) {
    chrome.storage.local.get(["activeDownloadIds"], (r) => {
      const ids = (r.activeDownloadIds || []).filter((x) => x !== id);
      chrome.storage.local.set({ activeDownloadIds: ids });
    });
  }

  function runDownloadWithId(downloadId) {
    // Get the tab ID from the request or sender
    const tabId = request.tabId || sender?.tab?.id;

    // Get video ID (DO NOT rely on request.url for HLS/fMP4 URLs, it may yield "fmp4")
    let videoId = request.videoId || null;
    try {
      if (
        !videoId &&
        tabId &&
        videoData &&
        videoData[tabId] &&
        Array.isArray(videoData[tabId].urls)
      ) {
        const match = videoData[tabId].urls.find((u) => {
          const a = fixUrlEncoding(u.url || "");
          const b = fixUrlEncoding(request.url || "");
          return a === b;
        });
        if (match && match.videoId) {
          videoId = match.videoId;
        }
      }
    } catch (e) {
      // ignore
    }
    if (!videoId && sender?.tab?.url) {
      videoId = extractVideoId(sender.tab.url);
    }
    if (!videoId) {
      videoId = extractVideoId(request.url);
    }

    // Mark this URL as actively downloading (in memory)
    activeDownloads.set(normalizedUrl, downloadId);

    // Store download info for restoration (in memory and storage)
    const info = {
      url: request.url,
      normalizedUrl: normalizedUrl,
      filename: request.filename,
      tabId: tabId,
      videoId: videoId,
      qualityLabel: request.qualityLabel || "",
      startTime: Date.now(),
    };
    downloadInfo.set(downloadId, info);

    // Also store in chrome.storage.local so it persists across service worker restarts
    chrome.storage.local.set(
      {
        [`downloadInfo_${downloadId}`]: JSON.stringify(info),
      },
      () => {
        if (chrome.runtime.lastError) {
          console.warn(
            "Failed to store download info in storage:",
            chrome.runtime.lastError,
          );
        }
      },
    );

    console.log(
      "📥 [DOWNLOAD] Starting download for URL:",
      normalizedUrl,
      "Download ID:",
      downloadId,
    );
    console.log("📥 [DOWNLOAD] Stored downloadInfo:", info);

    // Notify content script about download start with download ID
    const notifyContentScript = (targetTabId) => {
      chrome.tabs.sendMessage(
        targetTabId,
        {
          action: "downloadStarted",
          downloadId: downloadId,
          filename: request.filename,
          qualityLabel: request.qualityLabel || "",
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.log(
              "Could not send download notification to content script:",
              chrome.runtime.lastError.message,
            );
          } else {
            console.log(
              "Download notification sent to content script successfully",
            );
          }
        },
      );
    };

    if (tabId) {
      notifyContentScript(tabId);
    } else {
      // Fallback: try to find Dailymotion tab
      chrome.tabs.query({ url: "*://*.dailymotion.com/*" }, (tabs) => {
        if (tabs && tabs.length > 0) {
          notifyContentScript(tabs[0].id);
        } else {
          console.warn(
            "No Dailymotion tab found to send download notification",
          );
        }
      });
    }

    // Handle download with merging if needed
    handleDownload(
      request.url,
      request.filename,
      request.type,
      downloadId,
      downloadControllers,
      videoData,
      activeChromeDownloads,
      cleanupIndexedDBBlob,
      setupOffscreenDocument,
      blobToDataUrl,
    )
      .then(() => {
        // Remove from active downloads on success
        activeDownloads.delete(normalizedUrl);
        removeFromActiveDownloadIds(downloadId);
        const info = downloadInfo.get(downloadId);

        // Notify content script on completion (only if tab still exists and is on Dailymotion)
        if (info && info.tabId) {
          chrome.tabs.get(info.tabId, (tab) => {
            if (
              !chrome.runtime.lastError &&
              tab &&
              tab.url &&
              tab.url.includes("dailymotion.com")
            ) {
              // Check if we're still on the same video
              const currentVideoId = extractVideoId(tab.url);
              if (!info.videoId || currentVideoId === info.videoId) {
                chrome.tabs.sendMessage(
                  info.tabId,
                  {
                    action: "downloadCompleted",
                    downloadId: downloadId,
                    filename: info.filename,
                  },
                  () => {
                    // Ignore errors - tab might have navigated away
                  },
                );
              }
            }
          });
        }

        // Clean up ALL download-related storage keys after a delay
        // Wait 15s to match the delay in downloadM3U8/downloadBlob so notification can show completion
        setTimeout(() => {
          downloadInfo.delete(downloadId);
          removeFromActiveDownloadIds(downloadId); // Ensure slot is freed even if earlier call failed
          // Remove ALL download-related storage keys to prevent residue
          chrome.storage.local.remove(
            [
              `downloadInfo_${downloadId}`,
              `downloadCancelled_${downloadId}`,
              `downloadStatus_${downloadId}`,
              `downloadProgress_${downloadId}`,
              `downloadSegments_${downloadId}`,
              `blobReady_${downloadId}`, // Also clean up blob ready flag if it exists
            ],
            () => {
              if (chrome.runtime.lastError) {
                console.error(
                  "Error cleaning up download storage:",
                  chrome.runtime.lastError,
                );
              } else {
                console.log("Cleaned up all download storage for:", downloadId);
              }
            },
          );
        }, 15000);

        console.log(
          "Download completed, removed from active downloads:",
          normalizedUrl,
        );
        sendResponse({ success: true });
      })
      .catch((err) => {
        // Remove from active downloads on error
        activeDownloads.delete(normalizedUrl);
        removeFromActiveDownloadIds(downloadId);

        // Check if error is due to cancellation
        const isCancelled = err.message && err.message.includes("cancelled");

        // Clean up ALL download-related storage keys
        setTimeout(
          () => {
            downloadInfo.delete(downloadId);
            // Remove ALL download-related storage keys to prevent residue
            chrome.storage.local.remove(
              [
                `downloadInfo_${downloadId}`,
                `downloadCancelled_${downloadId}`,
                `downloadStatus_${downloadId}`,
                `downloadProgress_${downloadId}`,
                `downloadSegments_${downloadId}`,
                `blobReady_${downloadId}`, // Also clean up blob ready flag if it exists
              ],
              () => {
                if (chrome.runtime.lastError) {
                  console.error(
                    "Error cleaning up download storage:",
                    chrome.runtime.lastError,
                  );
                } else {
                  console.log(
                    "Cleaned up all download storage for (error/cancelled):",
                    downloadId,
                  );
                }
              },
            );
          },
          isCancelled ? 2000 : 15000,
        ); // Clean up cancelled downloads faster, but still give time for notification

        if (isCancelled) {
          console.log(
            "Download cancelled, removed from active downloads:",
            normalizedUrl,
          );
        } else {
          console.log(
            "Download failed, removed from active downloads:",
            normalizedUrl,
          );
        }
        sendResponse({ success: false, error: err.message });
      });
  } // end runDownload()
  return true; // Keep channel open for async response
}

/**
 * Main download handler - routes to appropriate download method
 * @param {string} url - The video URL
 * @param {string} filename - The filename
 * @param {string} type - The download type
 * @param {string} downloadId - The download ID
 * @param {Map} downloadControllers - Map of download controllers
 * @param {Object} videoData - Video data object
 * @returns {Promise<void>}
 */
async function handleDownload(
  url,
  filename,
  type,
  downloadId,
  downloadControllers,
  videoData,
  activeChromeDownloads,
  cleanupIndexedDBBlob,
  setupOffscreenDocument,
  blobToDataUrl,
) {
  // Check if already cancelled before starting
  if (await isDownloadCancelled(downloadId)) {
    throw new DOMException("Download cancelled", "AbortError");
  }

  // Create AbortController for this download
  const abortController = new AbortController();
  downloadControllers.set(downloadId, {
    controller: abortController,
    chromeDownloadId: null,
  });

  try {
    // Set initial progress immediately with download ID
    await chrome.storage.local.set({
      [`downloadProgress_${downloadId}`]: 0,
      [`downloadStatus_${downloadId}`]: "Preparing download...",
    });

    // Check if it's an m3u8 playlist or range-based URL
    if (
      type?.includes("mp4-full") ||
      (url.includes(".mp4") && !isChunkedRangeUrl(url))
    ) {
      console.log("Downloading full MP4 file...");
      await downloadFullVideoFile(
        url,
        filename,
        downloadId,
        abortController,
        downloadControllers,
        activeChromeDownloads,
        cleanupIndexedDBBlob,
        setupOffscreenDocument,
        blobToDataUrl,
      );
    } else if (
      url.includes(".m3u8") ||
      type?.includes("m3u8") ||
      type?.includes("hls")
    ) {
      console.log("Detected m3u8, merging segments...");
      // Get tabId from videoData if available
      let tabIdForDownload = null;
      for (const [tid, data] of Object.entries(videoData)) {
        if (
          data.urls &&
          data.urls.some(
            (v) =>
              v.url === url || fixUrlEncoding(v.url) === fixUrlEncoding(url),
          )
        ) {
          tabIdForDownload = parseInt(tid);
          break;
        }
      }
      await downloadAndMergeM3U8(
        url,
        filename,
        downloadId,
        abortController,
        tabIdForDownload,
        downloadControllers,
        activeChromeDownloads,
        cleanupIndexedDBBlob,
        setupOffscreenDocument,
        blobToDataUrl,
      );
    } else if (isChunkedRangeUrl(url)) {
      // COMMENTED OUT: Range URLs are filtered out during storage and never shown in popup
      // This code path should never be reached in practice
      // If it is reached, it means the filtering logic failed - fallback to downloadFullVideoFile
      console.warn(
        "Range URL detected in download handler (unexpected - should be filtered out):",
        url,
      );
      console.log("Falling back to downloadFullVideoFile...");
      await downloadFullVideoFile(
        url,
        filename,
        downloadId,
        abortController,
        downloadControllers,
        activeChromeDownloads,
        cleanupIndexedDBBlob,
        setupOffscreenDocument,
        blobToDataUrl,
      );
      // Original code (commented out):
      // console.log('Detected range-based URL, fetching full video...');
      // await downloadFullVideo(url, filename, downloadId, abortController);
    } else {
      // For MP4 files, always fetch as full file to avoid chunks
      if (url.includes(".mp4")) {
        console.log("Downloading full MP4 file...");
        await downloadFullVideoFile(
          url,
          filename,
          downloadId,
          abortController,
          downloadControllers,
          activeChromeDownloads,
          cleanupIndexedDBBlob,
          setupOffscreenDocument,
          blobToDataUrl,
        );
      } else {
        // Direct download for other file types
        downloadVideo(url, filename);
      }
    }
  } catch (error) {
    // Check if error is due to cancellation
    if (error.name === "AbortError" || abortController.signal.aborted) {
      console.log("Download was cancelled:", downloadId);
      await chrome.storage.local.set({
        [`downloadProgress_${downloadId}`]: 0,
        [`downloadStatus_${downloadId}`]: "Download cancelled",
      });
      throw new Error("Download cancelled by user");
    } else {
      // Ensure error status is set even if inner function didn't set it
      const currentStatus = await chrome.storage.local.get([
        `downloadStatus_${downloadId}`,
      ]);
      if (
        !currentStatus[`downloadStatus_${downloadId}`] ||
        (!currentStatus[`downloadStatus_${downloadId}`].includes("failed") &&
          !currentStatus[`downloadStatus_${downloadId}`].includes("error"))
      ) {
        await chrome.storage.local.set({
          [`downloadProgress_${downloadId}`]: 0,
          [`downloadStatus_${downloadId}`]: error.message || "Download failed",
        });
      }
      throw error;
    }
  } finally {
    // Clean up controller
    downloadControllers.delete(downloadId);
  }
}
