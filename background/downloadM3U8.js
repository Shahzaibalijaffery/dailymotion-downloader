/**
 * M3U8 download and merge functionality
 * Handles downloading HLS playlists, segments, and merging them into a single video file
 */

/**
 * Get fetch options with proper headers for Dailymotion requests
 * @param {string} url - The URL to fetch
 * @param {number|null} tabId - The tab ID for cookie access
 * @param {AbortController|null} abortController - Abort controller for cancellation
 * @returns {Promise<Object>} Fetch options object
 */
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

  // Add abort signal if provided
  if (abortController && abortController.signal) {
    options.signal = abortController.signal;
  }

  // Try to get cookies from the tab if available
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

/**
 * Parse M3U8 playlist to extract segments and init segment URL
 * @param {string} playlistText - The M3U8 playlist text
 * @param {string} baseUrl - Base URL for resolving relative URLs
 * @returns {Object} Object with segments array and initSegmentUrl
 */
function parseM3U8(playlistText, baseUrl) {
  const lines = playlistText.split("\n");
  const segments = [];
  let initSegmentUrl = null;

  // First pass: look for any lines that might contain init segment info (case-insensitive)
  const mapLines = lines.filter((line) => {
    const upperLine = line.toUpperCase();
    return (
      upperLine.includes("#EXT-X-MAP") ||
      (upperLine.includes("MAP") && line.startsWith("#")) ||
      (upperLine.includes("INIT") && line.startsWith("#"))
    );
  });
  if (mapLines.length > 0) {
    console.log(
      `Found ${mapLines.length} potential MAP/init line(s) in playlist`,
    );
    mapLines.slice(0, 3).forEach((line, idx) => {
      console.log(`  MAP line ${idx + 1}:`, line.substring(0, 150));
    });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const upperLine = line.toUpperCase();

    // Check for init segment (map URL) - case-insensitive
    // Format: #EXT-X-MAP:URI="..." or #EXT-X-MAP:URI=... or just #EXT-X-MAP:...
    if (upperLine.startsWith("#EXT-X-MAP")) {
      console.log("Processing #EXT-X-MAP line:", line.substring(0, 200));
      let uri = null;

      // Try different parsing methods
      // Method 1: URI="..." or URI=...
      const uriMatch1 = line.match(/URI=["']?([^"'\s]+)["']?/i);
      if (uriMatch1) {
        uri = uriMatch1[1];
        console.log("  Extracted URI via Method 1:", uri);
      } else {
        // Method 2: Direct URL after colon (less common)
        const colonIndex = line.indexOf(":");
        if (colonIndex !== -1) {
          const afterColon = line.substring(colonIndex + 1).trim();
          // Check if it looks like a URL or path
          if (
            afterColon &&
            (afterColon.startsWith("http") ||
              afterColon.startsWith("/") ||
              afterColon.startsWith("./"))
          ) {
            uri = afterColon;
            console.log("  Extracted URI via Method 2:", uri);
          }
        }

        // Method 3: Try to find any URL-like string in the line
        if (!uri) {
          const urlMatch = line.match(
            /(https?:\/\/[^\s"']+|\.\/[^\s"']+|\/[^\s"']+)/,
          );
          if (urlMatch) {
            uri = urlMatch[1];
            console.log("  Extracted URI via Method 3 (URL pattern):", uri);
          }
        }
      }

      if (uri) {
        // Decode URI if needed
        try {
          uri = decodeURIComponent(uri);
        } catch (e) {
          // URI might not be encoded, continue with original
        }

        if (uri.startsWith("http://") || uri.startsWith("https://")) {
          initSegmentUrl = uri;
        } else if (uri.startsWith("/")) {
          const urlObj = new URL(baseUrl);
          initSegmentUrl = `${urlObj.protocol}//${urlObj.host}${uri}`;
        } else if (uri.startsWith("./")) {
          initSegmentUrl = baseUrl + uri.substring(2);
        } else {
          initSegmentUrl = baseUrl + uri;
        }
        console.log(
          "✅ Found #EXT-X-MAP with URI:",
          uri,
          "-> resolved to:",
          initSegmentUrl,
        );
      } else {
        console.warn(
          "⚠️ Found #EXT-X-MAP but could not extract URI. Full line:",
          line,
        );
      }
      continue; // Skip this line, don't add it as a segment
    }

    // Skip other comments and empty lines
    if (line.startsWith("#") || !line) continue;

    // If line is a URL
    if (line.startsWith("http://") || line.startsWith("https://")) {
      segments.push(line);
    } else if (line.startsWith("/")) {
      // Relative URL from root
      const urlObj = new URL(baseUrl);
      segments.push(`${urlObj.protocol}//${urlObj.host}${line}`);
    } else {
      // Relative URL
      segments.push(baseUrl + line);
    }
  }

  // Log summary
  if (initSegmentUrl) {
    console.log(
      `✅ parseM3U8: Found ${segments.length} segments and init segment: ${initSegmentUrl}`,
    );
  } else {
    console.log(
      `⚠️ parseM3U8: Found ${segments.length} segments but NO init segment`,
    );
    if (mapLines.length > 0) {
      console.warn(
        `  Note: Found ${mapLines.length} potential MAP line(s) but couldn't parse init segment URL`,
      );
    }
  }

  // Return both segments and init segment URL
  return { segments, initSegmentUrl };
}

/**
 * Parse master playlist to extract quality variants
 * @param {string} playlistText - The master playlist text
 * @param {string} baseUrl - Base URL for resolving relative URLs
 * @returns {Array} Array of variant objects with url, bandwidth, and resolution
 */
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
      // This is the URL for the variant
      let variantUrl;
      if (line.startsWith("http://") || line.startsWith("https://")) {
        variantUrl = line;
      } else if (line.startsWith("/")) {
        const urlObj = new URL(baseUrl);
        variantUrl = `${urlObj.protocol}//${urlObj.host}${line}`;
      } else {
        variantUrl = baseUrl + line;
      }

      currentVariant.url = variantUrl;
      variants.push(currentVariant);
      currentVariant = null;
    }
  }

  // Sort by bandwidth (highest first)
  variants.sort((a, b) => b.bandwidth - a.bandwidth);

  return variants;
}

/**
 * Download and merge M3U8 playlist segments into a single video file
 * @param {string} m3u8Url - The M3U8 playlist URL
 * @param {string} filename - The filename for the final video
 * @param {string} downloadId - The download ID for tracking
 * @param {AbortController} abortController - Abort controller for cancellation
 * @param {number|null} tabId - The tab ID for cookie access
 * @param {Map} downloadControllers - Map of download controllers
 * @param {Map} activeChromeDownloads - Map of active Chrome downloads
 * @param {Function} cleanupIndexedDBBlob - Function to cleanup IndexedDB blobs
 * @param {Function} setupOffscreenDocument - Function to setup offscreen document
 * @param {Function} blobToDataUrl - Function to convert blob to data URL
 * @returns {Promise<void>}
 */

/**
 * Download by streaming chunks from IDB (avoids allocating 2GB buffer when assembly failed).
 * Chrome's download manager may not trigger our fetch handler (NETWORK_FAILED); then we fall back to blob-from-chunks.
 */
async function downloadViaStreamFromChunks(
  chunksOnlyForDownload,
  filename,
  downloadId,
  downloadControllers,
  activeChromeDownloads,
  cleanupIndexedDBBlob,
) {
  const { blobId, chunkCount, totalSize } = chunksOnlyForDownload;
  const sanitized = typeof sanitizeFilenameForDownload === "function"
    ? sanitizeFilenameForDownload(filename)
    : filename.replace(/[\\/:*?"<>|]/g, "_");
  const streamUrl =
    chrome.runtime.getURL("stream") +
    "?" +
    new URLSearchParams({
      blobId,
      chunkCount: String(chunkCount),
      totalSize: String(totalSize),
    }).toString();

  return new Promise((resolve, reject) => {
    const controllerInfo = downloadControllers.get(downloadId);
    if (controllerInfo?.controller.signal.aborted) {
      reject(new Error("Download cancelled"));
      return;
    }
    chrome.downloads.download(
      {
        url: streamUrl,
        filename: sanitized,
        saveAs: false,
      },
      (chromeDownloadId) => {
        if (chrome.runtime.lastError || chromeDownloadId === undefined) {
          reject(new Error(chrome.runtime.lastError?.message || "Download failed"));
          return;
        }
        activeChromeDownloads.set(chromeDownloadId, {
          downloadId,
          blobUrl: null,
          blobId: blobId + "_chunks",
          filename: sanitized,
        });
        if (controllerInfo) controllerInfo.chromeDownloadId = chromeDownloadId;
        const poll = () => {
          chrome.downloads.search({ id: chromeDownloadId }, (results) => {
            if (!results || results.length === 0) {
              setTimeout(poll, 1000);
              return;
            }
            const state = results[0].state;
            if (state === "complete") {
              activeChromeDownloads.delete(chromeDownloadId);
              resolve();
            } else if (state === "interrupted") {
              activeChromeDownloads.delete(chromeDownloadId);
              reject(new Error(results[0].error || "Download interrupted"));
            } else {
              setTimeout(poll, 1000);
            }
          });
        };
        poll();
      },
    );
  });
}

/**
 * Fallback when stream URL fails (NETWORK_FAILED): offscreen builds a Blob from IDB chunks,
 * creates a blob URL, and we use that for chrome.downloads.download. May fail for 2GB if offscreen hits allocation limit.
 */
async function downloadViaBlobFromChunks(
  chunksOnlyForDownload,
  filename,
  downloadId,
  downloadControllers,
  activeChromeDownloads,
  setupOffscreenDocument,
) {
  const { blobId, chunkCount } = chunksOnlyForDownload;
  const sanitized = typeof sanitizeFilenameForDownload === "function"
    ? sanitizeFilenameForDownload(filename)
    : filename.replace(/[\\/:*?"<>|]/g, "_");
  await setupOffscreenDocument();
  const buildResult = await new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: "buildBlobFromChunksForDownload", blobId, chunkCount },
      (response) => {
        if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
        else resolve(response || { success: false, error: "No response" });
      },
    );
  });
  if (!buildResult || !buildResult.success || !buildResult.blobUrl) {
    throw new Error(buildResult?.error || "Failed to build blob from chunks");
  }
  const blobUrl = buildResult.blobUrl;
  // Short delay so the blob URL is stable before Chrome fetches it (avoids intermittent NETWORK_FAILED / multiple failed attempts)
  await new Promise((r) => setTimeout(r, 400));
  return new Promise((resolve, reject) => {
    const controllerInfo = downloadControllers.get(downloadId);
    if (controllerInfo?.controller.signal.aborted) {
      try { chrome.runtime.sendMessage({ action: "revokeBlobUrl", blobUrl }, () => {}); } catch (e) {}
      reject(new Error("Download cancelled"));
      return;
    }
    chrome.downloads.download(
      { url: blobUrl, filename: sanitized, saveAs: false },
      (chromeDownloadId) => {
        if (chrome.runtime.lastError || chromeDownloadId === undefined) {
          try { chrome.runtime.sendMessage({ action: "revokeBlobUrl", blobUrl }, () => {}); } catch (e) {}
          reject(new Error(chrome.runtime.lastError?.message || "Download failed"));
          return;
        }
        activeChromeDownloads.set(chromeDownloadId, {
          downloadId,
          blobUrl,
          blobId: blobId + "_chunks",
          filename: sanitized,
        });
        if (controllerInfo) controllerInfo.chromeDownloadId = chromeDownloadId;
        const revokeWhenDone = () => {
          try { chrome.runtime.sendMessage({ action: "revokeBlobUrl", blobUrl }, () => {}); } catch (e) {}
        };
        const poll = () => {
          chrome.downloads.search({ id: chromeDownloadId }, (results) => {
            if (!results || results.length === 0) {
              setTimeout(poll, 1000);
              return;
            }
            const state = results[0].state;
            if (state === "complete") {
              activeChromeDownloads.delete(chromeDownloadId);
              revokeWhenDone();
              resolve();
            } else if (state === "interrupted") {
              activeChromeDownloads.delete(chromeDownloadId);
              revokeWhenDone();
              reject(new Error(results[0].error || "Download interrupted"));
            } else {
              setTimeout(poll, 1000);
            }
          });
        };
        poll();
      },
    );
  });
}

const CHUNKED_MP4_PART_SIZE_BYTES = 500 * 1024 * 1024; // 500MB per part

/**
 * When full-file MP4 conversion fails (e.g. 2GB+ allocation), convert TS in 500MB parts in offscreen,
 * then download each part as part1.mp4, part2.mp4, ... Chunks stay in IDB until all parts are done.
 */
async function downloadViaChunkedMp4Conversion(
  chunksOnlyForDownload,
  finalFilename,
  downloadId,
  downloadControllers,
  activeChromeDownloads,
  setupOffscreenDocument,
) {
  const { blobId, chunkCount, totalSize } = chunksOnlyForDownload;
  const partSizeBytes = CHUNKED_MP4_PART_SIZE_BYTES;
  const numParts = Math.ceil(totalSize / partSizeBytes);
  if (numParts <= 0) {
    throw new Error("No parts to convert");
  }
  const baseName = finalFilename.replace(/\.ts$/i, "").trim();
  const sanitize = typeof sanitizeFilenameForDownload === "function"
    ? sanitizeFilenameForDownload
    : (s) => s.replace(/[\\/:*?"<>|]/g, "_");

  await setupOffscreenDocument();

  for (let partIndex = 0; partIndex < numParts; partIndex++) {
    const controllerInfo = downloadControllers.get(downloadId);
    if (controllerInfo?.controller.signal.aborted) {
      throw new Error("Download cancelled");
    }
    await chrome.storage.local.set({
      [`downloadStatus_${downloadId}`]: `Converting to MP4 (part ${partIndex + 1}/${numParts})...`,
    });

    const convertResult = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: "convertPartToMp4",
          blobId,
          chunkCount,
          totalSize,
          partIndex,
          partSizeBytes,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response || { success: false });
          }
        },
      );
    });

    if (convertResult.skipped) continue;
    if (!convertResult.success || !convertResult.blobUrl) {
      throw new Error(convertResult.error || "Part conversion failed");
    }

    const partFilename = sanitize(`${baseName}_part${partIndex + 1}.mp4`);
    await chrome.storage.local.set({
      [`downloadStatus_${downloadId}`]: `Saving part ${partIndex + 1}/${numParts}...`,
    });

    const controllerInfoPart = downloadControllers.get(downloadId);
    await new Promise((resolve, reject) => {
      const blobUrl = convertResult.blobUrl;
      if (controllerInfoPart?.controller.signal.aborted) {
        try { chrome.runtime.sendMessage({ action: "revokeBlobUrl", blobUrl }, () => {}); } catch (e) {}
        reject(new Error("Download cancelled"));
        return;
      }
      chrome.downloads.download(
        { url: blobUrl, filename: partFilename, saveAs: false },
        (chromeDownloadId) => {
          if (chrome.runtime.lastError || chromeDownloadId === undefined) {
            try { chrome.runtime.sendMessage({ action: "revokeBlobUrl", blobUrl }, () => {}); } catch (e) {}
            reject(new Error(chrome.runtime.lastError?.message || "Download failed"));
            return;
          }
          activeChromeDownloads.set(chromeDownloadId, {
            downloadId,
            blobUrl,
            blobId: blobId + "_chunks_part",
            filename: partFilename,
          });
          const revokeWhenDone = () => {
            try { chrome.runtime.sendMessage({ action: "revokeBlobUrl", blobUrl }, () => {}); } catch (e) {}
          };
          const poll = () => {
            chrome.downloads.search({ id: chromeDownloadId }, (results) => {
              if (!results || results.length === 0) {
                setTimeout(poll, 1000);
                return;
              }
              const state = results[0].state;
              if (state === "complete") {
                activeChromeDownloads.delete(chromeDownloadId);
                revokeWhenDone();
                resolve();
              } else if (state === "interrupted") {
                activeChromeDownloads.delete(chromeDownloadId);
                revokeWhenDone();
                reject(new Error(results[0].error || "Download interrupted"));
              } else {
                setTimeout(poll, 1000);
              }
            });
          };
          poll();
        },
      );
    });
  }

  await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: "deleteChunksForBlob", blobId, chunkCount },
      (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (response && !response.success) reject(new Error(response.error || "Cleanup failed"));
        else resolve();
      },
    );
  });
}

async function downloadAndMergeM3U8(
  m3u8Url,
  filename,
  downloadId,
  abortController,
  tabId = null,
  downloadControllers,
  activeChromeDownloads,
  cleanupIndexedDBBlob,
  setupOffscreenDocument,
  blobToDataUrl,
) {
  try {
    // Set initial progress immediately
    await chrome.storage.local.set({
      [`downloadProgress_${downloadId}`]: 1,
      [`downloadStatus_${downloadId}`]: "Fetching playlist...",
    });

    // Check if cancelled before starting
    if (abortController.signal.aborted) {
      throw new DOMException("Download cancelled", "AbortError");
    }

    // Fix URL encoding issues
    m3u8Url = fixUrlEncoding(m3u8Url);
    console.log("Fixed m3u8 URL:", m3u8Url);

    // Fetch the m3u8 playlist with error handling and proper headers
    let playlistResponse;
    try {
      const fetchOptions = await getFetchOptionsWithHeaders(
        m3u8Url,
        tabId,
        abortController,
      );
      playlistResponse = await fetch(m3u8Url, fetchOptions);
      if (!playlistResponse.ok) {
        throw new Error(
          `Failed to fetch playlist: HTTP ${playlistResponse.status} ${playlistResponse.statusText}`,
        );
      }
    } catch (error) {
      if (error.name === "AbortError" || abortController.signal.aborted) {
        throw error;
      }
      throw new Error(
        `Network error: Could not fetch video playlist. ${error.message}`,
      );
    }

    let playlistText = await playlistResponse.text();

    if (!playlistText || playlistText.trim().length === 0) {
      throw new Error("Playlist file is empty or invalid");
    }

    // Log the fetched playlist for debugging
    console.log(`=== FETCHED PLAYLIST FROM: ${m3u8Url} ===`);
    console.log(
      `Playlist size: ${playlistText.length} characters, ${playlistText.split("\n").length} lines`,
    );
    const initialLines = playlistText.split("\n");
    console.log("First 30 lines of fetched playlist:");
    initialLines.slice(0, 30).forEach((line, idx) => {
      console.log(`Initial line ${idx + 1}:`, line.substring(0, 200));
    });

    // Check for MAP/INIT in initial playlist
    const initialMapLines = initialLines.filter((line) => {
      const upper = line.toUpperCase();
      return (
        upper.includes("MAP") ||
        upper.includes("INIT") ||
        upper.includes("EXT-X-MAP")
      );
    });
    if (initialMapLines.length > 0) {
      console.log(
        `=== FOUND ${initialMapLines.length} MAP/INIT LINES IN INITIAL PLAYLIST ===`,
      );
      initialMapLines.forEach((line, idx) => {
        console.log(`Initial MAP/INIT ${idx + 1}:`, line);
      });
    }
    console.log("=== END INITIAL PLAYLIST CONTENT ===");

    // Update progress after fetching playlist
    await chrome.storage.local.set({
      [`downloadProgress_${downloadId}`]: 2,
      [`downloadStatus_${downloadId}`]: "Parsing playlist...",
    });

    // Check if this is a master playlist (contains #EXT-X-STREAM-INF)
    const isMasterPlaylist = playlistText.includes("#EXT-X-STREAM-INF");
    console.log(`Is master playlist: ${isMasterPlaylist}`);

    let segments = [];
    let initSegmentUrl = null;

    if (isMasterPlaylist) {
      // This is a master playlist - find the best quality variant
      console.log("Master playlist detected, finding best quality...");
      const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf("/") + 1);

      // First, check if master playlist itself has #EXT-X-MAP (rare but possible)
      const masterParsed = parseM3U8(playlistText, baseUrl);
      if (masterParsed.initSegmentUrl) {
        console.log(
          "Found init segment in master playlist:",
          masterParsed.initSegmentUrl,
        );
        initSegmentUrl = masterParsed.initSegmentUrl;
      }

      const variantPlaylists = parseMasterPlaylist(playlistText, baseUrl);

      if (variantPlaylists.length === 0) {
        throw new Error("No variant playlists found in master playlist");
      }

      // Use the first (usually highest quality) variant
      let variantUrl = variantPlaylists[0].url;
      console.log(`Using variant playlist: ${variantUrl}`);

      // Check if cancelled
      if (abortController.signal.aborted) {
        throw new DOMException("Download cancelled", "AbortError");
      }

      // Fix variant URL encoding
      variantUrl = fixUrlEncoding(variantUrl);

      // Fetch the variant playlist with error handling and proper headers
      let variantResponse;
      try {
        const fetchOptions = await getFetchOptionsWithHeaders(
          variantUrl,
          tabId,
          abortController,
        );
        variantResponse = await fetch(variantUrl, fetchOptions);
        if (!variantResponse.ok) {
          throw new Error(
            `Failed to fetch variant playlist: HTTP ${variantResponse.status} ${variantResponse.statusText}`,
          );
        }
      } catch (error) {
        if (error.name === "AbortError" || abortController.signal.aborted) {
          throw error;
        }
        throw new Error(
          `Network error: Could not fetch video quality variant. ${error.message}`,
        );
      }

      const variantText = await variantResponse.text();

      if (!variantText || variantText.trim().length === 0) {
        throw new Error("Variant playlist file is empty or invalid");
      }

      // Log variant playlist content for debugging
      console.log(
        `=== VARIANT PLAYLIST CONTENT (${variantText.length} chars, ${variantText.split("\n").length} lines) ===`,
      );
      const variantLines = variantText.split("\n");
      console.log("First 50 lines of variant playlist:");
      variantLines.slice(0, 50).forEach((line, idx) => {
        console.log(`Variant line ${idx + 1}:`, line.substring(0, 200));
      });

      // Find all MAP/INIT related lines in variant
      const variantMapLines = variantLines.filter((line) => {
        const upper = line.toUpperCase();
        return (
          upper.includes("MAP") ||
          upper.includes("INIT") ||
          upper.includes("EXT-X-MAP")
        );
      });
      if (variantMapLines.length > 0) {
        console.log(
          `=== FOUND ${variantMapLines.length} MAP/INIT LINES IN VARIANT ===`,
        );
        variantMapLines.forEach((line, idx) => {
          console.log(`Variant MAP/INIT ${idx + 1}:`, line);
        });
      } else {
        console.warn("⚠️ No MAP/INIT lines found in variant playlist");
      }
      console.log("=== END VARIANT PLAYLIST CONTENT ===");

      const variantBaseUrl = variantUrl.substring(
        0,
        variantUrl.lastIndexOf("/") + 1,
      );
      const parsed = parseM3U8(variantText, variantBaseUrl);
      segments = parsed.segments;

      // Use init segment from variant if found, otherwise use from master (if any)
      if (parsed.initSegmentUrl) {
        initSegmentUrl = parsed.initSegmentUrl;
        console.log("Found init segment in variant playlist:", initSegmentUrl);
      } else if (!initSegmentUrl) {
        // No init segment in variant or master - try checking other variants
        console.warn(
          "No init segment found in selected variant, checking other variants...",
        );
        for (let i = 1; i < Math.min(variantPlaylists.length, 5); i++) {
          // Check up to 5 variants
          try {
            const otherVariantUrl = fixUrlEncoding(variantPlaylists[i].url);
            const otherFetchOptions = await getFetchOptionsWithHeaders(
              otherVariantUrl,
              tabId,
              abortController,
            );
            const otherResponse = await fetch(
              otherVariantUrl,
              otherFetchOptions,
            );
            if (otherResponse.ok) {
              const otherText = await otherResponse.text();
              const otherBaseUrl = otherVariantUrl.substring(
                0,
                otherVariantUrl.lastIndexOf("/") + 1,
              );
              const otherParsed = parseM3U8(otherText, otherBaseUrl);
              if (otherParsed.initSegmentUrl) {
                initSegmentUrl = otherParsed.initSegmentUrl;
                console.log(
                  `Found init segment in variant ${i + 1}:`,
                  initSegmentUrl,
                );
                break;
              }
            }
          } catch (err) {
            console.warn(
              `Failed to check variant ${i + 1} for init segment:`,
              err.message,
            );
            // Continue checking other variants
          }
        }
      }

      // Update playlistText for reference
      playlistText = variantText;
    } else {
      // Direct playlist with segments (not a master playlist)
      console.log("Direct media playlist detected (not a master playlist)");
      console.log(
        `Playlist length: ${playlistText.length} characters, ${playlistText.split("\n").length} lines`,
      );

      // Log first 50 lines of playlist to see structure
      const playlistLines = playlistText.split("\n");
      console.log("=== FIRST 50 LINES OF PLAYLIST ===");
      playlistLines.slice(0, 50).forEach((line, idx) => {
        console.log(`Line ${idx + 1}:`, line.substring(0, 200));
      });
      console.log("=== END OF FIRST 50 LINES ===");

      // Check for #EXT-X-MAP in the playlist text before parsing (case-insensitive)
      const upperPlaylist = playlistText.toUpperCase();
      const hasMapTag = upperPlaylist.includes("#EXT-X-MAP");
      console.log(
        `Checking for #EXT-X-MAP in playlist (case-insensitive): ${hasMapTag ? "FOUND" : "NOT FOUND"}`,
      );

      // Find ALL lines that might be related to init segment
      const allMapLines = playlistLines.filter((line) => {
        const upper = line.toUpperCase();
        return (
          upper.includes("MAP") ||
          upper.includes("INIT") ||
          upper.includes("EXT-X-MAP")
        );
      });

      if (allMapLines.length > 0) {
        console.log(
          `=== FOUND ${allMapLines.length} POTENTIAL MAP/INIT LINES ===`,
        );
        allMapLines.forEach((line, idx) => {
          console.log(`MAP/INIT line ${idx + 1}:`, line);
        });
        console.log("=== END OF MAP/INIT LINES ===");
      } else {
        console.warn(
          "⚠️ No lines containing MAP or INIT found in entire playlist",
        );
      }

      const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf("/") + 1);
      const parsed = parseM3U8(playlistText, baseUrl);
      segments = parsed.segments;
      initSegmentUrl = parsed.initSegmentUrl;

      if (initSegmentUrl) {
        console.log(
          "✅ Found init segment in direct playlist:",
          initSegmentUrl,
        );
      } else {
        console.warn(
          "⚠️ No init segment found in direct playlist despite parsing",
        );
        console.warn("Playlist URL was:", m3u8Url);
        console.warn("Base URL is:", baseUrl);
      }
    }

    if (segments.length === 0) {
      throw new Error("No segments found in playlist");
    }

    // Detect if this is MPEG-TS (Transport Stream) or fMP4 (Fragmented MP4)
    // MPEG-TS uses .ts segments and doesn't need an init segment
    // fMP4 uses .m4s or .mp4 segments and requires an init segment
    const isMPEGTS =
      segments.length > 0 &&
      segments.some((seg) => seg.includes(".ts") || seg.endsWith(".ts"));
    const isFMP4 =
      segments.length > 0 &&
      segments.some(
        (seg) =>
          seg.includes(".m4s") ||
          seg.includes("frag") ||
          seg.includes("segment"),
      );

    if (isMPEGTS) {
      console.log(
        "✅ Detected MPEG-TS playlist (.ts segments) - no init segment needed, segments can be concatenated directly",
      );
    } else if (isFMP4 || initSegmentUrl) {
      console.log(
        "✅ Detected fMP4 playlist - init segment required for QuickTime compatibility",
      );
    } else {
      console.log("⚠️ Unknown segment format - will attempt to merge segments");
    }

    console.log(
      `Found ${segments.length} segments${initSegmentUrl ? " and init segment" : ""}, downloading...`,
    );

    // Store segment count so background can block new downloads when any active has > 500 segments
    await chrome.storage.local.set({
      [`downloadSegments_${downloadId}`]: segments.length,
    });

    // Download init segment (map URL) if available
    // This is CRITICAL for fMP4 playback - contains container metadata (moov atom)
    // QuickTime REQUIRES the init segment with ftyp box for playback
    // NOTE: MPEG-TS (.ts) segments don't need an init segment - they can be concatenated directly
    let initSegmentData = null;

    if (initSegmentUrl) {
      // Fix init segment URL encoding
      initSegmentUrl = fixUrlEncoding(initSegmentUrl);
      console.log("Downloading init segment (map URL):", initSegmentUrl);

      // Retry init segment download (it's critical for QuickTime compatibility)
      const downloadInitSegmentWithRetry = async (retries = 3) => {
        for (let attempt = 0; attempt <= retries; attempt++) {
          // Check if cancelled
          if (abortController.signal.aborted) {
            throw new DOMException("Download cancelled", "AbortError");
          }

          try {
            const fetchOptions = await getFetchOptionsWithHeaders(
              initSegmentUrl,
              tabId,
              abortController,
            );
            const initResponse = await fetch(initSegmentUrl, fetchOptions);
            if (initResponse.ok) {
              const data = await initResponse.arrayBuffer();

              // Validate init segment has proper structure
              if (data.byteLength < 8) {
                throw new Error("Init segment is too small");
              }

              const view = new Uint8Array(data);
              const hasFtyp =
                view[4] === 0x66 &&
                view[5] === 0x74 &&
                view[6] === 0x79 &&
                view[7] === 0x70;

              if (!hasFtyp) {
                throw new Error("Init segment missing ftyp box");
              }

              console.log(
                `Init segment downloaded successfully: ${data.byteLength} bytes (attempt ${attempt + 1}/${retries + 1})`,
              );
              return data;
            } else {
              throw new Error(
                `HTTP ${initResponse.status}: ${initResponse.statusText}`,
              );
            }
          } catch (error) {
            // If cancelled, re-throw
            if (error.name === "AbortError" || abortController.signal.aborted) {
              throw error;
            }

            if (attempt === retries) {
              // Last attempt failed
              throw new Error(
                `Failed to download init segment after ${retries + 1} attempts: ${error.message}`,
              );
            }

            // Wait before retry (exponential backoff)
            const backoffTime = 1000 * (attempt + 1);
            console.warn(
              `Retrying init segment download, attempt ${attempt + 2}/${retries + 1}...`,
            );
            await new Promise((resolve) => setTimeout(resolve, backoffTime));
          }
        }
      };

      try {
        initSegmentData = await downloadInitSegmentWithRetry();
        console.log(
          "✅ Init segment downloaded and validated - QuickTime compatible",
        );
      } catch (initError) {
        // If cancelled, re-throw to stop the download
        if (initError.name === "AbortError" || abortController.signal.aborted) {
          throw initError;
        }
        // Init segment download failed - we'll try workaround with first segment later
        console.warn(
          `Failed to download init segment: ${initError.message}. Will attempt workaround with first segment.`,
        );
        initSegmentData = null; // Mark as missing, we'll try workaround
      }
    } else {
      // No init segment URL in playlist
      if (isMPEGTS) {
        // MPEG-TS doesn't need an init segment - this is normal
        console.log(
          "✅ MPEG-TS playlist - no init segment needed, segments will be concatenated directly",
        );
        initSegmentData = null;
      } else {
        // For fMP4, we need to try workaround with first segment
        console.warn(
          "No init segment (map URL) found in playlist. Will attempt workaround with first segment.",
        );
        initSegmentData = null;
      }
    }

    // Note: For fMP4, we need to handle segments carefully
    // If no init segment, the first segment might contain it
    // For now, we'll concatenate all segments and hope they're in a compatible format

    // Download and merge segments in batches to reduce memory usage
    // Process segments in batches of 10 to avoid loading everything into memory
    // For very large videos (800+ segments), use smaller batches to avoid rate limiting
    const batchSize = segments.length > 800 ? 5 : 10;
    const segmentBlobs = []; // Store blobs instead of ArrayBuffers (more memory efficient)
    const segmentData = []; // Store segment data with index for proper ordering
    const failedSegments = []; // Track failed segments for retry

    console.log(
      `Downloading ${segments.length} segments in batches of ${batchSize}...`,
    );

    // Retry function for failed segment downloads (increased retries to 4 = 5 total attempts)
    const downloadSegmentWithRetry = async (
      segmentUrl,
      segmentIndex,
      retries = 4,
    ) => {
      // Fix segment URL encoding
      const fixedSegmentUrl = fixUrlEncoding(segmentUrl);

      for (let attempt = 0; attempt <= retries; attempt++) {
        // Check if cancelled before each attempt
        if (
          abortController.signal.aborted ||
          (await isDownloadCancelled(downloadId))
        ) {
          throw new DOMException("Download cancelled", "AbortError");
        }

        try {
          const fetchOptions = await getFetchOptionsWithHeaders(
            fixedSegmentUrl,
            tabId,
            abortController,
          );
          const response = await fetch(fixedSegmentUrl, fetchOptions);
          if (!response.ok) {
            // Extract status code for better error handling
            const statusCode = response.status;
            const statusText = response.statusText || "";
            throw new Error(`HTTP ${statusCode}: ${statusText}`);
          }
          const arrayBuffer = await response.arrayBuffer();
          return { success: true, data: arrayBuffer, index: segmentIndex };
        } catch (error) {
          // If cancelled, don't retry - throw immediately
          if (
            error.name === "AbortError" ||
            abortController.signal.aborted ||
            (await isDownloadCancelled(downloadId))
          ) {
            throw new DOMException("Download cancelled", "AbortError");
          }

          if (attempt === retries) {
            // Last attempt failed - return failure info instead of throwing
            const errorMessage =
              error.message || error.toString() || "Unknown error";
            // Only log error if it's not a 503 (server overload - expected sometimes)
            const errorMsg = error.message || "";
            if (!errorMsg.includes("503")) {
              console.error(
                `Failed to download segment ${segmentIndex + 1} after ${retries + 1} attempts:`,
                errorMessage,
              );
            } else {
              console.warn(
                `Segment ${segmentIndex + 1} failed with 503 (server overload) after ${retries + 1} attempts - will retry later`,
              );
            }
            return {
              success: false,
              index: segmentIndex,
              url: segmentUrl,
              error: errorMessage,
            };
          }

          // Determine backoff time based on error type
          let backoffTime;
          const errorMsg = error.message || "";

          // HTTP 503 (Service Unavailable) or 429 (Too Many Requests) - use longer backoff
          if (errorMsg.includes("503") || errorMsg.includes("429")) {
            // Longer backoff for rate limiting: 2s, 4s, 8s, 16s
            backoffTime = 2000 * Math.pow(2, attempt) + Math.random() * 1000;
            console.warn(
              `Rate limited (503/429) for segment ${segmentIndex + 1}, waiting ${Math.round(backoffTime / 1000)}s before retry ${attempt + 2}/${retries + 1}...`,
            );
          } else if (
            errorMsg.includes("500") ||
            errorMsg.includes("502") ||
            errorMsg.includes("504")
          ) {
            // Server errors - moderate backoff: 1.5s, 3s, 6s, 12s
            backoffTime = 1500 * Math.pow(2, attempt) + Math.random() * 500;
            console.warn(
              `Server error for segment ${segmentIndex + 1}, waiting ${Math.round(backoffTime / 1000)}s before retry ${attempt + 2}/${retries + 1}...`,
            );
          } else {
            // Other errors - standard exponential backoff with jitter
            backoffTime = 1000 * (attempt + 1) + Math.random() * 500;
            console.warn(
              `Retrying segment ${segmentIndex + 1}, attempt ${attempt + 2}/${retries + 1}...`,
            );
          }

          // Wait with cancellation checks during backoff
          const backoffStart = Date.now();
          while (Date.now() - backoffStart < backoffTime) {
            if (
              abortController.signal.aborted ||
              (await isDownloadCancelled(downloadId))
            ) {
              throw new DOMException("Download cancelled", "AbortError");
            }
            await new Promise((resolve) => setTimeout(resolve, 100)); // Check every 100ms
          }
        }
      }
    };

    // Download all segments in batches
    for (
      let batchStart = 0;
      batchStart < segments.length;
      batchStart += batchSize
    ) {
      // Calculate batch info first
      const batchEnd = Math.min(batchStart + batchSize, segments.length);
      const batchNumber = Math.floor(batchStart / batchSize) + 1;
      const totalBatches = Math.ceil(segments.length / batchSize);

      // Check if cancelled before each batch
      if (
        abortController.signal.aborted ||
        (await isDownloadCancelled(downloadId))
      ) {
        throw new DOMException("Download cancelled", "AbortError");
      }

      console.log(
        `Processing batch ${batchNumber}/${totalBatches} (segments ${batchStart + 1}-${batchEnd})...`,
      );

      await chrome.storage.local.set({
        [`downloadProgress_${downloadId}`]: Math.round(
          (batchStart / segments.length) * 85,
        ), // Up to 85% for initial downloading
        [`downloadStatus_${downloadId}`]: `Downloading batch ${batchNumber}/${totalBatches} (${batchStart + 1}-${batchEnd}/${segments.length})`,
      });

      // Download segments in this batch - use allSettled to continue even if some fail
      const batchPromises = [];
      for (let i = batchStart; i < batchEnd; i++) {
        const segmentUrl = segments[i];
        const segmentIndex = i;
        batchPromises.push(downloadSegmentWithRetry(segmentUrl, segmentIndex));
      }

      // Wait for batch with periodic cancellation checks (every 50ms)
      let checkInterval;
      const batchResults = await new Promise(async (resolve, reject) => {
        let cancelled = false;

        // Monitor for cancellation while batch is downloading
        checkInterval = setInterval(() => {
          if (abortController.signal.aborted) {
            cancelled = true;
            clearInterval(checkInterval);
            reject(new DOMException("Download cancelled", "AbortError"));
            return;
          }

          isDownloadCancelled(downloadId)
            .then((isCancelled) => {
              if (isCancelled && !cancelled) {
                cancelled = true;
                clearInterval(checkInterval);
                if (!abortController.signal.aborted) {
                  abortController.abort();
                }
                reject(new DOMException("Download cancelled", "AbortError"));
              }
            })
            .catch(() => {});
        }, 50);

        try {
          const results = await Promise.allSettled(batchPromises);
          clearInterval(checkInterval);

          if (
            !cancelled &&
            (abortController.signal.aborted ||
              (await isDownloadCancelled(downloadId)))
          ) {
            reject(new DOMException("Download cancelled", "AbortError"));
          } else if (!cancelled) {
            resolve(results);
          }
        } catch (error) {
          clearInterval(checkInterval);
          if (
            error.name === "AbortError" ||
            error.message === "Download cancelled"
          ) {
            reject(error);
          } else if (
            abortController.signal.aborted ||
            (await isDownloadCancelled(downloadId))
          ) {
            reject(new DOMException("Download cancelled", "AbortError"));
          } else {
            reject(error);
          }
        }
      }).catch((error) => {
        if (checkInterval) clearInterval(checkInterval);
        throw error;
      });

      // Process results - collect successful segments and track failures
      const batchSegmentData = [];
      for (let i = 0; i < batchResults.length; i++) {
        const result = batchResults[i];
        if (result.status === "fulfilled" && result.value.success) {
          batchSegmentData.push(result.value);
        } else {
          // Segment failed - add to failed list for retry
          const segmentIndex = batchStart + i;
          const segmentUrl = segments[segmentIndex];
          const errorInfo =
            result.status === "fulfilled"
              ? result.value
              : {
                  index: segmentIndex,
                  url: segmentUrl,
                  error: result.reason?.message || "Unknown error",
                };
          failedSegments.push(errorInfo);
          const failedSegmentNum =
            errorInfo.index !== undefined
              ? errorInfo.index + 1
              : segmentIndex + 1;
          console.warn(
            `Segment ${failedSegmentNum} failed in batch ${batchNumber}, will retry later`,
          );
        }
      }

      // Sort by index to maintain order
      batchSegmentData.sort((a, b) => a.index - b.index);

      // Store successful segments
      segmentData.push(...batchSegmentData);

      // Check if cancelled after batch download
      if (
        abortController.signal.aborted ||
        (await isDownloadCancelled(downloadId))
      ) {
        throw new DOMException("Download cancelled", "AbortError");
      }

      // Add a small delay between batches to avoid rate limiting
      // Longer delay for large videos to be more respectful to the server
      const batchDelay = segments.length > 500 ? 200 : 100;
      await new Promise((resolve) => setTimeout(resolve, batchDelay));
    }

    // Retry failed segments with more attempts
    if (failedSegments.length > 0) {
      // Check if cancelled before retrying
      if (
        abortController.signal.aborted ||
        (await isDownloadCancelled(downloadId))
      ) {
        throw new DOMException("Download cancelled", "AbortError");
      }

      console.log(
        `Retrying ${failedSegments.length} failed segments with extended retries...`,
      );
      await chrome.storage.local.set({
        [`downloadProgress_${downloadId}`]: 85,
        [`downloadStatus_${downloadId}`]: `Retrying ${failedSegments.length} failed segments...`,
      });

      // Retry failed segments with more attempts and longer delays
      const retryPromises = failedSegments.map(async (failed, idx) => {
        // Check if cancelled before each retry
        if (
          abortController.signal.aborted ||
          (await isDownloadCancelled(downloadId))
        ) {
          throw new DOMException("Download cancelled", "AbortError");
        }

        // Stagger retries slightly to avoid hammering the server
        if (idx > 0) {
          await new Promise((resolve) => setTimeout(resolve, idx * 200)); // Increased stagger delay
        }
        return downloadSegmentWithRetry(failed.url, failed.index, 6); // 7 total attempts for retries
      });

      const retryResults = await Promise.allSettled(retryPromises);

      // Check cancellation after retries complete
      if (
        abortController.signal.aborted ||
        (await isDownloadCancelled(downloadId))
      ) {
        throw new DOMException("Download cancelled", "AbortError");
      }

      // Process retry results
      let recoveredCount = 0;
      for (let i = 0; i < retryResults.length; i++) {
        const result = retryResults[i];
        if (result.status === "fulfilled" && result.value.success) {
          segmentData.push(result.value);
          recoveredCount++;
          console.log(
            `Successfully recovered segment ${result.value.index + 1}`,
          );
        } else {
          const failed = failedSegments[i];
          // Only log as error if it's not a 503 (server overload is expected sometimes)
          const is503 = failed.error && failed.error.includes("503");
          if (is503) {
            console.warn(
              `Segment ${failed.index + 1} failed with 503 (server overload) after all retries - will be skipped`,
            );
          } else {
            console.error(
              `Segment ${failed.index + 1} still failed after all retries:`,
              failed.error,
            );
          }
        }
      }

      console.log(
        `Recovered ${recoveredCount}/${failedSegments.length} failed segments`,
      );

      // Sort all segments by index
      segmentData.sort((a, b) => a.index - b.index);

      // After retries, check again if we meet the quality threshold
      const finalSuccessRate = segmentData.length / segments.length;
      if (finalSuccessRate < 0.98) {
        const errorMsg = `After retries, only ${segmentData.length}/${segments.length} segments downloaded (${(finalSuccessRate * 100).toFixed(1)}%). Video file would be corrupted and unplayable. Please try again or use MP4 format.`;
        console.error(errorMsg);
        await chrome.storage.local.set({
          [`downloadProgress_${downloadId}`]: 0,
          [`downloadStatus_${downloadId}`]: errorMsg,
        });
        throw new Error(errorMsg);
      }
    }

    // Check if we have enough segments to proceed
    if (segmentData.length === 0) {
      throw new Error(
        "All segments failed to download. Please check your internet connection and try again.",
      );
    }

    // Sort segments by index to ensure correct order
    segmentData.sort((a, b) => a.index - b.index);

    // Check for missing segments and gaps
    const downloadedIndices = new Set(segmentData.map((s) => s.index));
    const missingIndices = [];
    for (let i = 0; i < segments.length; i++) {
      if (!downloadedIndices.has(i)) {
        missingIndices.push(i);
      }
    }

    const successRate = segmentData.length / segments.length;
    console.log(
      `Downloaded ${segmentData.length}/${segments.length} segments (${(successRate * 100).toFixed(1)}%)`,
    );

    if (missingIndices.length > 0) {
      console.warn(
        `Missing ${missingIndices.length} segments:`,
        missingIndices.slice(0, 20).join(", ") +
          (missingIndices.length > 20 ? "..." : ""),
      );
    }

    // CRITICAL: Require at least 98% of segments for a playable video
    // Lower success rates result in unplayable files, especially with fMP4
    if (successRate < 0.98) {
      const errorMsg = `Too many segments failed (only ${segmentData.length}/${segments.length} downloaded, ${(successRate * 100).toFixed(1)}%). Video file would be corrupted and unplayable. Please try again or use MP4 format if available.`;
      console.error(errorMsg);
      await chrome.storage.local.set({
        [`downloadProgress_${downloadId}`]: 0,
        [`downloadStatus_${downloadId}`]: errorMsg,
      });
      throw new Error(errorMsg);
    }

    // Check for critical missing segments at the beginning (first 10 segments are critical)
    const criticalMissing = missingIndices.filter((idx) => idx < 10);
    if (criticalMissing.length > 0) {
      const errorMsg = `Critical segments missing at the beginning (segments: ${criticalMissing.join(", ")}). Video cannot be played without these segments. Please try again.`;
      console.error(errorMsg);
      await chrome.storage.local.set({
        [`downloadProgress_${downloadId}`]: 0,
        [`downloadStatus_${downloadId}`]: errorMsg,
      });
      throw new Error(errorMsg);
    }

    // Check for large gaps (more than 3 consecutive missing segments)
    // Large gaps break fMP4 playback
    let consecutiveMissing = 0;
    let maxConsecutiveMissing = 0;
    for (let i = 0; i < segments.length; i++) {
      if (!downloadedIndices.has(i)) {
        consecutiveMissing++;
        maxConsecutiveMissing = Math.max(
          maxConsecutiveMissing,
          consecutiveMissing,
        );
      } else {
        consecutiveMissing = 0;
      }
    }

    if (maxConsecutiveMissing > 3) {
      const errorMsg = `Large gap detected (${maxConsecutiveMissing} consecutive segments missing). Video file would be corrupted and unplayable. Please try again.`;
      console.error(errorMsg);
      await chrome.storage.local.set({
        [`downloadProgress_${downloadId}`]: 0,
        [`downloadStatus_${downloadId}`]: errorMsg,
      });
      throw new Error(errorMsg);
    }

    // Warn if some segments are missing but proceed (only if we passed all checks)
    if (missingIndices.length > 0 && successRate >= 0.98) {
      const warningMsg = `Warning: ${missingIndices.length} segments missing (${segmentData.length}/${segments.length} downloaded). Video should play but may have minor glitches.`;
      console.warn(warningMsg);
      await chrome.storage.local.set({
        [`downloadStatus_${downloadId}`]: warningMsg,
      });
    }

    // Ensure segments are in consecutive order
    // For fMP4, missing segments can break playback, so we need to be careful
    const orderedSegments = [];
    let lastIndex = -1;

    for (const segment of segmentData) {
      // Check for gaps
      if (segment.index > lastIndex + 1) {
        const gapSize = segment.index - lastIndex - 1;
        console.warn(
          `Gap detected: missing ${gapSize} segment(s) between index ${lastIndex} and ${segment.index}`,
        );
        // If we have gaps, the file might not play - but we've already validated above
      }
      orderedSegments.push(segment);
      lastIndex = segment.index;
    }

    // Validate that we have the first segment (critical for playback)
    if (orderedSegments.length === 0 || orderedSegments[0].index !== 0) {
      throw new Error(
        "First segment is missing. Video cannot be played without the initial segment.",
      );
    }

    // Validate that we have at least the first 5 segments consecutively
    for (let i = 0; i < Math.min(5, segments.length); i++) {
      if (!downloadedIndices.has(i)) {
        throw new Error(
          `Critical segment ${i + 1} is missing. Video cannot be played without the initial segments.`,
        );
      }
    }

    // Create blobs from successful segments in order
    console.log(
      `Creating blobs from ${orderedSegments.length} segments in correct order...`,
    );
    const segmentBuffers = orderedSegments.map((s) => s.data);

    // Validate segment sizes (empty segments indicate problems, but allow empty first segment if used as init)
    for (let i = 0; i < segmentBuffers.length; i++) {
      if (segmentBuffers[i].byteLength === 0) {
        // Allow empty first segment if it was used as init (will be handled in workaround)
        if (i === 0) {
          console.warn(
            "⚠️ First segment is empty (may have been used as init data)",
          );
          continue;
        }
        console.error(`Segment ${orderedSegments[i].index + 1} is empty!`);
        throw new Error(
          `Segment ${orderedSegments[i].index + 1} is empty. Video file would be corrupted.`,
        );
      }
    }

    // Create blobs in batches to avoid memory issues
    // Filter out empty segments (e.g., first segment if used as init)
    const validSegmentBuffers = segmentBuffers.filter(
      (buf) => buf.byteLength > 0,
    );
    const blobBatchSize = 50;
    // Use appropriate MIME type based on format
    const segmentMimeType = isMPEGTS ? "video/mp2t" : "video/mp4";
    for (let i = 0; i < validSegmentBuffers.length; i += blobBatchSize) {
      const batch = validSegmentBuffers.slice(
        i,
        Math.min(i + blobBatchSize, validSegmentBuffers.length),
      );
      const batchBlob = new Blob(batch, { type: segmentMimeType });
      segmentBlobs.push(batchBlob);
    }

    console.log("Merging segment batches...");
    await chrome.storage.local.set({
      [`downloadProgress_${downloadId}`]: 95,
      [`downloadStatus_${downloadId}`]: "Merging segments...",
    });

    // For fMP4 segments, we need to handle them properly
    // The issue is that fMP4 segments can't be simply concatenated - they need proper MP4 muxing
    // However, Dailymotion's segments might work if we include the init segment

    const finalBlobs = [];

    // Init segment is CRITICAL for fMP4 playback - it contains the moov atom with metadata
    // QuickTime REQUIRES a valid MP4 structure starting with ftyp box
    let useFirstSegmentAsInit = false;

    if (!initSegmentData && !isMPEGTS) {
      // WORKAROUND: Try to use first segment if it contains ftyp box
      // Skip this for MPEG-TS - it doesn't need an init segment
      console.warn(
        "⚠️ No init segment found in playlist - attempting workaround with first segment...",
      );

      if (segmentBuffers.length > 0 && segmentBuffers[0]) {
        const firstSegment = segmentBuffers[0];
        if (firstSegment.byteLength >= 8) {
          const firstView = new Uint8Array(firstSegment);
          const firstHasFtyp =
            firstView[4] === 0x66 &&
            firstView[5] === 0x74 &&
            firstView[6] === 0x79 &&
            firstView[7] === 0x70;

          if (firstHasFtyp) {
            console.log(
              "✅ First segment contains ftyp box - extracting init data (workaround)",
            );

            // Find moov atom in first segment (contains metadata)
            // moov atom signature: 0x6D6F6F76 = "moov"
            let moovStart = -1;
            let moovEnd = -1;
            const searchLimit = Math.min(firstSegment.byteLength, 500 * 1024); // Search first 500KB

            for (let i = 8; i < searchLimit - 8; i++) {
              if (
                firstView[i] === 0x6d &&
                firstView[i + 1] === 0x6f &&
                firstView[i + 2] === 0x6f &&
                firstView[i + 3] === 0x76
              ) {
                // Found moov, get its size (4 bytes before)
                if (i >= 4) {
                  const moovSizeBytes = new Uint8Array(
                    firstSegment.slice(i - 4, i),
                  );
                  const moovSize =
                    (moovSizeBytes[0] << 24) |
                    (moovSizeBytes[1] << 16) |
                    (moovSizeBytes[2] << 8) |
                    moovSizeBytes[3];
                  moovStart = i - 4;
                  moovEnd = moovStart + moovSize;
                  console.log(
                    `Found moov atom at offset ${moovStart}, size: ${moovSize} bytes`,
                  );
                  break;
                }
              }
            }

            if (moovStart !== -1 && moovEnd <= firstSegment.byteLength) {
              // Extract ftyp + moov (everything up to and including moov)
              initSegmentData = firstSegment.slice(0, moovEnd);
              useFirstSegmentAsInit = true;
              console.log(
                `Extracted init data: ${moovEnd} bytes (ftyp + moov)`,
              );

              // Remove the init portion from first segment to avoid duplication
              if (moovEnd < firstSegment.byteLength) {
                segmentBuffers[0] = firstSegment.slice(moovEnd);

                // Recreate segmentBlobs since we modified segmentBuffers
                segmentBlobs.length = 0;
                for (let i = 0; i < segmentBuffers.length; i += blobBatchSize) {
                  const batch = segmentBuffers.slice(
                    i,
                    Math.min(i + blobBatchSize, segmentBuffers.length),
                  );
                  const batchBlob = new Blob(batch, { type: "video/mp4" });
                  segmentBlobs.push(batchBlob);
                }
              } else {
                // Init data is entire first segment - create empty buffer for first segment
                // This keeps the segment count correct
                segmentBuffers[0] = new ArrayBuffer(0);
                console.warn(
                  "⚠️ First segment was entirely init data - segment will be empty but count preserved",
                );

                // Recreate blobs
                segmentBlobs.length = 0;
                for (let i = 0; i < segmentBuffers.length; i += blobBatchSize) {
                  const batch = segmentBuffers.slice(
                    i,
                    Math.min(i + blobBatchSize, segmentBuffers.length),
                  );
                  const batchBlob = new Blob(batch, { type: "video/mp4" });
                  segmentBlobs.push(batchBlob);
                }
              }
            } else {
              // Moov not found, use first 200KB as fallback (should contain ftyp + moov)
              console.warn(
                "⚠️ Could not find moov atom, using first 200KB as init data",
              );
              const initSize = Math.min(200 * 1024, firstSegment.byteLength);
              initSegmentData = firstSegment.slice(0, initSize);
              useFirstSegmentAsInit = true;

              if (initSize < firstSegment.byteLength) {
                segmentBuffers[0] = firstSegment.slice(initSize);
                // Recreate blobs
                segmentBlobs.length = 0;
                for (let i = 0; i < segmentBuffers.length; i += blobBatchSize) {
                  const batch = segmentBuffers.slice(
                    i,
                    Math.min(i + blobBatchSize, segmentBuffers.length),
                  );
                  const batchBlob = new Blob(batch, { type: "video/mp4" });
                  segmentBlobs.push(batchBlob);
                }
              } else {
                // Init data is entire first segment - create empty buffer
                segmentBuffers[0] = new ArrayBuffer(0);
                console.warn(
                  "⚠️ First segment was entirely init data - segment will be empty but count preserved",
                );

                // Recreate blobs
                segmentBlobs.length = 0;
                for (let i = 0; i < segmentBuffers.length; i += blobBatchSize) {
                  const batch = segmentBuffers.slice(
                    i,
                    Math.min(i + blobBatchSize, segmentBuffers.length),
                  );
                  const batchBlob = new Blob(batch, { type: "video/mp4" });
                  segmentBlobs.push(batchBlob);
                }
              }
            }
          } else {
            // No ftyp in first segment - warn but allow download to proceed (might work in VLC)
            console.warn(
              "⚠️ First segment does not contain ftyp box - file may not play in QuickTime Player but should work in VLC",
            );
            await chrome.storage.local.set({
              [`downloadStatus_${downloadId}`]:
                "Warning: No init segment found. File may not play in QuickTime Player but should work in VLC.",
            });
            // Continue without init segment - some players can handle it
          }
        } else {
          // First segment too small - warn but proceed
          console.warn(
            "⚠️ First segment is too small - file may not play in QuickTime Player but should work in VLC",
          );
          await chrome.storage.local.set({
            [`downloadStatus_${downloadId}`]:
              "Warning: No init segment found. File may not play in QuickTime Player but should work in VLC.",
          });
        }
      } else {
        // No segments available - this is a real problem
        const errorMsg = "No segments available. Cannot create video file.";
        console.error(errorMsg);
        await chrome.storage.local.set({
          [`downloadProgress_${downloadId}`]: 0,
          [`downloadStatus_${downloadId}`]: errorMsg,
        });
        throw new Error(errorMsg);
      }
    }

    // Add init segment if available (either from playlist or extracted from first segment)
    // Skip for MPEG-TS - it doesn't need an init segment
    if (initSegmentData && !isMPEGTS) {
      console.log("Prepending init segment to merged file...");
      // Validate init segment is not empty
      if (initSegmentData.byteLength === 0) {
        throw new Error(
          "Init segment is empty. Video cannot be played without initialization data.",
        );
      }

      // Validate init segment has proper MP4 structure
      const initView = new Uint8Array(initSegmentData);
      if (initView.length < 8) {
        throw new Error(
          "Init segment is too small. Video cannot be played without proper initialization data.",
        );
      }

      // Check if init segment starts with ftyp box (required for QuickTime)
      // MP4 file structure: [4 bytes size][4 bytes type] where type should be "ftyp" at offset 4
      // ftyp box: 0x66747970 = "ftyp"
      const initHasFtyp =
        initView.length >= 8 &&
        initView[4] === 0x66 &&
        initView[5] === 0x74 &&
        initView[6] === 0x79 &&
        initView[7] === 0x70;

      if (!initHasFtyp) {
        // Warn but don't fail - file might still work in VLC
        console.warn(
          "⚠️ Init segment does not have valid ftyp box - file may not play in QuickTime Player",
        );
        await chrome.storage.local.set({
          [`downloadStatus_${downloadId}`]:
            "Warning: Init segment structure may be invalid. File may not play in QuickTime Player but should work in VLC.",
        });
      } else {
        if (useFirstSegmentAsInit) {
          console.log(
            "✅ Using first segment as init (workaround) - QuickTime compatible",
          );
        } else {
          console.log(
            "✅ Init segment has valid ftyp box - QuickTime compatible",
          );
        }
      }
      finalBlobs.push(new Blob([initSegmentData], { type: "video/mp4" }));
    } else if (!isMPEGTS) {
      // No init segment at all - warn but proceed (might work in VLC)
      // Skip warning for MPEG-TS - it doesn't need an init segment
      console.warn(
        "⚠️ No init segment available - file may not play in QuickTime Player",
      );
      await chrome.storage.local.set({
        [`downloadStatus_${downloadId}`]:
          "Warning: No init segment found. File may not play in QuickTime Player but should work in VLC.",
      });
    } else {
      // MPEG-TS - no init segment needed, this is normal
      console.log(
        "✅ MPEG-TS format - no init segment needed, concatenating segments directly",
      );
    }

    // Add all segment blobs in order (filter out any empty blobs from workaround)
    // Note: For fMP4, each segment is a complete fragment (moof + mdat)
    // Concatenating them should work for some players, but may not be fully compatible
    // Missing segments can cause playback issues, so we've already validated above
    const validSegmentBlobs = segmentBlobs.filter((blob) => blob.size > 0);
    finalBlobs.push(...validSegmentBlobs);

    // Check if cancelled before merging
    if (
      abortController.signal.aborted ||
      (await isDownloadCancelled(downloadId))
    ) {
      throw new DOMException("Download cancelled", "AbortError");
    }

    const totalSizeFromBlobs = finalBlobs.reduce((s, b) => s + b.size, 0);
    const LARGE_FILE_THRESHOLD = 1 * 1024 * 1024 * 1024; // 1GB
    const isLargeFile = totalSizeFromBlobs > LARGE_FILE_THRESHOLD;

    let validatedBlob = null;
    let skippedMergeForLargeFile = false;
    let inputBlobIdForConvert = null;
    let chunksOnlyForDownload = null;
    let finalFilename = filename || "dailymotion_video.mp4";

    if (isLargeFile) {
      // Keep offscreen document (and its keep-alive port) open so the SW is not suspended during the long IDB write loop.
      await setupOffscreenDocument();
      // Avoid creating one 2GB+ merged blob — write segment blobs directly to IDB (each ~40MB read).
      if (finalFilename.includes(".m3u8")) {
        finalFilename = isMPEGTS ? finalFilename.replace(/\.m3u8$/i, ".ts") : finalFilename.replace(/\.m3u8$/i, ".mp4");
        finalFilename = finalFilename.replace(/\.m3u8\./i, isMPEGTS ? ".ts." : ".mp4.");
      } else if (!finalFilename.match(/\.(mp4|ts|mpegts|mkv|webm)$/i)) {
        finalFilename = finalFilename.replace(/\.[^.]*$/, "") + (isMPEGTS ? ".ts" : ".mp4");
      }
      console.log(
        `Final filename: ${finalFilename} (format: ${isMPEGTS ? "MPEG-TS" : "fMP4"}) — large file (${Math.round(totalSizeFromBlobs / 1024 / 1024)}MB), writing segment batches to IDB directly`,
      );
      const header = new Uint8Array(await finalBlobs[0].slice(0, 8).arrayBuffer());
      if (isMPEGTS && header[0] === 0x47) {
        console.log("✅ MPEG-TS structure (sync byte 0x47) — should play in VLC and most players");
      } else if (!isMPEGTS) {
        const hasFtyp = header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70;
        if (!hasFtyp) throw new Error("Merged file does not have valid MP4 structure (missing ftyp box).");
      }
      inputBlobIdForConvert = `convert_input_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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
      for (let i = 0; i < finalBlobs.length; i++) {
        const buf = await finalBlobs[i].arrayBuffer();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(["blobs"], "readwrite");
          tx.objectStore("blobs").put(buf, `${inputBlobIdForConvert}_chunk_${i}`);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        if (i % 15 === 0 && finalBlobs.length > 15) {
          await chrome.storage.local.set({
            [`downloadStatus_${downloadId}`]: `Storing for conversion (batch ${i + 1}/${finalBlobs.length})...`,
          });
          // Ping offscreen to keep SW alive during long loop (avoids suspension at ~batch 30+)
          try {
            await new Promise((resolve) => {
              chrome.runtime.sendMessage({ action: "ping" }, () => resolve());
            });
          } catch (e) {}
        }
      }
      db.close();
      chunksOnlyForDownload = {
        blobId: inputBlobIdForConvert,
        chunkCount: finalBlobs.length,
        totalSize: totalSizeFromBlobs,
      };
      segmentData.length = 0;
      if (orderedSegments && orderedSegments.length) orderedSegments.length = 0;
      if (segmentBuffers && segmentBuffers.length) segmentBuffers.length = 0;
      segmentBlobs.length = 0;
      finalBlobs.length = 0;
      skippedMergeForLargeFile = true;
      // finalFilename is set above; we'll reuse it after the else block (see below)
    }

    if (!isLargeFile) {
    // Create final blob from all blobs
    // Use appropriate MIME type: MPEG-TS uses 'video/mp2t', fMP4 uses 'video/mp4'
    const finalMimeType = isMPEGTS ? "video/mp2t" : "video/mp4";
    let mergedBlob = new Blob(finalBlobs, { type: finalMimeType });

    // Free segment/final arrays BEFORE mergedBlob.arrayBuffer() to avoid NotReadableError on large files.
    // We only need mergedBlob from here; the next line reads it and needs memory headroom.
    segmentData.length = 0;
    if (orderedSegments && orderedSegments.length) orderedSegments.length = 0;
    if (segmentBuffers && segmentBuffers.length) segmentBuffers.length = 0;
    segmentBlobs.length = 0;
    finalBlobs.length = 0;

    // Update filename extension based on format
    finalFilename = filename || "dailymotion_video.mp4";
    if (finalFilename.includes(".m3u8")) {
      // Replace .m3u8 with appropriate extension
      if (isMPEGTS) {
        finalFilename = finalFilename.replace(/\.m3u8$/i, ".ts");
        // Also replace if extension is in the middle of filename
        finalFilename = finalFilename.replace(/\.m3u8\./i, ".ts.");
      } else {
        finalFilename = finalFilename.replace(/\.m3u8$/i, ".mp4");
        // Also replace if extension is in the middle of filename
        finalFilename = finalFilename.replace(/\.m3u8\./i, ".mp4.");
      }
    } else if (!finalFilename.match(/\.(mp4|ts|mpegts|mkv|webm)$/i)) {
      // If no video extension, add one based on format
      if (isMPEGTS) {
        finalFilename = finalFilename.replace(/\.[^.]*$/, "") + ".ts";
      } else {
        finalFilename = finalFilename.replace(/\.[^.]*$/, "") + ".mp4";
      }
    }

    console.log(
      `Final filename: ${finalFilename} (format: ${isMPEGTS ? "MPEG-TS" : "fMP4"})`,
    );

    // Validate final blob size
    if (mergedBlob.size === 0) {
      throw new Error("Merged video file is empty. Download failed.");
    }
    if (mergedBlob.size < 8) {
      throw new Error("Merged video file is too small. Download failed.");
    }

    // Validate file structure by reading ONLY the first 8 bytes (avoids NotReadableError on large files).
    // Full mergedBlob.arrayBuffer() would duplicate the entire video in memory and hit limits.
    const header = new Uint8Array(await mergedBlob.slice(0, 8).arrayBuffer());
    validatedBlob = mergedBlob;

    if (isMPEGTS) {
      // MPEG-TS validation: Check for sync byte (0x47) at the start
      const hasSyncByte = header[0] === 0x47;
      if (hasSyncByte) {
        console.log(
          "✅ Merged file has valid MPEG-TS structure (sync byte 0x47 found) - should play in VLC and most players",
        );
      } else {
        console.warn(
          "⚠️ MPEG-TS file does not start with sync byte 0x47 - may still play but structure might be invalid",
        );
      }
      // Use mergedBlob as-is; no need to recreate from full array
    } else {
      // fMP4 validation: Check if file starts with proper MP4 structure (ftyp at offset 4)
      const mergedHasFtyp =
        header[4] === 0x66 &&
        header[5] === 0x74 &&
        header[6] === 0x79 &&
        header[7] === 0x70;

      if (!mergedHasFtyp) {
        const errorMsg =
          "Merged file does not have valid MP4 structure (missing ftyp box). File will not play in QuickTime Player.";
        console.error(errorMsg);
        await chrome.storage.local.set({
          [`downloadProgress_${downloadId}`]: 0,
          [`downloadStatus_${downloadId}`]: errorMsg,
        });
        throw new Error(errorMsg);
      }

      console.log(
        "✅ Merged file has valid MP4 structure - should play in QuickTime and VLC",
      );
      // Use mergedBlob as-is; no need to recreate from full array
    }
    } // end if (!isLargeFile)

    const sizeMB = Math.round((validatedBlob ? validatedBlob.size : totalSizeFromBlobs) / (1024 * 1024));
    console.log(`Total merged size: ${sizeMB}MB`);

    // Warn about potential playback issues
    if (missingIndices.length > 0) {
      console.warn(
        `⚠️ HLS segments merged with ${missingIndices.length} missing segments - file may have playback issues. Prefer MP4 downloads when available.`,
      );
    } else {
      console.log(
        "✅ All segments downloaded successfully - video should play correctly in QuickTime and VLC",
      );
    }

    // Free merge-phase memory before conversion/download
    segmentData.length = 0;
    if (orderedSegments && orderedSegments.length) orderedSegments.length = 0;
    if (segmentBuffers && segmentBuffers.length) segmentBuffers.length = 0;
    segmentBlobs.length = 0;
    finalBlobs.length = 0;

    const mp4Filename = finalFilename.replace(/\.(ts|mpegts|mkv|webm)$/i, ".mp4");
    const alreadyMp4 = /\.mp4$/i.test(finalFilename);
    let converted = false;
    let storedInputInIDB = false;

    // Skip conversion when merged output is already MP4 (fMP4) — avoids loading helper iframe and potential hang
    if (!alreadyMp4) try {
      await chrome.storage.local.set({
        [`downloadStatus_${downloadId}`]: "Converting to MP4...",
      });
      if (!skippedMergeForLargeFile) {
        inputBlobIdForConvert = `convert_input_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      }
      await setupOffscreenDocument();

      if (!skippedMergeForLargeFile) {
        // Store merged blob in IDB in chunks so the SW never holds the whole blob in memory
        const CHUNK_SIZE = 32 * 1024 * 1024; // 32MB per chunk
        const totalSize = validatedBlob.size;
        const chunkCount = Math.ceil(totalSize / CHUNK_SIZE);
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
          for (let i = 0; i < chunkCount; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, totalSize);
            const chunk = validatedBlob.slice(start, end);
            const chunkBuffer = await chunk.arrayBuffer();
            const chunkKey = `${inputBlobIdForConvert}_chunk_${i}`;
            await new Promise((resolve, reject) => {
              const tx = db.transaction(["blobs"], "readwrite");
              tx.objectStore("blobs").put(chunkBuffer, chunkKey);
              tx.oncomplete = () => resolve();
              tx.onerror = () => reject(tx.error);
            });
            if (i % 20 === 0 && chunkCount > 20) {
              await chrome.storage.local.set({
                [`downloadStatus_${downloadId}`]: `Storing for conversion (chunk ${i + 1}/${chunkCount})...`,
              });
            }
          }
          db.close();
        } catch (storeErr) {
          throw new Error(storeErr?.message || "Failed to store blob in IDB");
        }
      }

      // Offscreen assembles chunks into one blob under inputBlobIdForConvert (or we already have chunks from large-file path)
      const totalSize = skippedMergeForLargeFile ? chunksOnlyForDownload.totalSize : validatedBlob.size;
      const chunkCount = skippedMergeForLargeFile ? chunksOnlyForDownload.chunkCount : Math.ceil(totalSize / (32 * 1024 * 1024));
      const assembleResult = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            action: "assembleChunksForConvert",
            blobId: inputBlobIdForConvert,
            chunkCount,
            totalSize,
          },
          (response) => {
            if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
            else resolve(response || { success: false, error: "No response" });
          },
        );
      });
      if (!assembleResult || !assembleResult.success) {
        chunksOnlyForDownload = { blobId: inputBlobIdForConvert, chunkCount, totalSize };
        throw new Error(assembleResult?.error || "Failed to assemble chunks in IDB");
      }
      storedInputInIDB = true;
      // FFmpeg check (same idea as sound-catcher): ensure FFmpeg is loadable before starting conversion
      const checkResult = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "checkFFmpeg" }, (response) => {
          if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
          else resolve(response || { success: false, error: "No response" });
        });
      });
      if (!checkResult || !checkResult.success) {
        const errMsg = checkResult?.error || "FFmpeg is not available";
        await chrome.storage.local.set({
          [`downloadProgress_${downloadId}`]: 0,
          [`downloadStatus_${downloadId}`]: errMsg,
        });
        throw new Error(errMsg);
      }
      const CONVERT_RESPONSE_TIMEOUT_MS = 7 * 60 * 1000;
      const convertResult = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("Conversion timed out (7 min)"));
        }, CONVERT_RESPONSE_TIMEOUT_MS);
        chrome.runtime.sendMessage(
          { action: "convertToMp4", blobId: inputBlobIdForConvert, downloadId },
          (response) => {
            clearTimeout(timeoutId);
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          },
        );
      });

      if (convertResult && convertResult.success && convertResult.outputBlobId) {
        converted = true;
        await chrome.storage.local.set({
          [`downloadProgress_${downloadId}`]: 100,
          [`downloadStatus_${downloadId}`]: "Saving MP4...",
        });
        await downloadBlob(
          { blobId: convertResult.outputBlobId },
          mp4Filename,
          downloadId,
          downloadControllers,
          activeChromeDownloads,
          cleanupIndexedDBBlob,
          setupOffscreenDocument,
          blobToDataUrl,
        );
      }
    } catch (convertErr) {
      console.warn("Convert to MP4 failed, saving as .ts:", convertErr.message);
    }

    if (!converted) {
      let fallbackStatus = "Download complete! (saved as .ts)";
      await chrome.storage.local.set({
        [`downloadProgress_${downloadId}`]: 100,
        [`downloadStatus_${downloadId}`]: "Saving as .ts (conversion failed or timed out)...",
      });
      // Use IDB for .ts fallback when we stored the merged blob there: validatedBlob is no longer
      // readable after arrayBuffer() and would throw NotReadableError if used again.
      if (storedInputInIDB && inputBlobIdForConvert) {
        console.log("[downloadM3U8] .ts fallback: using IDB blob", inputBlobIdForConvert);
        await downloadBlob(
          { blobId: inputBlobIdForConvert },
          finalFilename,
          downloadId,
          downloadControllers,
          activeChromeDownloads,
          cleanupIndexedDBBlob,
          setupOffscreenDocument,
          blobToDataUrl,
        );
        cleanupIndexedDBBlob(inputBlobIdForConvert);
      } else if (chunksOnlyForDownload) {
        // Try chunked MP4 conversion (500MB parts) so we get part1.mp4, part2.mp4, ... instead of one huge .ts
        try {
          console.log("[downloadM3U8] Trying chunked MP4 conversion (500MB parts)...");
          await downloadViaChunkedMp4Conversion(
            chunksOnlyForDownload,
            finalFilename,
            downloadId,
            downloadControllers,
            activeChromeDownloads,
            setupOffscreenDocument,
          );
          fallbackStatus = "Download complete! (MP4 parts)";
        } catch (chunkedErr) {
          console.warn("[downloadM3U8] Chunked MP4 failed, saving as single .ts:", chunkedErr.message);
          await chrome.storage.local.set({
            [`downloadStatus_${downloadId}`]: "Saving as .ts (conversion failed or timed out)...",
          });
          await downloadViaBlobFromChunks(
            chunksOnlyForDownload,
            finalFilename,
            downloadId,
            downloadControllers,
            activeChromeDownloads,
            setupOffscreenDocument,
          );
        }
      } else {
        console.log("[downloadM3U8] .ts fallback: using validatedBlob (IDB not used)");
        await downloadBlob(
          validatedBlob,
          finalFilename,
          downloadId,
          downloadControllers,
          activeChromeDownloads,
          cleanupIndexedDBBlob,
          setupOffscreenDocument,
          blobToDataUrl,
        );
      }
      await chrome.storage.local.set({
        [`downloadStatus_${downloadId}`]: fallbackStatus,
      });
    } else if (inputBlobIdForConvert) {
      cleanupIndexedDBBlob(inputBlobIdForConvert);
    }

    // Release validatedBlob only AFTER download is fully complete (Chrome download + blob URL revoked).
    // Delay cleanup so we don't clear in the same tick; wait until everything is truly done.
    setTimeout(() => {
      validatedBlob = null;
    }, 3000);

    // Clean up ALL download-related storage keys after delay
    // Keep progress/status visible for 15s so polling can detect completion, then remove everything
    setTimeout(() => {
      chrome.storage.local.remove(
        [
          `downloadProgress_${downloadId}`,
          `downloadStatus_${downloadId}`,
          `downloadInfo_${downloadId}`,
          `downloadCancelled_${downloadId}`,
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
              "Cleaned up all download storage from downloadM3U8:",
              downloadId,
            );
          }
        },
      );
    }, 15000);
  } catch (error) {
    // Check if error is due to cancellation
    if (error.name === "AbortError" || abortController.signal.aborted) {
      console.log("M3U8 download was cancelled:", downloadId);
      await chrome.storage.local.set({
        [`downloadProgress_${downloadId}`]: 0,
        [`downloadStatus_${downloadId}`]: "Download cancelled",
      });

      // Clean up ALL download-related storage keys after delay
      setTimeout(() => {
        chrome.storage.local.remove(
          [
            `downloadProgress_${downloadId}`,
            `downloadStatus_${downloadId}`,
            `downloadInfo_${downloadId}`,
            `downloadCancelled_${downloadId}`,
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
                "Cleaned up all download storage from downloadM3U8 (cancelled):",
                downloadId,
              );
            }
          },
        );
      }, 2000);

      throw new Error("Download cancelled by user");
    }

    // Create user-friendly error message
    let errorMessage = "Download failed";
    if (error.message) {
      if (
        error.message.includes("Failed to fetch") ||
        error.message.includes("NetworkError")
      ) {
        errorMessage =
          "Network error: Failed to download video segments. Please check your internet connection and try again.";
      } else if (error.message.includes("No segments found")) {
        errorMessage =
          "No video segments found in playlist. The video may not be available for download.";
      } else if (error.message.includes("No variant playlists")) {
        errorMessage = "Could not find video quality variants in playlist.";
      } else if (error.message.includes("Failed to download segment")) {
        errorMessage =
          "Failed to download video segments. The video may be protected or unavailable.";
      } else {
        errorMessage = `Download failed: ${error.message}`;
      }
    }

    console.error("M3U8 merge error:", error);

    // Update status with error message
    await chrome.storage.local.set({
      [`downloadProgress_${downloadId}`]: 0,
      [`downloadStatus_${downloadId}`]: errorMessage,
    });

    // Clean up ALL download-related storage keys after delay
    // Keep error status visible for 10 seconds before clearing everything
    setTimeout(() => {
      chrome.storage.local.remove(
        [
          `downloadProgress_${downloadId}`,
          `downloadStatus_${downloadId}`,
          `downloadInfo_${downloadId}`,
          `downloadCancelled_${downloadId}`,
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
              "Cleaned up all download storage from downloadM3U8 (error):",
              downloadId,
            );
          }
        },
      );
    }, 10000);

    throw new Error(errorMessage);
  }
}

/**
 * Helper function to find the correct tabId for a Dailymotion URL
 * @param {string} masterPlaylistUrl - The master playlist URL
 * @param {Object} videoData - Video data object
 * @returns {Promise<number|null>} Tab ID or null if not found
 */
async function findDailymotionTabId(masterPlaylistUrl, videoData) {
  try {
    // First, try to find any Dailymotion tab that has video data
    // This is more reliable than trying to extract videoId from the playlist URL
    const tabs = await chrome.tabs.query({ url: "*://*.dailymotion.com/*" });

    if (tabs.length === 0) {
      console.log("No Dailymotion tabs found");
      return null;
    }

    // Try to find a tab that has video data with URLs
    for (const tab of tabs) {
      if (
        videoData[tab.id] &&
        videoData[tab.id].urls &&
        videoData[tab.id].urls.length > 0
      ) {
        // This tab has video data, use it
        console.log("Found tab with video data:", tab.id, tab.url);
        return tab.id;
      }
    }

    // If no tab has video data yet, use the active tab or first tab
    const activeTab = tabs.find((tab) => tab.active) || tabs[0];
    if (activeTab) {
      console.log(
        "Using active/first Dailymotion tab:",
        activeTab.id,
        activeTab.url,
      );
      return activeTab.id;
    }

    return null;
  } catch (error) {
    console.warn("Error finding Dailymotion tab:", error);
    return null;
  }
}

/**
 * Fetch and parse HLS master playlist to extract all quality variants
 * @param {number} tabId - The tab ID
 * @param {string} masterPlaylistUrl - The master playlist URL
 * @param {string|null} providedVideoId - Optional video ID
 * @param {string|null} providedVideoTitle - Optional video title
 * @param {Object} videoData - Video data object
 * @param {Function} storeVideoUrl - Function to store video URLs
 * @param {Set} parsingHLSVariants - Set to track parsing state
 * @returns {Promise<void>}
 */
async function parseAndStoreHLSVariants(
  tabId,
  masterPlaylistUrl,
  providedVideoId = null,
  providedVideoTitle = null,
  videoData,
  storeVideoUrl,
  parsingHLSVariants,
) {
  // Fix URL encoding first for deduplication
  const normalizedUrl = fixUrlEncoding(masterPlaylistUrl);

  // Prevent duplicate parsing of the same playlist
  if (parsingHLSVariants.has(normalizedUrl)) {
    console.log(
      "Already parsing HLS variants for this URL, skipping:",
      normalizedUrl.substring(0, 80) + "...",
    );
    return;
  }

  // Mark as being parsed
  parsingHLSVariants.add(normalizedUrl);

  // Auto-remove from set after 30 seconds to prevent permanent blocking
  setTimeout(() => {
    parsingHLSVariants.delete(normalizedUrl);
  }, 30000);

  try {
    console.log("Parsing HLS variants from:", normalizedUrl);

    // If tabId is invalid (-1), try to find the correct tab
    if (!tabId || tabId < 0) {
      console.log("Invalid tabId, trying to find correct Dailymotion tab...");
      const foundTabId = await findDailymotionTabId(normalizedUrl, videoData);
      if (foundTabId) {
        tabId = foundTabId;
        console.log("Found correct tabId:", tabId);
      } else {
        console.warn(
          "Could not find valid tabId for HLS variants, skipping storage",
        );
        parsingHLSVariants.delete(normalizedUrl);
        return;
      }
    }

    // Use normalized URL
    masterPlaylistUrl = normalizedUrl;

    // Get fetch options with headers
    let fetchOptions;
    try {
      fetchOptions = await getFetchOptionsWithHeaders(masterPlaylistUrl, tabId);
    } catch (error) {
      console.warn("Failed to get fetch options for master playlist:", error);
      // Try with minimal options
      fetchOptions = {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.9",
        },
      };
    }

    // Fetch the master playlist with retry logic
    let response;
    try {
      response = await fetch(masterPlaylistUrl, fetchOptions);
      if (!response.ok) {
        console.warn(
          "Failed to fetch master playlist for variant extraction:",
          response.status,
          response.statusText,
        );
        return;
      }
    } catch (error) {
      console.error(
        "Network error fetching master playlist:",
        error.message || error,
      );

      // If fetch fails, it might be a CORS issue or network problem
      // The master playlist might have already been fetched by the network request listener
      // Check if we already have this URL stored
      if (videoData[tabId] && videoData[tabId].urls) {
        const existingMaster = videoData[tabId].urls.find(
          (v) =>
            v.url === masterPlaylistUrl ||
            (v.type &&
              v.type.includes("hls-master") &&
              v.url.includes(".m3u8")),
        );

        if (existingMaster) {
          console.log("Master playlist already stored, skipping fetch");
          // The variants might already be parsed, or we can try to parse from stored data
          // For now, just return - the variants will be parsed when the playlist is actually fetched
          return;
        }
      }

      // Try one more time with a simpler request (no cookies/headers)
      try {
        console.log("Retrying with simpler fetch options...");
        response = await fetch(masterPlaylistUrl, {
          method: "GET",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });
        if (!response.ok) {
          console.warn(
            "Retry also failed:",
            response.status,
            response.statusText,
          );
          return;
        }
      } catch (retryError) {
        console.error("Retry also failed:", retryError.message || retryError);
        // Don't throw - this is a background operation, just log and return
        return;
      }
    }

    const playlistText = await response.text();
    console.log("Master playlist fetched, length:", playlistText.length);

    if (!playlistText || !playlistText.includes("#EXT-X-STREAM-INF")) {
      // Not a master playlist, or already a variant playlist
      console.log("Not a master playlist or no #EXT-X-STREAM-INF found");
      return;
    }

    // Parse the base URL
    const baseUrl = masterPlaylistUrl.substring(
      0,
      masterPlaylistUrl.lastIndexOf("/") + 1,
    );

    // Parse variants from master playlist
    const variants = parseMasterPlaylist(playlistText, baseUrl);
    console.log(
      `Found ${variants.length} HLS variants:`,
      variants.map((v) => ({
        resolution: v.resolution,
        bandwidth: v.bandwidth,
        url: v.url.substring(0, 60) + "...",
      })),
    );

    if (variants.length === 0) {
      console.log("No variants found in master playlist");
      return;
    }

    // Ensure videoData exists for this tab
    if (!videoData[tabId]) {
      videoData[tabId] = {
        urls: [],
        activeUrl: null,
        videoTitle: null,
        videoIds: {},
      };
    }

    // Check if variants from this playlist are already stored (prevent duplicate parsing)
    // Extract a unique identifier from the playlist URL (psid or similar)
    const psidMatch = masterPlaylistUrl.match(/psid=([^&\/]+)/);
    if (psidMatch && videoData[tabId].urls.length > 0) {
      const psid = psidMatch[1];
      const existingVariants = videoData[tabId].urls.filter(
        (v) =>
          v.type &&
          v.type.startsWith("hls-") &&
          v.type !== "hls-master" &&
          v.url.includes(psid),
      );
      if (existingVariants.length >= 3) {
        // If we already have 3+ variants with this psid, skip parsing
        console.log(
          `Variants from this playlist already stored (${existingVariants.length} variants found), skipping parse`,
        );
        parsingHLSVariants.delete(normalizedUrl);
        return;
      }
    }

    // Extract videoId and videoTitle - prioritize provided values
    let videoId = providedVideoId;
    let videoTitle = providedVideoTitle;

    // If videoId was provided, get title from videoIds map if not provided
    if (
      videoId &&
      !videoTitle &&
      videoData[tabId].videoIds &&
      videoData[tabId].videoIds[videoId]
    ) {
      videoTitle = videoData[tabId].videoIds[videoId].title;
      console.log(
        "Got videoTitle from videoIds map for provided videoId:",
        videoId,
        "title:",
        videoTitle,
      );
    }

    // If no videoId provided, try to find it from most recent URLs (prefer recent over old)
    if (!videoId) {
      // Sort URLs by timestamp (most recent first) and find first with videoId
      const sortedUrls = [...videoData[tabId].urls].sort(
        (a, b) => (b.timestamp || 0) - (a.timestamp || 0),
      );
      const recentVideo = sortedUrls.find((v) => v.videoId);
      if (recentVideo) {
        videoId = recentVideo.videoId;
        videoTitle = recentVideo.videoTitle;
        console.log("Found videoId from most recent URLs:", videoId);
      }
    }

    // If still no videoId, try to get it from videoIds map (most recent key)
    if (!videoId && videoData[tabId].videoIds) {
      const videoIdKeys = Object.keys(videoData[tabId].videoIds);
      if (videoIdKeys.length > 0) {
        // Use the most recently added videoId (last key, or we could track timestamps)
        // For now, prefer the one with a title
        const videoIdWithTitle = videoIdKeys.find(
          (id) => videoData[tabId].videoIds[id]?.title,
        );
        videoId = videoIdWithTitle || videoIdKeys[videoIdKeys.length - 1];
        videoTitle = videoData[tabId].videoIds[videoId]?.title || videoTitle;
        console.log("Found videoId from videoIds map:", videoId);
      }
    }

    // If still no videoId, try to get it from the tab's URL (async)
    if (!videoId && tabId) {
      try {
        const tab = await new Promise((resolve) => {
          chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError) {
              resolve(null);
            } else {
              resolve(tab);
            }
          });
        });

        if (tab && tab.url) {
          const tabVideoId = extractVideoId(tab.url);
          if (tabVideoId) {
            videoId = tabVideoId;
            // Get title from videoIds map if available
            if (
              videoData[tabId].videoIds &&
              videoData[tabId].videoIds[videoId]
            ) {
              videoTitle = videoData[tabId].videoIds[videoId].title;
            }
            console.log("Found videoId from tab URL:", videoId);
          }
        }
      } catch (e) {
        console.warn("Error getting tab URL for videoId:", e);
      }
    }

    // Last resort: try to extract from master playlist URL (unlikely to work)
    if (!videoId) {
      videoId = extractVideoId(masterPlaylistUrl);
      console.log(
        "Tried extracting videoId from master playlist URL:",
        videoId,
      );
    }

    console.log(
      "Using videoId for variants:",
      videoId,
      "videoTitle:",
      videoTitle,
    );

    // If we still don't have a videoId, we can't properly group the variants
    // But we'll still store them - they might get matched later
    if (!videoId) {
      console.warn(
        "Warning: No videoId found for HLS variants. They may not group correctly in the popup.",
      );
    }

    // Store each variant with quality information
    let storedCount = 0;
    variants.forEach((variant, index) => {
      // Extract quality from resolution (e.g., "1920x1080" -> "1080p")
      let quality = null;
      if (variant.resolution && variant.resolution !== "unknown") {
        const resolutionMatch = variant.resolution.match(/(\d+)x(\d+)/);
        if (resolutionMatch) {
          const height = parseInt(resolutionMatch[2]);
          quality = height;
        }
      }

      // If no resolution, try to infer from bandwidth (rough estimate)
      if (!quality && variant.bandwidth) {
        // Rough mapping: 240p ~500k, 360p ~1M, 480p ~2M, 720p ~4M, 1080p ~8M
        if (variant.bandwidth < 800000) quality = 240;
        else if (variant.bandwidth < 1500000) quality = 360;
        else if (variant.bandwidth < 3000000) quality = 480;
        else if (variant.bandwidth < 6000000) quality = 720;
        else quality = 1080;
      }

      // Create type string with quality info
      const type = quality ? `hls-${quality}p` : `hls-variant-${index + 1}`;

      // Store the variant URL with videoId and videoTitle
      storeVideoUrl(tabId, variant.url, type, false, videoTitle, videoId);
      storedCount++;
      console.log(
        `Stored HLS variant ${storedCount}/${variants.length}: ${quality ? quality + "p" : "variant " + (index + 1)} (videoId: ${videoId}) - ${variant.url.substring(0, 80)}...`,
      );
    });

    console.log(
      `Successfully stored ${storedCount} HLS variants for tab ${tabId}`,
    );
  } catch (error) {
    console.error("Failed to parse HLS master playlist for variants:", error);
    // Don't throw - this is a background operation, failure shouldn't break the extension
  } finally {
    // Always remove from parsing set when done
    parsingHLSVariants.delete(normalizedUrl);
  }
}
