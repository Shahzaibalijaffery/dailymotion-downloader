/**
 * General utility functions for Dailymotion Video Downloader
 * Shared across background, content, and popup scripts
 */

/**
 * Extract video ID from a Dailymotion URL
 * Supports multiple URL patterns:
 * - /video/VIDEO_ID
 * - dailymotion.com/video/VIDEO_ID
 * - Query params: video_id, xid
 * 
 * @param {string} url - The URL to extract video ID from
 * @returns {string|null} - The video ID or null if not found
 */
function extractVideoId(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }
  
  try {
    // Pattern 1: /video/VIDEO_ID (most common - Dailymotion uses alphanumeric IDs like x7abc123)
    let match = url.match(/\/video\/([a-zA-Z0-9]+)/);
    if (match) {
      return match[1];
    }
    
    // Pattern 2: dailymotion.com/video/VIDEO_ID
    match = url.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/);
    if (match) {
      return match[1];
    }
    
    // Pattern 3: www.dailymotion.com/video/VIDEO_ID
    match = url.match(/www\.dailymotion\.com\/video\/([a-zA-Z0-9]+)/);
    if (match) {
      return match[1];
    }
    
    // Pattern 4: video_id in query params
    try {
      const urlObj = new URL(url);
      const params = urlObj.searchParams;
      if (params.has('video_id')) {
        return params.get('video_id');
      }
      // Pattern 5: xid in query params (Dailymotion sometimes uses xid)
      if (params.has('xid')) {
        return params.get('xid');
      }
    } catch (e) {
      // URL parsing failed, continue
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Check if a URL is a Dailymotion video page
 * Only matches: dailymotion.com/video/VIDEO_ID
 * Skips: dailymotion.com/pk, dailymotion.com/pk#for-you, dailymotion.com/, etc.
 * 
 * @param {string} url - The URL to check (optional, defaults to window.location.href for content scripts)
 * @returns {boolean} - True if the URL is a video page
 */
function isVideoPage(url) {
  try {
    // If no URL provided and we're in a browser context, use current location
    if (!url && typeof window !== 'undefined' && window.location) {
      url = window.location.href;
    }
    
    if (!url || typeof url !== 'string') {
      return false;
    }
    
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    
    // Must have /video/ in pathname followed by a video ID
    const videoPagePattern = /^\/video\/[a-zA-Z0-9]+/;
    return videoPagePattern.test(pathname);
  } catch (e) {
    return false;
  }
}

/**
 * Clean and normalize video title from page/tab title
 * Removes common Dailymotion suffixes and filters generic titles
 * 
 * @param {string} title - The raw title to clean
 * @returns {string|null} - The cleaned title or null if invalid/generic
 */
function cleanVideoTitle(title) {
  if (!title || typeof title !== 'string') {
    return null;
  }
  
  try {
    // Remove common suffixes: " - Dailymotion", " | Dailymotion", " - Watch on Dailymotion", etc.
    let cleaned = title.replace(/\s*[-|]\s*Dailymotion.*$/i, '').trim();
    cleaned = cleaned.replace(/\s*[-|]\s*Watch.*Dailymotion.*$/i, '').trim();
    
    // Remove "Dailymotion Video Player" if it's the entire title or a suffix
    cleaned = cleaned.replace(/\s*[-|]\s*Dailymotion\s+Video\s+Player.*$/i, '').trim();
    cleaned = cleaned.replace(/^Dailymotion\s+Video\s+Player\s*[-|]?\s*/i, '').trim();
    
    // Filter out generic titles
    if (!cleaned || cleaned.length < 2) {
      return null;
    }
    
    const lowerTitle = cleaned.toLowerCase();
    if (lowerTitle.match(/^(dailymotion|video|dailymotion video player|video player)$/i)) {
      return null;
    }
    
    return cleaned;
  } catch (e) {
    return null;
  }
}

/**
 * Extract quality (resolution) from video type or URL
 * Looks for patterns like "1080p", "720p", "hls-240p", etc.
 * 
 * @param {string} type - The video type (e.g., "mp4-1080p", "hls-720p")
 * @param {string} url - Optional URL to extract quality from if type doesn't have it
 * @returns {number|null} - The quality in pixels (e.g., 1080) or null if not found
 */
function extractQuality(type, url = '') {
  if (!type && !url) {
    return null;
  }
  
  // Try to extract from type first (e.g., "mp4-1080p", "hls-1080p", "hls-720p")
  if (type) {
    const match = type.match(/(\d+)p/i);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  
  // Try to extract from URL if type doesn't have quality
  if (url) {
    const match = url.match(/(\d+)p/i);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  
  return null;
}

/**
 * Format quality label for display
 * Creates user-friendly labels like "1080p (MP4)", "720p (HLS)", etc.
 * 
 * @param {Object} video - Video object with type and url properties
 * @param {string} video.type - Video type (e.g., "mp4-1080p", "hls-720p")
 * @param {string} video.url - Video URL (optional, for fallback quality extraction)
 * @returns {string} - Formatted quality label
 */
function formatQualityLabel(video) {
  if (!video || !video.type) {
    return 'Video';
  }
  
  const quality = extractQuality(video.type, video.url);
  const isMP4 = video.type.includes('mp4') && !video.type.includes('m3u8');
  const isHLS = video.type.includes('m3u8') || video.type.includes('hls');
  
  let qualityLabel = '';
  
  if (quality) {
    qualityLabel = `${quality}p`;
  } else {
    // For HLS, try to infer from type pattern (e.g., hls-240p, hls-360p)
    if (isHLS && video.type) {
      const typeMatch = video.type.match(/hls-(\d+)p?/i);
      if (typeMatch) {
        qualityLabel = `${typeMatch[1]}p`;
      } else if (video.url) {
        // Check if URL has quality indicators
        if (video.url.includes('1080') || video.url.includes('hd')) {
          qualityLabel = '1080p';
        } else if (video.url.includes('720')) {
          qualityLabel = '720p';
        } else if (video.url.includes('480')) {
          qualityLabel = '480p';
        } else if (video.url.includes('360')) {
          qualityLabel = '360p';
        } else if (video.url.includes('240')) {
          qualityLabel = '240p';
        } else {
          qualityLabel = 'Unknown Quality';
        }
      } else {
        qualityLabel = 'HLS Stream';
      }
    } else {
      // Fallback labels
      if (isHLS) {
        qualityLabel = 'HLS Stream';
      } else if (isMP4) {
        qualityLabel = 'MP4';
      } else {
        qualityLabel = video.type || 'Video';
      }
    }
  }
  
  // Add format suffix
  if (isMP4) {
    return `${qualityLabel} (MP4)`;
  } else if (isHLS) {
    return `${qualityLabel} (HLS)`;
  } else {
    return qualityLabel;
  }
}

/**
 * Fix URL encoding issues
 * Replaces common escaped characters with their actual values
 * 
 * @param {string} url - The URL to fix
 * @returns {string} - The fixed URL
 */
function fixUrlEncoding(url) {
  if (!url || typeof url !== 'string') {
    return url;
  }
  
  // Fix \\u0026 to & and other common encoding issues
  return url
    .replace(/\\u0026/g, '&')
    .replace(/\\u003d/g, '=')
    .replace(/\\u002f/g, '/');
}

/**
 * Check if a URL is a chunked/range request
 * These are partial MP4 requests and should be skipped in favor of full URLs
 * 
 * @param {string} url - The URL to check
 * @returns {boolean} - True if the URL appears to be a chunked/range request
 */
function isChunkedRangeUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  
  try {
    const urlObj = new URL(url);
    // Dailymotion range URLs often contain /range/ in the path or a range query param
    if (urlObj.pathname.includes("/range/")) return true;
    if (urlObj.searchParams.has('range') || urlObj.searchParams.has('bytes')) {
      return true;
    }
  } catch (e) {
    // URL parsing failed, check string patterns
  }
  
  // Check for range request patterns in URL string
  return url.includes('range=') || 
         url.includes('bytes=') || 
         url.match(/\/\d+-\d+\.mp4/) !== null ||
         url.includes('/range/'); // Dailymotion range URLs often contain /range/ in the path
}

/**
 * Extract base URL from a range-based URL
 * Removes range parameters and /range/ path segments to get the base video URL
 * 
 * @param {string} rangeUrl - The range-based URL
 * @returns {string} - The base URL without range parameters
 */
function extractBaseUrlFromRange(rangeUrl) {
  if (!rangeUrl || typeof rangeUrl !== 'string') {
    return rangeUrl;
  }
  
  try {
    const urlObj = new URL(rangeUrl);
    const originalPath = urlObj.pathname;

    // Remove range query parameter
    urlObj.searchParams.delete("range");

    // Pattern: /v2/range/prot/.../avf/file.mp4
    // We need to extract: /v2/avf/file.mp4 or just the file path

    // Try to find the file path after /range/
    // Match pattern: /v2/range/prot/.../avf/file.mp4
    const rangePattern =
      /(\/v\d+\/)?range\/[^/]+(\/[^/]+)*\/(avf\/)?([^/]+\.mp4)/;
    const match = originalPath.match(rangePattern);

    if (match) {
      // Reconstruct path: /v2/avf/file.mp4 or /avf/file.mp4
      const vPrefix = match[1] || ""; // /v2/ or empty
      const avfPrefix = match[3] || ""; // avf/ or empty
      const filename = match[4]; // file.mp4
      urlObj.pathname = vPrefix + avfPrefix + filename;
    } else {
      // Fallback: try to find .mp4 anywhere in path
      const mp4Match = originalPath.match(/(\/[^/]*\/[^/]+\.mp4)/);
      if (mp4Match) {
        urlObj.pathname = mp4Match[1];
      } else {
        // Last resort: just remove /range/ part
        urlObj.pathname = originalPath.replace(/\/range\/[^/]+(\/[^/]+)*/, "");
      }
    }

    return urlObj.toString();
  } catch (e) {
    console.error("Failed to extract base URL:", e);
    // Fallback: try simple string replacement
    let baseUrl = rangeUrl.replace(/\/range\/[^/]+(\/[^/]+)*/, "");
    baseUrl = baseUrl.replace(/[?&]range=[^&]*/, "");
    return baseUrl;
  }
}

/**
 * Normalize config URL for deduplication
 * Strips query params to create a stable key for config URLs
 * 
 * @param {string} url - The config URL to normalize
 * @returns {string} - Normalized URL (origin + pathname)
 */
function normalizeConfigUrl(url) {
  if (!url || typeof url !== 'string') {
    return url;
  }
  
  try {
    const u = new URL(url);
    // Use origin + path as a stable key (strip query so anon_signature variants dedupe)
    return `${u.origin}${u.pathname}`;
  } catch (e) {
    return url;
  }
}

/**
 * Normalize URL for download deduplication
 * Removes query params that don't affect the actual video content
 * 
 * @param {string} url - The URL to normalize
 * @returns {string} - Normalized URL
 */
function normalizeUrlForDownload(url) {
  if (!url || typeof url !== 'string') {
    return url;
  }
  
  try {
    const urlObj = new URL(url);
    // Remove query params that don't affect the actual video content
    urlObj.searchParams.delete('range');
    urlObj.searchParams.delete('t');
    urlObj.searchParams.delete('timestamp');
    return urlObj.toString();
  } catch (e) {
    return url;
  }
}

/**
 * Generate a unique download ID
 * Format: download_TIMESTAMP_RANDOMSTRING
 * 
 * @returns {string} - Unique download ID
 */
function generateDownloadId() {
  return `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check if a video type is MP4
 * 
 * @param {string} type - Video type string
 * @returns {boolean} - True if type is MP4
 */
function isMP4(type) {
  if (!type || typeof type !== 'string') {
    return false;
  }
  return type.includes('mp4') && !type.includes('m3u8');
}

/**
 * Check if a video type is HLS
 * 
 * @param {string} type - Video type string
 * @returns {boolean} - True if type is HLS
 */
function isHLS(type) {
  if (!type || typeof type !== 'string') {
    return false;
  }
  return type.includes('m3u8') || type.includes('hls');
}

/**
 * Validate if a response is valid JSON
 * Checks content-type and response text
 * 
 * @param {Response} response - Fetch response object
 * @param {string} responseText - Response text content
 * @returns {boolean} - True if response appears to be valid JSON
 */
function validateJsonResponse(response, responseText) {
  if (!response || !responseText) {
    return false;
  }
  
  // Check content-type
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json') || contentType.includes('text/json');
  
  // Check if response starts with HTML tags (not JSON)
  const trimmed = responseText.trim();
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<')) {
    return false;
  }
  
  // If content-type doesn't indicate JSON, check if it looks like JSON
  if (!isJson && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return false;
  }
  
  return true;
}

/**
 * Format file size in human-readable format
 * 
 * @param {number} bytes - File size in bytes
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} - Formatted file size (e.g., "1.5 MB", "500 KB")
 */
function formatFileSize(bytes, decimals = 2) {
  if (!bytes || bytes === 0) {
    return '0 Bytes';
  }
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Check if a file size is below minimum threshold
 * Used to filter out thumbnails and small files
 * 
 * @param {number|null|undefined} fileSize - File size in bytes
 * @param {number} minSizeBytes - Minimum size in bytes (default: 300KB)
 * @returns {boolean} - True if file is too small
 */
function isFileTooSmall(fileSize, minSizeBytes = 300 * 1024) {
  if (fileSize === null || fileSize === undefined) {
    return false; // Unknown size, don't filter
  }
  return fileSize < minSizeBytes;
}

/**
 * Check if a URL is a segment playlist (not a master playlist)
 * 
 * @param {string} url - The M3U8 URL to check
 * @returns {boolean} - True if URL is a segment playlist
 */
function isSegmentPlaylist(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  
  return url.includes('/media.m3u8') || 
         (url.includes('/playlist/av/') && url.includes('/avf/'));
}

// Export functions for use in different contexts
if (typeof module !== 'undefined' && module.exports) {
  // Node.js/CommonJS
  module.exports = {
    extractVideoId,
    isVideoPage,
    cleanVideoTitle,
    extractQuality,
    formatQualityLabel,
    fixUrlEncoding,
    isChunkedRangeUrl,
    extractBaseUrlFromRange,
    normalizeConfigUrl,
    normalizeUrlForDownload,
    generateDownloadId,
    isMP4,
    isHLS,
    validateJsonResponse,
    formatFileSize,
    isFileTooSmall,
    isSegmentPlaylist
  };
}
