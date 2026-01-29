/**
 * Video extraction and URL detection functionality
 * Handles extracting video URLs from page, config files, and intercepting network requests
 */

// Track URLs we've already sent to avoid spamming background
const seenUrls = new Set();

// Debug logging toggle for extraction module
// When false (default), we avoid heavy console.log spam that can lag the page
const DEBUG_EXTRACTION = false;

// Throttle extraction to avoid heavy repeated work
const EXTRACT_COOLDOWN_MS = 4000;
let lastExtractRun = 0;
let pendingExtractTimer = null;

/**
 * Schedule video config extraction with throttling
 * @param {string} reason - Reason for extraction
 */
function scheduleExtract(reason = 'manual') {
  const now = Date.now();
  const elapsed = now - lastExtractRun;
  if (elapsed >= EXTRACT_COOLDOWN_MS) {
    lastExtractRun = now;
    extractVideoConfig(reason);
  } else {
    clearTimeout(pendingExtractTimer);
    pendingExtractTimer = setTimeout(() => {
      lastExtractRun = Date.now();
      extractVideoConfig(reason);
    }, EXTRACT_COOLDOWN_MS - elapsed);
  }
}

/**
 * Extract video config from page
 * @param {string} reason - Reason for extraction
 */
function extractVideoConfig(reason = 'unknown') {
  // Only extract config if we're on a video page
  if (!isVideoPage()) {
    if (DEBUG_EXTRACTION) console.log('Not a video page, skipping config extraction');
    return;
  }
  
  if (DEBUG_EXTRACTION) console.log('Extracting video config (reason:', reason, ')');
  try {
    // Method 1: Look for window.__PLAYER_CONFIG__ or window.DM (Dailymotion config)
    if (window.__PLAYER_CONFIG__) {
      const config = window.__PLAYER_CONFIG__;
      if (DEBUG_EXTRACTION) console.log('Found __PLAYER_CONFIG__:', config);
      parseConfig(config);
    }
    if (window.DM && window.DM.player && window.DM.player.config) {
      const config = window.DM.player.config;
      if (DEBUG_EXTRACTION) console.log('Found DM.player.config:', config);
      parseConfig(config);
    }
    
    // Method 2: Look for config in script tags
    const scripts = document.querySelectorAll('script');
    scripts.forEach(script => {
      const content = script.textContent;
      
      // Look for Dailymotion config patterns
      if (content.includes('config_url') || content.includes('"progressive"') || content.includes('"hls"') || content.includes('"qualities"')) {
        try {
          // Try to find JSON objects with video URLs
          const jsonMatches = content.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
          if (jsonMatches) {
            jsonMatches.forEach(jsonStr => {
              if (jsonStr.includes('.mp4') || jsonStr.includes('.m3u8') || jsonStr.includes('progressive') || jsonStr.includes('hls')) {
                try {
                  const parsed = JSON.parse(jsonStr);
                  parseConfig(parsed);
                } catch (e) {
                  // Not valid JSON, skip
                }
              }
            });
          }
          
          // Look for direct URL patterns
          const urlMatches = content.match(/(https?:\/\/[^\s"']+\.(?:mp4|m3u8)[^\s"']*)/g);
          if (urlMatches) {
            urlMatches.forEach(url => {
              const type = url.includes('.m3u8') ? 'm3u8' : 'mp4';
              sendUrlToBackground(url, type);
            });
          }
        } catch (e) {
          if (DEBUG_EXTRACTION) console.log('Script parse error:', e);
        }
      }
    });
    
    // Method 3: Check for player data attributes
    const players = document.querySelectorAll('[data-config-url], [data-player-id]');
    players.forEach(player => {
      const configUrl = player.getAttribute('data-config-url');
      if (configUrl) {
        if (DEBUG_EXTRACTION) console.log('Found config URL:', configUrl);
        fetchConfigUrl(configUrl);
      }
    });
  } catch (e) {
    console.error('Extract config error:', e);
  }
}

/**
 * Parse video config object
 * @param {Object} config - Config object to parse
 */
function parseConfig(config) {
  try {
    // Look for progressive downloads (direct MP4)
    if (config.request && config.request.files && config.request.files.progressive) {
      config.request.files.progressive.forEach(file => {
        if (DEBUG_EXTRACTION) console.log('Found progressive MP4:', file);
        sendUrlToBackground(file.url, `mp4-${file.quality || file.height}p`);
      });
    }
    
    // Look for HLS streams
    if (config.request && config.request.files && config.request.files.hls) {
      const hls = config.request.files.hls;
      if (hls.cdns) {
        Object.values(hls.cdns).forEach(cdn => {
          if (cdn.url) {
            if (DEBUG_EXTRACTION) console.log('Found HLS stream:', cdn);
            sendUrlToBackground(cdn.url, 'hls-master');
          }
        });
      }
      if (hls.default_cdn && hls.cdns[hls.default_cdn]) {
        sendUrlToBackground(hls.cdns[hls.default_cdn].url, 'hls-default');
      }
    }
    
    // Alternative config structures
    if (config.video && config.video.progressive) {
      config.video.progressive.forEach(file => {
        sendUrlToBackground(file.url, `mp4-${file.quality}`);
      });
    }
    
    if (config.video && config.video.hls) {
      sendUrlToBackground(config.video.hls.url, 'hls');
    }
  } catch (e) {
    console.error('Parse config error:', e);
  }
}

/**
 * Fetch and parse config from URL
 * @param {string} url - Config URL to fetch
 */
function fetchConfigUrl(url) {
  fetch(url)
    .then(res => res.json())
    .then(config => {
      if (DEBUG_EXTRACTION) console.log('Fetched config:', config);
      parseConfig(config);
    })
    .catch(err => {
      if (DEBUG_EXTRACTION) {
        console.error('Config fetch error:', err);
      }
    });
}

/**
 * Extract video title from the page
 * @returns {string|null} Video title or null
 */
function getVideoTitle() {
  try {
    return cleanVideoTitle(document.title);
  } catch (e) {
    console.error('Error extracting video title:', e);
    return null;
  }
}

/**
 * Extract video ID from current page URL
 * @returns {string|null} Video ID or null
 */
function getVideoIdFromPage() {
  return extractVideoId(window.location.href);
}

/**
 * Send URL to background script for storage
 * @param {string} url - Video URL
 * @param {string} type - URL type (mp4, m3u8, etc.)
 */
function sendUrlToBackground(url, type) {
  if (!url || seenUrls.has(url)) return;
  
  // Only send URLs if we're on a video page
  if (!isVideoPage()) {
    return; // Not a video page, skip URL detection
  }
  
  seenUrls.add(url);
  
  // Get video ID from page URL (current page)
  const currentPageVideoId = getVideoIdFromPage();
  
  // Try to extract videoId from the URL itself (might be different from current page)
  const urlVideoId = extractVideoId(url);
  
  // Only send title if the URL's videoId matches the current page's videoId
  // This prevents old videos from getting the wrong title when URLs are detected late
  let videoTitle = null;
  if (urlVideoId && currentPageVideoId && String(urlVideoId) === String(currentPageVideoId)) {
    // URL belongs to current page - safe to send current page's title
    videoTitle = getVideoTitle();
  } else if (!urlVideoId && !currentPageVideoId) {
    // Neither has a videoId - can't match, but also can't cause wrong assignment
    // Only send title if this is from a network request (more reliable indicator of current page)
    // For now, don't send title to avoid wrong assignments
    videoTitle = null;
  } else if (!urlVideoId && currentPageVideoId) {
    // URL has no videoId but page does - could be from current page or old page
    // Only send title if this is a very recent network request (likely current page)
    // For safety, don't send title - let background script use existing title
    videoTitle = null;
  } else if (urlVideoId && !currentPageVideoId) {
    // URL has videoId but page doesn't - definitely don't send current page title
    videoTitle = null;
  }
  // If videoIds don't match or are uncertain, send null title to preserve existing title in background
  
  safeSendMessage({
    action: 'storeFromContent',
    url: url,
    type: type,
    videoTitle: videoTitle, // null if URL is from different video
    videoId: urlVideoId || currentPageVideoId // Prefer videoId from URL, fallback to page
  }, (response) => {
    if (DEBUG_EXTRACTION) console.log('Sent to background:', url, type, videoTitle || '(no title - different video)', urlVideoId || currentPageVideoId);
  });
}

/**
 * Setup XHR and fetch interception
 */
function setupNetworkInterception() {
  // Intercept XHR requests
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    // Only intercept if we're on a video page
    if (isVideoPage() && (url.includes('.m3u8') || url.includes('.mp4') || url.includes('master.json'))) {
      if (DEBUG_EXTRACTION) console.log('XHR intercepted:', url);
      sendUrlToBackground(url, url.includes('.m3u8') ? 'm3u8' : 'mp4');
    }
    return originalOpen.apply(this, arguments);
  };

  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const url = args[0];
    // Only intercept if we're on a video page
    if (isVideoPage() && typeof url === 'string') {
      if (url.includes('.m3u8') || url.includes('master.json') || url.includes('config')) {
        if (DEBUG_EXTRACTION) console.log('Fetch intercepted:', url);
        const type = url.includes('.m3u8') ? 'm3u8' : 'config';
        sendUrlToBackground(url, type);
        
        // If it's a config/master.json, also fetch and parse it
        if (url.includes('master.json') || url.includes('config')) {
          const fetchPromise = originalFetch.apply(this, args);
          fetchPromise.then(response => {
            if (response.ok) {
              response.clone().json().then(config => {
                if (DEBUG_EXTRACTION) console.log('Fetched config from fetch intercept:', config);
                parseConfig(config);
              }).catch(e => {
                if (DEBUG_EXTRACTION) console.log('Failed to parse config from fetch:', e);
              });
            }
          }).catch(e => {
            if (DEBUG_EXTRACTION) console.log('Fetch error:', e);
          });
          return fetchPromise;
        }
      } else if (url.includes('.mp4')) {
        // Only send non-range MP4 URLs
        if (!url.includes('/range/') && !url.includes('range=')) {
          if (DEBUG_EXTRACTION) console.log('Fetch intercepted MP4:', url);
          sendUrlToBackground(url, 'mp4');
        }
      }
    }
    return originalFetch.apply(this, args);
  };
}

/**
 * Initialize video extraction
 */
function initializeVideoExtraction() {
  // Run extraction shortly after load
  // Only extract config if we're on a video page
  if (isVideoPage()) {
    setTimeout(() => scheduleExtract('initial'), 800);
  }
  
  // Setup lightweight network interception (primary detection mechanism)
  setupNetworkInterception();

  // NOTE:
  // Previously we also:
  //   - observed ALL DOM mutations and
  //   - listened to every 'play' event
  // to re-run extraction.
  //
  // On complex SPA pages like Dailymotion this can add overhead or subtle
  // interactions with the layout when navigating between many videos.
  //
  // To avoid any chance of impacting navigation or side-panel rendering,
  // we now rely on:
  //   - a single initial extract on page load, and
  //   - network interception of .m3u8/master.json/mp4/config requests.
  //
  // If we ever need the aggressive DOM-based extraction again, we can
  // re-enable MutationObserver / 'play' listeners behind a debug flag.
}
