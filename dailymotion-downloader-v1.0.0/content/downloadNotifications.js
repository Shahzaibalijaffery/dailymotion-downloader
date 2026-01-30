/**
 * Download notification and progress polling functionality
 * Handles displaying download notifications and polling for progress updates
 */

// Global state for notifications
let notificationContainer = null;
let activeDownloads = new Map(); // Map of downloadId -> { filename, interval, element, pollingFailures, recreationCount }

/**
 * Create notification container if it doesn't exist
 * @returns {HTMLElement|null} Notification container element
 */
function createNotificationContainer() {
  // Only create notifications in the top frame, not in iframes
  if (window.self !== window.top) {
    console.log("Skipping notification container creation in iframe");
    return null;
  }

  // Check if container already exists in DOM first
  let existingContainer = document.getElementById(
    "vimeo-downloader-notifications",
  );
  if (existingContainer) {
    notificationContainer = existingContainer;
    return notificationContainer;
  }

  // Also check if we have a cached reference
  if (notificationContainer && document.body.contains(notificationContainer)) {
    return notificationContainer;
  }

  // Make sure body exists
  if (!document.body) {
    // Wait for body to be ready
    setTimeout(createNotificationContainer, 100);
    return null;
  }

  notificationContainer = document.createElement("div");
  notificationContainer.id = "vimeo-downloader-notifications";
  notificationContainer.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 20px;
    z-index: 999999;
    width: 400px;
    max-width: 400px;
    max-height: calc(100vh - 40px);
    display: flex;
    flex-direction: column;
    gap: 12px;
    pointer-events: none;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 8px;
  `;

  // Add responsive styles for mobile
  if (
    !document.getElementById("vimeo-downloader-notification-responsive-style")
  ) {
    const responsiveStyle = document.createElement("style");
    responsiveStyle.id = "vimeo-downloader-notification-responsive-style";
    responsiveStyle.textContent = `
      @media (max-width: 600px) {
        #vimeo-downloader-notifications {
          width: calc(100vw - 40px) !important;
          max-width: calc(100vw - 40px) !important;
          left: 20px !important;
          right: 20px !important;
          bottom: 20px !important;
        }
        
        #vimeo-downloader-notifications > div[id^="download-notification-"] {
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          padding: 12px 16px !important;
          font-size: 13px !important;
        }
      }
    `;
    document.head.appendChild(responsiveStyle);
  }

  // Add custom scrollbar styling
  if (!document.getElementById("vimeo-downloader-scrollbar-style")) {
    const scrollbarStyle = document.createElement("style");
    scrollbarStyle.id = "vimeo-downloader-scrollbar-style";
    scrollbarStyle.textContent = `
      #vimeo-downloader-notifications::-webkit-scrollbar {
        width: 6px;
      }
      #vimeo-downloader-notifications::-webkit-scrollbar-track {
        background: transparent;
      }
      #vimeo-downloader-notifications::-webkit-scrollbar-thumb {
        background: rgba(102, 126, 234, 0.5);
        border-radius: 3px;
      }
      #vimeo-downloader-notifications::-webkit-scrollbar-thumb:hover {
        background: rgba(102, 126, 234, 0.7);
      }
    `;
    document.head.appendChild(scrollbarStyle);
  }

  // Add animation style if not already added
  if (!document.getElementById("vimeo-downloader-notification-style")) {
    const style = document.createElement("style");
    style.id = "vimeo-downloader-notification-style";
    style.textContent = `
      @keyframes slideInUp {
        from {
          transform: translateY(100px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
      @keyframes slideOutDown {
        from {
          transform: translateY(0);
          opacity: 1;
        }
        to {
          transform: translateY(100px);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(notificationContainer);
  console.log("Notification container created and appended to body");

  // Verify it was actually added
  const verify = document.getElementById("vimeo-downloader-notifications");
  if (!verify) {
    console.error("Notification container was not added to DOM!");
    return null;
  }

  return notificationContainer;
}

/**
 * Show download notification
 * @param {string} downloadId - Download ID
 * @param {string} filename - Filename
 * @param {string} status - Status message
 * @param {number|undefined} progress - Progress percentage
 * @param {string} qualityLabel - Quality label
 * @param {Object} __dmDebugState - Debug state object
 */
function showDownloadNotification(
  downloadId,
  filename,
  status,
  progress,
  qualityLabel = "",
  __dmDebugState = null,
) {
  // Only show notifications in the top frame, not in iframes
  if (window.self !== window.top) {
    console.log("Skipping notification display in iframe");
    return;
  }

  console.log("showDownloadNotification called:", {
    downloadId,
    filename,
    status,
    progress,
  });
  try {
    if (__dmDebugState) {
      __dmDebugState.lastShowNotification = {
        downloadId,
        filename,
        status,
        progress,
        qualityLabel,
        href: window.location.href,
        ts: new Date().toISOString(),
      };
      __dmDebugState.lastShowNotificationError = null;
    }
  } catch (e) {
    // ignore
  }

  // Ensure body exists
  if (!document.body) {
    console.log("Document body not ready, waiting...");
    setTimeout(
      () =>
        showDownloadNotification(
          downloadId,
          filename,
          status,
          progress,
          qualityLabel,
          __dmDebugState,
        ),
      100,
    );
    return;
  }

  const container = createNotificationContainer();

  if (!container) {
    console.error("Could not create notification container");
    setTimeout(
      () =>
        showDownloadNotification(
          downloadId,
          filename,
          status,
          progress,
          qualityLabel,
          __dmDebugState,
        ),
      200,
    );
    return;
  }

  // Create individual notification element for this download
  let notificationEl = document.getElementById(
    `download-notification-${downloadId}`,
  );
  if (!notificationEl) {
    notificationEl = document.createElement("div");
    notificationEl.id = `download-notification-${downloadId}`;
    notificationEl.style.cssText = `
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px 20px;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      animation: slideInUp 0.3s ease-out;
      pointer-events: auto;
      width: 400px;
      min-width: 400px;
      max-width: 400px;
      box-sizing: border-box;
    `;

    // Apply responsive width on mobile (will be overridden by the style tag, but set initial value)
    if (window.innerWidth <= 600) {
      notificationEl.style.width = "100%";
      notificationEl.style.minWidth = "0";
      notificationEl.style.maxWidth = "100%";
    }
    container.appendChild(notificationEl);
    console.log("Created notification element for download:", downloadId);
  }

  const progressBar =
    progress !== undefined
      ? `
    <div style="margin-top: 12px; background: rgba(255, 255, 255, 0.2); border-radius: 10px; height: 6px; overflow: hidden;">
      <div style="background: white; height: 100%; width: ${progress}%; transition: width 0.3s ease; border-radius: 10px;"></div>
    </div>
    <div style="margin-top: 8px; font-size: 12px; opacity: 0.9;">${progress}%</div>
  `
      : "";

  // Show cancel button only if download is in progress (not complete or cancelled)
  const showCancelButton =
    progress !== undefined &&
    progress < 100 &&
    !status.includes("cancelled") &&
    !status.includes("complete");
  const cancelButton = showCancelButton
    ? `
    <button id="cancel-btn-${downloadId}" style="
      margin-top: 12px;
      padding: 8px 16px;
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 6px;
      color: white;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      width: 100%;
    " onmouseover="this.style.background='rgba(255, 255, 255, 0.3)'" onmouseout="this.style.background='rgba(255, 255, 255, 0.2)'">
      ❌ Cancel Download
    </button>
  `
    : "";

  // Extract just the quality part for display (e.g., "1080p" from "1080p (HLS)")
  const displayQuality = qualityLabel
    ? qualityLabel.match(/(\d+p)/i)
      ? qualityLabel.match(/(\d+p)/i)[1]
      : qualityLabel.split(" ")[0]
    : "";
  const qualityDisplay = displayQuality
    ? `<span style="opacity: 0.9; font-size: 12px; margin-left: 8px;">${displayQuality}</span>`
    : "";

  notificationEl.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
      <div style="font-size: 20px;">⬇️</div>
      <div style="flex: 1;">
        <div style="font-weight: 600; margin-bottom: 4px;">Download Started${qualityDisplay}</div>
        <div style="font-size: 12px; opacity: 0.9; word-break: break-word;">${filename}</div>
      </div>
    </div>
    <div style="font-size: 13px; opacity: 0.95; margin-top: 8px;">${status}</div>
    ${progressBar}
    ${cancelButton}
  `;

  // Add cancel button event listener if button exists
  // Use event delegation on the notification element to handle dynamically created buttons
  if (showCancelButton) {
    // Remove any existing listeners by cloning the element
    const cancelBtn = notificationEl.querySelector(`#cancel-btn-${downloadId}`);
    if (cancelBtn) {
      // Remove old listener by cloning
      const newCancelBtn = cancelBtn.cloneNode(true);
      cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

      newCancelBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log(
          "🚫 [CONTENT] Cancel button clicked for download:",
          downloadId,
        );
        console.log(
          "🚫 [CONTENT] Extension context valid:",
          isExtensionContextValid(),
        );

        // Stop polling immediately
        stopDownloadProgressPolling(downloadId);

        // Hide notification immediately
        hideDownloadNotification(downloadId);

        // Send cancel request to background (fire and forget)
        console.log(
          "🚫 [CONTENT] Sending cancelDownload message with downloadId:",
          downloadId,
        );
        safeSendMessage(
          {
            action: "cancelDownload",
            downloadId: downloadId,
          },
          (response) => {
            console.log(
              "🚫 [CONTENT] Received response from cancelDownload:",
              response,
            );
            if (response && response.success) {
              console.log("🚫 [CONTENT] ✅ Download cancellation confirmed");
            } else {
              console.warn(
                "🚫 [CONTENT] ⚠️ Download cancellation may have failed:",
                response,
              );
            }
          },
        );
      });
    } else {
      console.warn("Cancel button not found for download:", downloadId);
    }
  }

  notificationEl.style.display = "block";
  notificationEl.style.visibility = "visible";
  notificationEl.style.opacity = "1";

  // Force visibility
  if (container) {
    container.style.display = "flex";
    container.style.visibility = "visible";
  }

  console.log("Notification displayed successfully:", downloadId, filename);
  console.log("Notification element:", notificationEl);
  console.log("Notification container:", container);

  // Verify it's actually visible
  setTimeout(() => {
    const checkEl = document.getElementById(
      `download-notification-${downloadId}`,
    );
    if (checkEl) {
      const rect = checkEl.getBoundingClientRect();
      console.log("Notification position:", {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        visible: rect.width > 0 && rect.height > 0,
      });
    } else {
      console.error("Notification element not found in DOM after creation!");
    }
  }, 100);
}

/**
 * Show in-page notification when download is blocked (max 2 downloads or large file >500 segments)
 * @param {string} message - Message to show (e.g. "Maximum 2 downloads at a time...")
 * @param {string} reason - 'maxConcurrent' | 'largeFile'
 */
function showDownloadBlockedToast(message, reason = "maxConcurrent") {
  if (window.self !== window.top) return;

  const container = createNotificationContainer();
  if (!container) return;

  const id = "download-blocked-toast";
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.style.cssText = `
      background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
      color: white;
      padding: 16px 20px;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      animation: slideInUp 0.3s ease-out;
      pointer-events: auto;
      width: 400px;
      max-width: calc(100vw - 40px);
      box-sizing: border-box;
    `;
    container.appendChild(el);
  }

  const title =
    reason === "largeFile"
      ? "Large file downloading"
      : "Download limit reached";
  el.innerHTML = `
    <div style="display: flex; align-items: flex-start; gap: 12px;">
      <span style="font-size: 20px;">⏳</span>
      <div>
        <div style="font-weight: 600; margin-bottom: 6px;">${title}</div>
        <div style="font-size: 13px; opacity: 0.95;">${message}</div>
      </div>
    </div>
  `;
  el.style.display = "block";
  el.style.animation = "none";
  el.offsetHeight;
  el.style.animation = "slideInUp 0.3s ease-out";

  const hide = () => {
    el.style.animation = "slideOutDown 0.3s ease-out forwards";
    setTimeout(() => {
      el.style.display = "none";
    }, 300);
  };
  setTimeout(hide, 6000);
}

/**
 * Update download notification
 * @param {string} downloadId - Download ID
 * @param {string} filename - Filename
 * @param {string} status - Status message
 * @param {number|undefined} progress - Progress percentage
 */
function updateDownloadNotification(downloadId, filename, status, progress) {
  // Only update notifications in the top frame, not in iframes
  if (window.self !== window.top) {
    console.log("Skipping notification update in iframe");
    return;
  }

  // Ensure container exists
  const container = createNotificationContainer();
  if (!container) {
    console.error("Could not get/create notification container for update");
    return;
  }

  const notificationEl = document.getElementById(
    `download-notification-${downloadId}`,
  );
  if (!notificationEl) {
    console.warn("Notification element not found, recreating:", downloadId);
    // Try to get qualityLabel from stored download info
    safeSendMessage(
      { action: "getDownloadInfo", downloadId: downloadId },
      (response) => {
        const qualityLabel = response?.info?.qualityLabel || "";
        showDownloadNotification(
          downloadId,
          filename,
          status,
          progress,
          qualityLabel,
        );
      },
    );
    return;
  }

  const progressBar =
    progress !== undefined
      ? `
    <div style="margin-top: 12px; background: rgba(255, 255, 255, 0.2); border-radius: 10px; height: 6px; overflow: hidden;">
      <div style="background: white; height: 100%; width: ${progress}%; transition: width 0.3s ease; border-radius: 10px;"></div>
    </div>
    <div style="margin-top: 8px; font-size: 12px; opacity: 0.9;">${progress}%</div>
  `
      : "";

  const isCancelled = status && status.toLowerCase().includes("cancelled");
  const isFailed =
    status &&
    (status.toLowerCase().includes("failed") ||
      status.toLowerCase().includes("error"));
  const statusIcon = isCancelled
    ? "❌"
    : isFailed
      ? "⚠️"
      : progress === 100
        ? "✅"
        : "⬇️";
  const statusText = isCancelled
    ? "Download Cancelled"
    : isFailed
      ? "Download Failed"
      : progress === 100
        ? "Download Complete"
        : "Downloading";

  // Show cancel button only if download is in progress (not complete, cancelled, or failed)
  const showCancelButton =
    progress !== undefined &&
    progress < 100 &&
    !isCancelled &&
    !isFailed &&
    !status.includes("complete");
  // Show dismiss button for failed or cancelled downloads
  const showDismissButton = isFailed || isCancelled;

  const cancelButton = showCancelButton
    ? `
    <button id="cancel-btn-${downloadId}" style="
      margin-top: 12px;
      padding: 8px 16px;
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 6px;
      color: white;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      width: 100%;
    " onmouseover="this.style.background='rgba(255, 255, 255, 0.3)'" onmouseout="this.style.background='rgba(255, 255, 255, 0.2)'">
      ❌ Cancel Download
    </button>
  `
    : "";

  const dismissButton = showDismissButton
    ? `
    <button id="dismiss-btn-${downloadId}" style="
      margin-top: 12px;
      padding: 8px 16px;
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 6px;
      color: white;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      width: 100%;
    " onmouseover="this.style.background='rgba(255, 255, 255, 0.3)'" onmouseout="this.style.background='rgba(255, 255, 255, 0.2)'">
      ✕ Dismiss
    </button>
  `
    : "";

  notificationEl.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
      <div style="font-size: 20px;">${statusIcon}</div>
      <div style="flex: 1;">
        <div style="font-weight: 600; margin-bottom: 4px;">${statusText}</div>
        <div style="font-size: 12px; opacity: 0.9; word-break: break-word;">${filename}</div>
      </div>
    </div>
    <div style="font-size: 13px; opacity: 0.95; margin-top: 8px;">${status}</div>
    ${progressBar}
    ${cancelButton}
    ${dismissButton}
  `;

  // Add cancel button event listener if button exists
  if (showCancelButton) {
    const cancelBtn = notificationEl.querySelector(`#cancel-btn-${downloadId}`);
    if (cancelBtn) {
      // Remove existing listener by cloning
      const newCancelBtn = cancelBtn.cloneNode(true);
      cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

      newCancelBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("Cancel button clicked for download:", downloadId);
        // Check current status first
        safeStorageGet([`downloadStatus_${downloadId}`], (result) => {
          const currentStatus = result[`downloadStatus_${downloadId}`] || "";
          const isFailedOrCancelled =
            currentStatus.toLowerCase().includes("failed") ||
            currentStatus.toLowerCase().includes("error") ||
            currentStatus.toLowerCase().includes("cancelled");

          if (isFailedOrCancelled) {
            // Download already failed/cancelled, just hide the notification
            hideDownloadNotification(downloadId);
            return;
          }

          // Stop polling immediately
          stopDownloadProgressPolling(downloadId);

          // Hide notification immediately
          hideDownloadNotification(downloadId);

          // Try to cancel the download (fire and forget)
          safeSendMessage(
            {
              action: "cancelDownload",
              downloadId: downloadId,
            },
            (response) => {
              if (response && response.success) {
                console.log("Download cancellation confirmed");
              } else {
                console.warn(
                  "Download cancellation may have failed:",
                  response,
                );
              }
            },
          );
        });
      });
    } else {
      console.warn(
        "Cancel button not found in updateNotification for download:",
        downloadId,
      );
    }
  }

  // Add dismiss button event listener if button exists
  if (showDismissButton) {
    const dismissBtn = document.getElementById(`dismiss-btn-${downloadId}`);
    if (dismissBtn) {
      dismissBtn.addEventListener("click", () => {
        console.log("Dismiss button clicked for download:", downloadId);
        hideDownloadNotification(downloadId);
      });
    }
  }
}

/**
 * Hide download notification
 * @param {string} downloadId - Download ID
 */
function hideDownloadNotification(downloadId) {
  const notificationEl = document.getElementById(
    `download-notification-${downloadId}`,
  );
  if (notificationEl) {
    notificationEl.style.animation = "slideOutDown 0.3s ease-out";
    setTimeout(() => {
      if (notificationEl && notificationEl.parentNode) {
        notificationEl.parentNode.removeChild(notificationEl);
      }
      activeDownloads.delete(downloadId);
    }, 300);
  }
}

/**
 * Start polling for download progress
 * @param {string} downloadId - Download ID
 * @param {string} filename - Filename
 */
const MAX_CONCURRENT_POLLING_DOWNLOADS = 12;

function startDownloadProgressPolling(downloadId, filename) {
  // Don't start if already polling for this download
  if (activeDownloads.has(downloadId)) return;

  // Cap number of simultaneous polling intervals to prevent memory/CPU leak
  if (activeDownloads.size >= MAX_CONCURRENT_POLLING_DOWNLOADS) {
    const firstKey = activeDownloads.keys().next().value;
    if (firstKey) stopDownloadProgressPolling(firstKey);
  }

  // Check if extension context is valid before starting
  if (!isExtensionContextValid()) {
    console.warn("Extension context invalidated, cannot start polling");
    return;
  }

  // Check immediately
  const checkProgress = () => {
    // Check if extension context is still valid - stop immediately if invalidated
    if (!isExtensionContextValid()) {
      // Stop polling silently - extension was reloaded
      stopDownloadProgressPolling(downloadId);
      return;
    }

    // Check if this download is still being tracked (might have been stopped already)
    if (!activeDownloads.has(downloadId)) {
      // Polling was already stopped, don't continue
      return;
    }

    // Use safe storage access
    safeStorageGet(
      [`downloadProgress_${downloadId}`, `downloadStatus_${downloadId}`],
      (result) => {
        // Check again if extension context is still valid after async operation
        if (!isExtensionContextValid()) {
          stopDownloadProgressPolling(downloadId);
          return;
        }

        // Check again if download is still being tracked
        if (!activeDownloads.has(downloadId)) {
          return;
        }
        if (!result) {
          console.warn("No result from storage for download:", downloadId);
          return;
        }

        const progress = result[`downloadProgress_${downloadId}`];
        const status = result[`downloadStatus_${downloadId}`];

        // Verify notification element still exists
        const notificationEl = document.getElementById(
          `download-notification-${downloadId}`,
        );
        if (!notificationEl) {
          // Check if download still exists before recreating
          const downloadInfo = activeDownloads.get(downloadId);
          if (!downloadInfo) {
            // Polling was stopped, don't recreate - this is normal when download completes
            return;
          }

          // Check if we're still on a video page and container exists before recreating
          if (
            !isVideoPage() ||
            !document.getElementById("vimeo-downloader-notifications")
          ) {
            // Page navigated away or container removed, stop polling silently
            stopDownloadProgressPolling(downloadId);
            return;
          }

          // Check if download exists in background and is still active
          safeSendMessage(
            { action: "getDownloadInfo", downloadId: downloadId },
            (response) => {
              if (response && response.info) {
                // Check if download is complete
                safeStorageGet(
                  [
                    `downloadProgress_${downloadId}`,
                    `downloadStatus_${downloadId}`,
                  ],
                  (progressResult) => {
                    const downloadProgress =
                      progressResult[`downloadProgress_${downloadId}`];
                    const downloadStatus =
                      progressResult[`downloadStatus_${downloadId}`] || "";

                    // If download is complete or failed, don't recreate notification
                    if (
                      downloadProgress === 100 ||
                      downloadStatus.toLowerCase().includes("complete") ||
                      downloadStatus.toLowerCase().includes("failed") ||
                      downloadStatus.toLowerCase().includes("cancelled")
                    ) {
                      console.log(
                        "Download completed/failed, stopping polling:",
                        downloadId,
                      );
                      stopDownloadProgressPolling(downloadId);
                      return;
                    }

                    // Download exists and is still active, recreate notification (but limit recreations)
                    if (!downloadInfo.recreationCount) {
                      downloadInfo.recreationCount = 0;
                    }
                    downloadInfo.recreationCount++;

                    // Only recreate a few times to prevent loops
                    if (downloadInfo.recreationCount <= 3) {
                      // Use console.log instead of console.warn - this is often normal (DOM mutations, etc.)
                      console.log(
                        "Notification element missing during polling, recreating:",
                        downloadId,
                        `(attempt ${downloadInfo.recreationCount}/3)`,
                      );
                      showDownloadNotification(
                        downloadId,
                        filename,
                        status || "Preparing download...",
                        progress || 0,
                      );
                    } else {
                      // Too many recreations - might be a persistent DOM issue, stop silently
                      console.log(
                        "Too many notification recreations, stopping polling:",
                        downloadId,
                      );
                      stopDownloadProgressPolling(downloadId);
                    }
                  },
                );
              } else {
                // Download doesn't exist, stop polling
                console.log(
                  "Download not found in background, stopping polling:",
                  downloadId,
                );
                stopDownloadProgressPolling(downloadId);
              }
            },
          );
          return;
        }

        // Reset recreation count and polling failures if notification exists
        const downloadInfo = activeDownloads.get(downloadId);
        if (downloadInfo) {
          downloadInfo.recreationCount = 0;
          if (downloadInfo.pollingFailures > 0) {
            downloadInfo.pollingFailures = 0;
          }
        }

        if (progress !== undefined && progress !== null) {
          updateDownloadNotification(
            downloadId,
            filename,
            status || "Preparing download...",
            progress,
          );

          // Check if download is complete (progress 100 or status includes "complete")
          const isComplete =
            progress === 100 ||
            (status && status.toLowerCase().includes("complete"));

          if (isComplete) {
            // Download complete - update notification to show completion FIRST
            updateDownloadNotification(
              downloadId,
              filename,
              status || "Download complete!",
              100
            );
            // Stop polling after updating notification
            stopDownloadProgressPolling(downloadId);
            // Hide notification after delay so user sees completion
            setTimeout(() => {
              hideDownloadNotification(downloadId);
            }, 5000); // Increased from 3s to 5s so user can see completion
            return;
          }

          // Check if cancelled or failed
          if (
            status &&
            (status.toLowerCase().includes("cancelled") ||
              status.toLowerCase().includes("failed") ||
              status.toLowerCase().includes("error"))
          ) {
            // Download was cancelled or failed, stop polling but keep notification visible with dismiss button
            stopDownloadProgressPolling(downloadId);
            // Update notification one more time to show dismiss button
            updateDownloadNotification(downloadId, filename, status, progress);
            return;
          }
        } else {
          // No progress data - check if download still exists in background
          const downloadInfo = activeDownloads.get(downloadId);
          if (!downloadInfo) {
            // Download info not found - might be completed/cleaned up, stop polling silently
            console.log(
              "Download info not found (likely completed), stopping polling:",
              downloadId,
            );
            stopDownloadProgressPolling(downloadId);
            return;
          }

          // Check if download still exists in background script
          safeSendMessage(
            { action: "getDownloadInfo", downloadId: downloadId },
            (response) => {
              if (!response || !response.info) {
                // Download doesn't exist in background, stop polling
                console.log(
                  "Download not found in background script, stopping polling:",
                  downloadId,
                );
                stopDownloadProgressPolling(downloadId);
                // Hide notification if it exists
                const notificationEl = document.getElementById(
                  `download-notification-${downloadId}`,
                );
                if (notificationEl) {
                  hideDownloadNotification(downloadId);
                }
                return;
              }

              // Download exists but no progress data - might be a temporary storage issue
              // Track polling failures
              if (!downloadInfo.pollingFailures) {
                downloadInfo.pollingFailures = 0;
              }
              downloadInfo.pollingFailures++;

              if (downloadInfo.pollingFailures > 10) {
                // Too many failures, stop polling but keep notification
                console.warn(
                  "Multiple polling failures (no progress data), stopping polling but keeping notification:",
                  downloadId,
                );
                stopDownloadProgressPolling(downloadId);
                // Update notification to show "Waiting for progress..."
                updateDownloadNotification(
                  downloadId,
                  filename,
                  "Waiting for progress update...",
                  undefined,
                );
              } else {
                // Temporary issue, continue polling (only log every 5th attempt to reduce noise)
                if (downloadInfo.pollingFailures % 5 === 0) {
                  console.log(
                    `No progress data yet (attempt ${downloadInfo.pollingFailures}/10) for download:`,
                    downloadId,
                  );
                }
              }
            },
          );
        }
      },
    );
  };

  checkProgress();

  // Poll every 500ms
  const interval = setInterval(checkProgress, 500);
  activeDownloads.set(downloadId, {
    filename,
    interval,
    element: null,
    pollingFailures: 0,
  });
}

/**
 * Stop polling for download progress
 * @param {string} downloadId - Download ID
 */
function stopDownloadProgressPolling(downloadId) {
  const download = activeDownloads.get(downloadId);
  if (download && download.interval) {
    clearInterval(download.interval);
  }
  activeDownloads.delete(downloadId);
}

/**
 * Get active downloads map (for external access)
 * @returns {Map} Active downloads map
 */
function getActiveDownloads() {
  return activeDownloads;
}
