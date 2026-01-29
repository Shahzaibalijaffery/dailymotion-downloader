/**
 * Download button injection module
 * Handles injecting download button into Dailymotion pages and quality menu management
 */

/**
 * Completely destroy button and all associated elements and data
 * This ensures no stale data persists when navigating between videos
 */
function destroyDownloadButton() {
  // Remove ALL existing buttons and their wrappers
  document.querySelectorAll('#vimeo-downloader-page-button-wrapper').forEach(wrapper => {
    // Clear all data attributes from button
    const downloadBtn = wrapper.querySelector('.vimeo-downloader-download-btn');
    if (downloadBtn) {
      downloadBtn.removeAttribute('data-url');
      downloadBtn.removeAttribute('data-type');
      downloadBtn.removeAttribute('data-quality-label');
      downloadBtn.removeAttribute('data-video-title');
      downloadBtn.removeAttribute('data-video-id');
    }
    
    // Clear quality menu data
    const qualityMenu = wrapper.querySelector('.vimeo-downloader-quality-menu');
    if (qualityMenu) {
      qualityMenu.innerHTML = '';
      qualityMenu.removeAttribute('data-url');
      qualityMenu.removeAttribute('data-type');
      qualityMenu.removeAttribute('data-quality-label');
      qualityMenu.removeAttribute('data-video-title');
      qualityMenu.removeAttribute('data-video-id');
    }
    
    // Remove all event listeners by cloning (removes all attached listeners)
    const clonedWrapper = wrapper.cloneNode(false);
    if (wrapper.parentNode) {
      wrapper.parentNode.replaceChild(clonedWrapper, wrapper);
      clonedWrapper.remove();
    } else {
      wrapper.remove();
    }
  });
  
  // Also remove any orphaned quality menus
  document.querySelectorAll('.vimeo-downloader-quality-menu').forEach(menu => {
    menu.innerHTML = '';
    menu.remove();
  });
  
  // Remove any orphaned buttons
  document.querySelectorAll('.vimeo-downloader-download-btn').forEach(btn => {
    btn.removeAttribute('data-url');
    btn.removeAttribute('data-type');
    btn.removeAttribute('data-quality-label');
    btn.removeAttribute('data-video-title');
    btn.removeAttribute('data-video-id');
    btn.remove();
  });
  
  // Remove any orphaned dropdown buttons
  document.querySelectorAll('.vimeo-downloader-dropdown-btn').forEach(btn => {
    btn.remove();
  });
  
  // Remove any orphaned button groups
  document.querySelectorAll('.vimeo-downloader-button-group').forEach(group => {
    group.remove();
  });
}

function injectDownloadButton() {
  // Check if extension context is valid before attempting injection
  if (!isExtensionContextValid()) {
    // Extension context invalidated - stop all injection attempts
    return;
  }
  
  // Only inject button on video pages
  if (!isVideoPage()) {
    console.log('Not a video page, skipping button injection');
    return;
  }
  // Only inject in top frame
  if (window.self !== window.top) return;
  
  // COMPLETELY destroy existing button and all associated data
  destroyDownloadButton();
  
  // Find the button container (Dailymotion specific selectors)
  // Try multiple selectors as Dailymotion's structure may vary
  const buttonContainer = document.querySelector('[class*="VideoActions"]') || 
                          document.querySelector('[class*="video-actions"]') ||
                          document.querySelector('.video-actions') ||
                          document.querySelector('[data-testid="video-actions"]');
  if (!buttonContainer) {
    // Retry with backoff; avoid hammering during React hydration (was 500ms, caused #418/#423)
    if (isExtensionContextValid()) {
      window.__dmInjectRetries = (window.__dmInjectRetries || 0) + 1;
      if (window.__dmInjectRetries <= 12) {
        setTimeout(injectDownloadButton, 2000);
      }
    }
    return;
  }
  window.__dmInjectRetries = 0;
  
  // Check if video URLs exist before injecting button
  // Use functions from pageTracking.js (loaded before this module)
  const currentVideoId = typeof getCurrentVideoId === 'function' ? getCurrentVideoId() : null;
  const currentVideoTitle = typeof getCurrentVideoTitle === 'function' ? getCurrentVideoTitle() : null;
  let retryCount = 0;
  const maxRetries = 10; // Increased retries for slow connections
  
  const tryInject = () => {
    // Check if extension context is still valid before attempting
    if (!isExtensionContextValid()) {
      // Extension context invalidated - stop trying
      return;
    }
    
    // Also check if page is still loading - if so, wait a bit longer
    const isPageLoading = document.readyState !== 'complete';
    
    // Suppress warnings for injection attempts (expected when extension is reloaded)
    safeSendMessage({ 
      action: 'getVideoData', 
      tabId: null 
    }, (response) => {
      // Check again after async operation
      if (!isExtensionContextValid()) {
        return;
      }
      if (!response || !response.videoData || !response.videoData.urls || response.videoData.urls.length === 0) {
        // No videos detected yet, retry with exponential backoff
        // If page is still loading, retry more aggressively
        if (retryCount < maxRetries) {
          retryCount++;
          // Use shorter delays if page is still loading (1s, 1.5s, 2s...)
          // Otherwise use longer delays (2s, 3s, 4s...)
          const baseDelay = isPageLoading ? 1000 : 2000;
          const delay = baseDelay + (retryCount * (isPageLoading ? 500 : 1000));
          setTimeout(tryInject, delay);
          console.log(`Button injection retry ${retryCount}/${maxRetries} (page loading: ${isPageLoading}, delay: ${delay}ms)`);
        } else {
          console.log('Button injection: Max retries reached, video data not available');
        }
        return;
      }
      
      // If we have a current video title, check if we have data matching it
      let hasCurrentVideo = false;
      if (currentVideoTitle) {
        // Normalize title for comparison (remove extra spaces, lowercase)
        const normalizedTitle = currentVideoTitle.toLowerCase().trim().replace(/\s+/g, ' ');
        hasCurrentVideo = response.videoData.urls.some(v => {
          if (v.videoTitle) {
            const normalizedVideoTitle = v.videoTitle.toLowerCase().trim().replace(/\s+/g, ' ');
            return normalizedVideoTitle === normalizedTitle;
          }
          return false;
        });
        
        // Also check videoIds mapping
        if (!hasCurrentVideo && response.videoData.videoIds) {
          hasCurrentVideo = Object.values(response.videoData.videoIds).some(videoInfo => {
            if (videoInfo.title) {
              const normalizedVideoTitle = videoInfo.title.toLowerCase().trim().replace(/\s+/g, ' ');
              return normalizedVideoTitle === normalizedTitle;
            }
            return false;
          });
        }
      }
      
      // Fallback to video ID matching if title matching didn't work
      if (!hasCurrentVideo && currentVideoId) {
        hasCurrentVideo = response.videoData.urls.some(v => 
          v.videoId && String(v.videoId) === String(currentVideoId)
        );
      }
      
      // If no data for current video yet, retry (but don't block if we have any videos)
      // Only retry if we have NO videos at all, or if we specifically need the current video
      const hasAnyVideos = response.videoData.urls && response.videoData.urls.length > 0;
      
      if (!hasAnyVideos && retryCount < maxRetries) {
        // No videos at all, retry
        retryCount++;
        setTimeout(tryInject, 2000 * retryCount);
        return;
      }
      
      // If we have videos but they don't match current video, still proceed (will use most recent)
      // Only retry if we specifically need the current video and have time
      if (hasAnyVideos && (currentVideoTitle || currentVideoId) && !hasCurrentVideo && retryCount < 2) {
        // Give it one more try to get the current video data
        retryCount++;
        setTimeout(tryInject, 2000);
        return;
      }
      
      retryCount = 0; // Reset retry count on success
      
      // Filter to check if there are any valid video URLs
      const reliableUrls = response.videoData.urls.filter(v => {
        if (v.type && v.type.includes('mp4-full')) return false;
        if (v.type === 'config' || v.url.includes('master.json') || v.url.includes('config')) return false;
        if (v.type === 'hls-master' || (v.type && v.type.includes('hls-master'))) return false;
        if (v.type && (v.type.includes('hls') || v.type.includes('m3u8'))) {
          const hasQualityInType = v.type.match(/hls-(\d+)p?/i) || v.type.match(/(\d+)p/i);
          if (!hasQualityInType) return false;
        }
        return true;
      });
      
      if (reliableUrls.length === 0) {
        // No valid videos detected yet, retry after a delay
        if (retryCount < maxRetries) {
          retryCount++;
          setTimeout(tryInject, 2000 * retryCount);
        }
        return;
      }
      
      // Videos found, proceed with button injection
      injectButtonElement(buttonContainer);
    });
  };
  
  tryInject();
}

// Separate function to actually inject the button element
function injectButtonElement(buttonContainer) {
  // Only inject button on video pages
  if (!isVideoPage()) {
    console.log('Not a video page, skipping button injection');
    return;
  }
  // Double-check: Completely destroy any existing buttons before injecting (safety check)
  destroyDownloadButton();
  // Add styles for the download button
  if (!document.getElementById('vimeo-downloader-button-styles')) {
    const style = document.createElement('style');
    style.id = 'vimeo-downloader-button-styles';
    style.textContent = `
      #vimeo-downloader-page-button-wrapper {
        position: relative;
      
      }
      
      .vimeo-downloader-button-group {
        position: relative;
        display: flex;
        border-radius: 8px;
        overflow: visible !important;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
   
      }
      
      /* Ensure parent containers don't clip the dropdown */
      .css-rrm59m {
        overflow: visible !important;
      }
      
      .chakra-stack.css-tistzx {
        overflow: visible !important;
      }
      
      .vimeo-downloader-download-btn {
        flex: 1;
        min-width: 0;
        background: rgb(14, 18, 22);
        color: white;
        border: none;
        border-radius: 0;
        border-top-left-radius: 8px;
        border-bottom-left-radius: 8px;
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
        margin: 0;
        padding: 6px 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
      }
      
      .vimeo-downloader-download-btn:hover {
        background: rgb(20, 24, 28);
      }
      
      .vimeo-downloader-download-btn .download-icon {
        display: none;
      }
      
      @media (max-width: 600px) {
        [data-testid="action-bar"] {
          overflow-x: scroll;
          overflow-y: visible;
          -webkit-overflow-scrolling: touch;
        }
        
        [data-testid="action-bar"] .chakra-stack {
          overflow-y: visible !important;
        }
        
        .vimeo-downloader-download-btn {
          padding: 6px 8px;
          min-width: 40px;
        }
        
        .vimeo-downloader-download-btn .download-text {
          display: none;
        }
        
        .vimeo-downloader-download-btn .download-icon {
          display: inline-block;
          width: 16px;
          height: 16px;
        }
      }
      
      .vimeo-downloader-dropdown-btn {
        flex: 0 0 auto;
        width: 32px;
        padding: 10px 8px;
        background: rgb(14, 18, 22);
        color: white;
        border: none;
        border-left: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 0;
        border-top-right-radius: 8px;
        border-bottom-right-radius: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      }
      
      .vimeo-downloader-dropdown-btn:hover {
        background: rgb(20, 24, 28);
      }
      
      .vimeo-downloader-dropdown-btn svg {
        pointer-events: none;
      }
      
      .vimeo-downloader-quality-menu {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        background: white;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        max-height: 200px;
        overflow-y: auto;
        z-index: 999999 !important;
        display: none;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
        padding: 4px 0;
        min-width: 200px;
        max-width: calc(100vw - 16px);
        box-sizing: border-box;
      }
      
      @media (max-width: 600px) {
        .vimeo-downloader-quality-menu {
          max-width: calc(100vw - 16px) !important;
        }
      }
      
      .vimeo-downloader-quality-menu.show {
        display: block !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        visibility: visible !important;
      }
      
      .vimeo-downloader-quality-item {
        padding: 10px 16px;
        cursor: pointer;
        font-size: 13px;
        color: #333;
        transition: background-color 0.2s;
        border-bottom: 1px solid #f0f0f0;
      }
      
      .vimeo-downloader-quality-item:last-child {
        border-bottom: none;
      }
      
      .vimeo-downloader-quality-item:hover {
        background-color: #f5f5f5;
      }
      
      .vimeo-downloader-quality-item.selected {
        background-color: rgb(14, 18, 22);
        color: white;
        font-weight: 600;
      }
      
      .vimeo-downloader-quality-item.selected:hover {
        background-color: rgb(20, 24, 28);
      }
    `;
    document.head.appendChild(style);
  }
  
  // Create wrapper
  const buttonWrapper = document.createElement('div');
  buttonWrapper.id = 'vimeo-downloader-page-button-wrapper';
  buttonWrapper.className = 'css-rrm59m';
  
  // Create button group
  const buttonGroup = document.createElement('div');
  buttonGroup.className = 'vimeo-downloader-button-group';
  
  // Create main download button
  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'vimeo-downloader-download-btn';
  downloadBtn.innerHTML = `
    <span class="download-text">Download</span>
    <svg class="download-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 2V10M8 10L5 7M8 10L11 7M3 12H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
  
  // Create dropdown button
  const dropdownBtn = document.createElement('button');
  dropdownBtn.className = 'vimeo-downloader-dropdown-btn';
  dropdownBtn.setAttribute('aria-label', 'Select quality');
  dropdownBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
  
  // Create quality dropdown menu
  const qualityMenu = document.createElement('div');
  qualityMenu.className = 'vimeo-downloader-quality-menu';
  
  
  // Function to populate quality menu - SIMPLIFIED
  // Note: getCurrentVideoId and getCurrentVideoTitle are from pageTracking.js
  // Track retry state for quality menu
  let menuRetryCount = 0;
  const maxMenuRetries = 5;
  
  const populateQualityMenu = (isRetry = false) => {
    if (!isRetry) {
      qualityMenu.innerHTML = '';
      menuRetryCount = 0;
    }
    
    // Use functions from pageTracking.js (loaded before this module)
    const currentVideoTitle = typeof getCurrentVideoTitle === 'function' ? getCurrentVideoTitle() : null;
    const currentVideoId = typeof getCurrentVideoId === 'function' ? getCurrentVideoId() : null;
    
    // CRITICAL: Verify button still belongs to current video before populating menu
    const buttonVideoId = downloadBtn.getAttribute('data-video-id');
    if (currentVideoId && buttonVideoId && String(currentVideoId) !== String(buttonVideoId)) {
      console.warn('⚠️ Video ID mismatch in populateQualityMenu! Button belongs to different video. Destroying and recreating...', {
        currentVideoId,
        buttonVideoId
      });
      destroyDownloadButton();
      setTimeout(() => {
        if (typeof injectDownloadButton === 'function') {
          injectDownloadButton();
        }
      }, 500);
      return;
    }
    
    // Get video data to populate quality menu (pass null for tabId, background will find it)
    safeSendMessage({ 
      action: 'getVideoData', 
      tabId: null 
    }, (response) => {
      if (!response || !response.videoData || !response.videoData.urls || response.videoData.urls.length === 0) {
        // If no videos and we haven't exceeded retries, show loading and retry
        if (menuRetryCount < maxMenuRetries && document.readyState !== 'complete') {
          menuRetryCount++;
          const menuItem = document.createElement('div');
          menuItem.className = 'vimeo-downloader-quality-item';
          menuItem.textContent = `Loading videos... (${menuRetryCount}/${maxMenuRetries})`;
          menuItem.style.cursor = 'default';
          menuItem.style.opacity = '0.5';
          qualityMenu.innerHTML = '';
          qualityMenu.appendChild(menuItem);
          // Retry after delay
          setTimeout(() => populateQualityMenu(true), 1500);
          return;
        }
        // Max retries reached or page loaded - show no videos message
        const menuItem = document.createElement('div');
        menuItem.className = 'vimeo-downloader-quality-item';
        menuItem.textContent = 'No videos detected yet';
        menuItem.style.cursor = 'default';
        menuItem.style.opacity = '0.5';
        qualityMenu.innerHTML = '';
        qualityMenu.appendChild(menuItem);
        return;
      }
      
      // Reset retry count on success
      menuRetryCount = 0;
      
      // Use same filtering logic as popup
      const reliableUrls = response.videoData.urls.filter(v => {
        // Hide mp4-full - they're extracted from range URLs and often incomplete
        if (v.type && v.type.includes('mp4-full')) {
          return false;
        }
        // Hide config files
        if (v.type === 'config' || v.url.includes('master.json') || v.url.includes('config')) {
          return false;
        }
        // Hide HLS master playlists
        if (v.type === 'hls-master' || (v.type && v.type.includes('hls-master'))) {
          return false;
        }
        // Hide any HLS URL that doesn't have a specific quality
        if (v.type && (v.type.includes('hls') || v.type.includes('m3u8'))) {
          const hasQualityInType = v.type.match(/hls-(\d+)p?/i) || v.type.match(/(\d+)p/i);
          if (!hasQualityInType) {
            return false;
          }
        }
        
        // Filter out files smaller than 300KB (likely thumbnails, metadata, or incomplete files)
        const MIN_FILE_SIZE = 300 * 1024; // 300KB in bytes
        if (v.fileSize !== null && v.fileSize !== undefined) {
          if (v.fileSize < MIN_FILE_SIZE) {
            return false; // File is too small, skip it
          }
        }
        // If fileSize is null/undefined (unknown), we still show it (HLS playlists don't have known size)
        
        return true;
      });
      
      if (reliableUrls.length === 0) {
        const menuItem = document.createElement('div');
        menuItem.className = 'vimeo-downloader-quality-item';
        menuItem.textContent = 'No videos detected yet';
        menuItem.style.cursor = 'default';
        menuItem.style.opacity = '0.5';
        qualityMenu.appendChild(menuItem);
        return;
      }
      
      // Try to filter by current video, but always fall back to all reliable URLs
      let filteredUrls = reliableUrls;
      
      // First, try to match by title if we have one
      if (currentVideoTitle) {
        const normalizedTitle = currentVideoTitle.toLowerCase().trim().replace(/\s+/g, ' ');
        
        // Try matching by videoTitle in URLs
        const titleMatches = reliableUrls.filter(v => {
          if (v.videoTitle) {
            const normalizedVideoTitle = v.videoTitle.toLowerCase().trim().replace(/\s+/g, ' ');
            return normalizedVideoTitle === normalizedTitle;
          }
          return false;
        });
        
        if (titleMatches.length > 0) {
          filteredUrls = titleMatches;
        } else if (response.videoData.videoIds) {
          // Try matching via videoIds mapping
          const matchingVideoId = Object.entries(response.videoData.videoIds).find(([id, info]) => {
            if (info.title) {
              const normalizedVideoTitle = info.title.toLowerCase().trim().replace(/\s+/g, ' ');
              return normalizedVideoTitle === normalizedTitle;
            }
            return false;
          });
          
          if (matchingVideoId) {
            const matchedId = matchingVideoId[0];
            const idMatches = reliableUrls.filter(v => 
              v.videoId && String(v.videoId) === String(matchedId)
            );
            if (idMatches.length > 0) {
              filteredUrls = idMatches;
            }
          }
        }
      }
      
      // If still no matches and we have a video ID, try matching by ID
      if (filteredUrls.length === 0 && currentVideoId) {
        const idMatches = reliableUrls.filter(v => 
          v.videoId && String(v.videoId) === String(currentVideoId)
        );
        if (idMatches.length > 0) {
          filteredUrls = idMatches;
        }
      }
      
      // Always fall back to all reliable URLs if filtering resulted in nothing
      if (filteredUrls.length === 0) {
        filteredUrls = reliableUrls;
      }
      
      // Group by videoId
      const groupedVideos = {};
      filteredUrls.forEach(video => {
        const key = video.videoId || video.url.split('?')[0];
        if (!groupedVideos[key]) {
          groupedVideos[key] = [];
        }
        groupedVideos[key].push(video);
      });
      
      // Get the group for the current video (prioritize title match, then videoId)
      let videoGroup = [];
      if (currentVideoTitle) {
        // Try to find group with matching title
        const normalizedTitle = currentVideoTitle.toLowerCase().trim().replace(/\s+/g, ' ');
        const matchingGroup = Object.entries(groupedVideos).find(([key, videos]) => {
          return videos.some(v => {
            if (v.videoTitle) {
              const normalizedVideoTitle = v.videoTitle.toLowerCase().trim().replace(/\s+/g, ' ');
              return normalizedVideoTitle === normalizedTitle;
            }
            return false;
          });
        });
        if (matchingGroup) {
          videoGroup = matchingGroup[1];
        }
      }
      
      // If no title match, try video ID match
      if (videoGroup.length === 0 && currentVideoId) {
        const matchingGroup = Object.entries(groupedVideos).find(([key, videos]) => {
          return videos.some(v => v.videoId && String(v.videoId) === String(currentVideoId));
        });
        if (matchingGroup) {
          videoGroup = matchingGroup[1];
        }
      }
      
      // If no match found, get the most recent group (by timestamp)
      if (videoGroup.length === 0) {
        const sortedGroups = Object.entries(groupedVideos).sort((a, b) => {
          const aMaxTime = Math.max(...a[1].map(v => v.timestamp || 0), 0);
          const bMaxTime = Math.max(...b[1].map(v => v.timestamp || 0), 0);
          return bMaxTime - aMaxTime;
        });
        videoGroup = sortedGroups[0] ? sortedGroups[0][1] : [];
      }
      
      // If still no group, use all filtered URLs directly (don't group)
      if (videoGroup.length === 0 && filteredUrls.length > 0) {
        videoGroup = filteredUrls;
      }
      
      if (videoGroup.length === 0) {
        const menuItem = document.createElement('div');
        menuItem.className = 'vimeo-downloader-quality-item';
        menuItem.textContent = 'No videos detected yet';
        menuItem.style.cursor = 'default';
        menuItem.style.opacity = '0.5';
        qualityMenu.appendChild(menuItem);
        return;
      }
      
      // Sort by quality (prefer MP4, then highest quality)
      const sortedQualities = videoGroup.sort((a, b) => {
        const aIsMP4 = a.type && a.type.includes('mp4') && !a.type.includes('m3u8');
        const bIsMP4 = b.type && b.type.includes('mp4') && !b.type.includes('m3u8');
        if (aIsMP4 && !bIsMP4) return -1;
        if (!aIsMP4 && bIsMP4) return 1;
        
        const qualityA = extractQuality(a.type, a.url) || 0;
        const qualityB = extractQuality(b.type, b.url) || 0;
        return qualityB - qualityA;
      });
      
      // Deduplicate by quality AND type (keep one MP4 and one HLS per quality)
      const uniqueQualities = new Map();
      sortedQualities.forEach((video) => {
        const quality = extractQuality(video.type, video.url);
        if (!quality) {
          // Still include videos without quality if they're MP4
          const isMP4 = video.type && video.type.includes('mp4') && !video.type.includes('m3u8');
          if (isMP4) {
            const key = 'MP4-unknown';
            if (!uniqueQualities.has(key)) {
              uniqueQualities.set(key, video);
            }
          }
          return;
        }
        
        const isMP4 = video.type && video.type.includes('mp4') && !video.type.includes('m3u8');
        const isHLS = video.type && (video.type.includes('m3u8') || video.type.includes('hls'));
        const key = `${quality}-${isMP4 ? 'MP4' : isHLS ? 'HLS' : 'OTHER'}`;
        
        if (!uniqueQualities.has(key)) {
          uniqueQualities.set(key, video);
        }
      });
      
      const deduplicatedQualities = Array.from(uniqueQualities.values());
      
      if (deduplicatedQualities.length === 0) {
        const menuItem = document.createElement('div');
        menuItem.className = 'vimeo-downloader-quality-item';
        menuItem.textContent = 'No videos detected yet';
        menuItem.style.cursor = 'default';
        menuItem.style.opacity = '0.5';
        qualityMenu.appendChild(menuItem);
        return;
      }
      
      // Get video title - prioritize current video title from webpage DOM
      let videoTitle = 'Vimeo Video';
      if (currentVideoTitle) {
        // Use the title from the webpage (most accurate)
        videoTitle = currentVideoTitle;
      } else if (currentVideoId && response.videoData.videoIds && response.videoData.videoIds[currentVideoId]) {
        videoTitle = response.videoData.videoIds[currentVideoId].title || videoTitle;
      } else if (deduplicatedQualities[0]?.videoTitle) {
        videoTitle = deduplicatedQualities[0].videoTitle;
      } else if (response.videoData.videoIds && Object.keys(response.videoData.videoIds).length > 0) {
        // Get title from the most recent video ID (by timestamp)
        const videoIds = Object.entries(response.videoData.videoIds);
        const sortedIds = videoIds.sort((a, b) => {
          const aTime = a[1].timestamp || 0;
          const bTime = b[1].timestamp || 0;
          return bTime - aTime;
        });
        if (sortedIds[0] && sortedIds[0][1].title) {
          videoTitle = sortedIds[0][1].title;
        }
      } else if (response.videoData.videoTitle) {
        videoTitle = response.videoData.videoTitle;
      }
      
      // Get current selected URL from button (if any) to preserve selection
      // BUT: Only preserve if we're still on the same video (check videoId)
      const currentSelectedUrl = downloadBtn.getAttribute('data-url');
      const buttonVideoId = downloadBtn.getAttribute('data-video-id');
      let selectedIndex = 0; // Default to first item
      
      // Only preserve selection if we're on the same video
      if (currentSelectedUrl && deduplicatedQualities.length > 0 && 
          currentVideoId && buttonVideoId && 
          String(currentVideoId) === String(buttonVideoId)) {
        // Same video - try to preserve selection
        const matchingIndex = deduplicatedQualities.findIndex(v => v && v.url === currentSelectedUrl);
        if (matchingIndex >= 0) {
          selectedIndex = matchingIndex;
        }
      } else {
        // Different video or no videoId match - reset to first item
        // Clear old button data to prevent using stale URLs
        downloadBtn.removeAttribute('data-url');
        downloadBtn.removeAttribute('data-type');
        downloadBtn.removeAttribute('data-quality-label');
        downloadBtn.removeAttribute('data-video-title');
        downloadBtn.removeAttribute('data-video-id');
        selectedIndex = 0;
      }
      
      // Set button data - ALWAYS include current video ID to prevent stale data
      if (deduplicatedQualities.length > 0 && deduplicatedQualities[0] && deduplicatedQualities[0].url) {
        // Use selected video or first video
        const selectedVideo = deduplicatedQualities[selectedIndex] || deduplicatedQualities[0];
        
        // CRITICAL: Always set current video ID to prevent downloading wrong video
        // If currentVideoId doesn't match, don't set the URL
        if (currentVideoId) {
          downloadBtn.setAttribute('data-video-id', currentVideoId);
        } else {
          // If we can't get current video ID, clear all data to prevent stale downloads
          console.warn('⚠️ Cannot get current video ID, clearing button data to prevent stale downloads');
          downloadBtn.removeAttribute('data-url');
          downloadBtn.removeAttribute('data-type');
          downloadBtn.removeAttribute('data-quality-label');
          downloadBtn.removeAttribute('data-video-title');
          downloadBtn.removeAttribute('data-video-id');
          return;
        }
        
        downloadBtn.setAttribute('data-url', selectedVideo.url);
        downloadBtn.setAttribute('data-type', selectedVideo.type || '');
        downloadBtn.setAttribute('data-quality-label', formatQualityLabel(selectedVideo));
        downloadBtn.setAttribute('data-video-title', videoTitle);
        
        // Populate menu
        deduplicatedQualities.forEach((video, idx) => {
          if (!video || !video.url) return;
          const qualityLabel = formatQualityLabel(video);
          const menuItem = document.createElement('div');
          menuItem.className = 'vimeo-downloader-quality-item' + (idx === selectedIndex ? ' selected' : '');
          menuItem.textContent = `${videoTitle} - ${qualityLabel}`;
          menuItem.setAttribute('data-url', video.url);
          menuItem.setAttribute('data-type', video.type || '');
          menuItem.setAttribute('data-quality-label', qualityLabel);
          menuItem.setAttribute('data-video-title', videoTitle);
          qualityMenu.appendChild(menuItem);
        });
      }
    });
  };
  
  // Initial population
  populateQualityMenu();
  
  // Toggle dropdown
  dropdownBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const isShowing = qualityMenu.classList.contains('show');
    
    // Close all other dropdowns
    document.querySelectorAll('.vimeo-downloader-quality-menu').forEach(menu => {
      if (menu !== qualityMenu) {
        menu.classList.remove('show');
        menu.style.display = 'none';
      }
    });
    
    if (isShowing) {
      qualityMenu.classList.remove('show');
      qualityMenu.style.display = 'none';
    } else {
      // Always refresh menu data when opening to get latest video data (handles navigation)
      // Clear menu first to show loading state
      qualityMenu.innerHTML = '';
      const loadingItem = document.createElement('div');
      loadingItem.className = 'vimeo-downloader-quality-item';
      loadingItem.textContent = 'Loading...';
      loadingItem.style.cursor = 'default';
      loadingItem.style.opacity = '0.5';
      qualityMenu.appendChild(loadingItem);
      
      // Then populate with fresh data
      populateQualityMenu();
      
      // Calculate position after menu is populated (use setTimeout to ensure DOM is updated)
      setTimeout(() => {
        // Calculate position for fixed positioning on mobile
        if (window.innerWidth <= 600) {
          const buttonRect = buttonGroup.getBoundingClientRect();
          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;
          const padding = 8; // Minimum padding from screen edges
          
          // Temporarily show menu to measure it
          qualityMenu.style.visibility = 'hidden';
          qualityMenu.style.display = 'block';
          qualityMenu.style.position = 'fixed';
          qualityMenu.style.left = '0';
          qualityMenu.style.top = '0';
          const menuRect = qualityMenu.getBoundingClientRect();
          const menuHeight = menuRect.height || 200; // Fallback if not measured
          const menuNaturalWidth = menuRect.width || buttonRect.width;
          
          // Calculate menu width (don't exceed viewport)
          const maxMenuWidth = viewportWidth - (padding * 2);
          const menuWidth = Math.min(menuNaturalWidth, maxMenuWidth, buttonRect.width);
          
          // Calculate horizontal position (ensure it doesn't go off right edge)
          let leftPos = buttonRect.left;
          
          // Check if menu would overflow right edge
          if (leftPos + menuWidth > viewportWidth - padding) {
            leftPos = viewportWidth - menuWidth - padding;
          }
          
          // Ensure menu doesn't go off left edge
          if (leftPos < padding) {
            leftPos = padding;
          }
          
          // Final check: ensure menu fits within viewport
          if (leftPos + menuWidth > viewportWidth) {
            leftPos = Math.max(padding, viewportWidth - menuWidth - padding);
          }
          
          // Calculate vertical position (prefer below, but show above if not enough space)
          let topPos = buttonRect.bottom + 4;
          const spaceBelow = viewportHeight - buttonRect.bottom;
          const spaceAbove = buttonRect.top;
          
          if (spaceBelow < menuHeight + 4 && spaceAbove > spaceBelow) {
            // Show above button if there's more space above
            topPos = buttonRect.top - menuHeight - 4;
          }
          
          // Ensure dropdown doesn't go below viewport
          if (topPos + menuHeight > viewportHeight - padding) {
            topPos = viewportHeight - menuHeight - padding;
          }
          
          // Ensure dropdown doesn't go above viewport
          if (topPos < padding) {
            topPos = padding;
          }
          
          qualityMenu.style.position = 'fixed';
          qualityMenu.style.top = `${topPos}px`;
          qualityMenu.style.left = `${leftPos}px`;
          qualityMenu.style.right = 'auto';
          qualityMenu.style.width = `${menuWidth}px`;
          qualityMenu.style.maxWidth = `${viewportWidth - (padding * 2)}px`;
          qualityMenu.style.maxHeight = `${viewportHeight - topPos - padding}px`;
          qualityMenu.style.visibility = 'visible';
          
          // Double-check: if menu still overflows, adjust using right property
          setTimeout(() => {
            const finalRect = qualityMenu.getBoundingClientRect();
            if (finalRect.right > viewportWidth - padding) {
              const overflow = finalRect.right - (viewportWidth - padding);
              qualityMenu.style.left = `${Math.max(padding, leftPos - overflow)}px`;
            }
          }, 0);
        } else {
          qualityMenu.style.position = 'absolute';
          qualityMenu.style.top = 'calc(100% + 4px)';
          qualityMenu.style.left = '0';
          qualityMenu.style.right = '0';
          qualityMenu.style.width = 'auto';
          qualityMenu.style.maxHeight = '';
        }
        
        qualityMenu.classList.add('show');
        qualityMenu.style.display = 'block';
        qualityMenu.style.opacity = '1';
        qualityMenu.style.visibility = 'visible';
        qualityMenu.style.zIndex = '999999';
      }, 50); // Small delay to ensure menu is populated
    }
  });
  
  // Handle quality selection
  qualityMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.vimeo-downloader-quality-item');
    if (!item || item.style.cursor === 'default') return;
    
    e.stopPropagation();
    
    // Update selected item
    qualityMenu.querySelectorAll('.vimeo-downloader-quality-item').forEach(i => {
      i.classList.remove('selected');
    });
    item.classList.add('selected');
    
    // Update download button
    const url = item.getAttribute('data-url');
    const type = item.getAttribute('data-type');
    const qualityLabel = item.getAttribute('data-quality-label');
    const videoTitle = item.getAttribute('data-video-title');
    
    if (url) {
      // CRITICAL: Always verify and set current video ID when updating from menu selection
      const currentVideoId = typeof getCurrentVideoId === 'function' ? getCurrentVideoId() : null;
      if (currentVideoId) {
        downloadBtn.setAttribute('data-video-id', currentVideoId);
      } else {
        console.warn('⚠️ Cannot get current video ID when selecting quality, clearing button data');
        downloadBtn.removeAttribute('data-url');
        downloadBtn.removeAttribute('data-type');
        downloadBtn.removeAttribute('data-quality-label');
        downloadBtn.removeAttribute('data-video-title');
        downloadBtn.removeAttribute('data-video-id');
        return;
      }
      
      downloadBtn.setAttribute('data-url', url);
      downloadBtn.setAttribute('data-type', type);
      downloadBtn.setAttribute('data-quality-label', qualityLabel);
      if (videoTitle) {
        downloadBtn.setAttribute('data-video-title', videoTitle);
      }
    }
    
    // Close menu
    qualityMenu.classList.remove('show');
    qualityMenu.style.display = 'none';
  });
  
  // Update dropdown position on scroll (for mobile with overflow scroll)
  const updateDropdownPosition = () => {
    if (window.innerWidth <= 600 && qualityMenu.classList.contains('show')) {
      const buttonRect = buttonGroup.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const padding = 8; // Minimum padding from screen edges
      
      const menuHeight = qualityMenu.offsetHeight || 200; // Fallback height
      const menuNaturalWidth = qualityMenu.offsetWidth || buttonRect.width;
      
      // Calculate menu width (don't exceed viewport)
      const maxMenuWidth = viewportWidth - (padding * 2);
      const menuWidth = Math.min(menuNaturalWidth, maxMenuWidth, buttonRect.width);
      
      // Calculate horizontal position (ensure it doesn't go off right edge)
      let leftPos = buttonRect.left;
      
      // Check if menu would overflow right edge
      if (leftPos + menuWidth > viewportWidth - padding) {
        leftPos = viewportWidth - menuWidth - padding;
      }
      
      // Ensure menu doesn't go off left edge
      if (leftPos < padding) {
        leftPos = padding;
      }
      
      // Final check: ensure menu fits within viewport
      if (leftPos + menuWidth > viewportWidth) {
        leftPos = Math.max(padding, viewportWidth - menuWidth - padding);
      }
      
      // Calculate vertical position (prefer below, but show above if not enough space)
      let topPos = buttonRect.bottom + 4;
      const spaceBelow = viewportHeight - buttonRect.bottom;
      const spaceAbove = buttonRect.top;
      
      if (spaceBelow < menuHeight + 4 && spaceAbove > spaceBelow) {
        // Show above button if there's more space above
        topPos = buttonRect.top - menuHeight - 4;
      }
      
      // Ensure dropdown doesn't go below viewport
      if (topPos + menuHeight > viewportHeight - padding) {
        topPos = viewportHeight - menuHeight - padding;
      }
      
      // Ensure dropdown doesn't go above viewport
      if (topPos < padding) {
        topPos = padding;
      }
      
      qualityMenu.style.top = `${topPos}px`;
      qualityMenu.style.left = `${leftPos}px`;
      qualityMenu.style.width = `${menuWidth}px`;
      qualityMenu.style.maxWidth = `${viewportWidth - (padding * 2)}px`;
      qualityMenu.style.maxHeight = `${viewportHeight - topPos - padding}px`;
      
      // Double-check: if menu still overflows, adjust using right property
      setTimeout(() => {
        const finalRect = qualityMenu.getBoundingClientRect();
        if (finalRect.right > viewportWidth - padding) {
          const overflow = finalRect.right - (viewportWidth - padding);
          qualityMenu.style.left = `${Math.max(padding, leftPos - overflow)}px`;
        }
      }, 0);
    }
  };
  
  // Listen for scroll on action bar
  const actionBar = document.querySelector('[data-testid="action-bar"]');
  if (actionBar) {
    actionBar.addEventListener('scroll', updateDropdownPosition);
  }
  
  // Listen for window resize
  window.addEventListener('resize', updateDropdownPosition);
  
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    // Only close if dropdown is open and click is outside the button group
    if (qualityMenu.classList.contains('show') && !buttonGroup.contains(e.target)) {
      qualityMenu.classList.remove('show');
      qualityMenu.style.display = 'none';
    }
  });
  
  // Handle download button click
  downloadBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const url = downloadBtn.getAttribute('data-url');
    const type = downloadBtn.getAttribute('data-type');
    const qualityLabel = downloadBtn.getAttribute('data-quality-label');
    const buttonVideoId = downloadBtn.getAttribute('data-video-id');
    const currentVideoId = typeof getCurrentVideoId === 'function' ? getCurrentVideoId() : null;
    
    // CRITICAL: Verify URL belongs to current video - if not, destroy and recreate button
    if (url && currentVideoId && buttonVideoId && String(currentVideoId) !== String(buttonVideoId)) {
      console.warn('⚠️ Button URL belongs to different video! Destroying button and recreating...', {
        buttonVideoId,
        currentVideoId,
        url: url.substring(0, 50) + '...'
      });
      // Completely destroy button and recreate it
      destroyDownloadButton();
      // Re-inject button with fresh data
      setTimeout(() => {
        if (typeof injectDownloadButton === 'function') {
          injectDownloadButton();
        }
      }, 500);
      return;
    }
    
    // Additional safety: If we have a current video ID but button doesn't have one, or vice versa, recreate button
    if (currentVideoId && !buttonVideoId) {
      console.warn('⚠️ Button missing video ID but current page has one. Recreating button...');
      destroyDownloadButton();
      setTimeout(() => {
        if (typeof injectDownloadButton === 'function') {
          injectDownloadButton();
        }
      }, 500);
      return;
    }
    
    if (!url) {
      // Instead of alert, try to refresh the button data
      if (DEBUG) console.log('No video URL available, refreshing button data...');
      
      // Try to repopulate the menu and get fresh data
      const qualityMenu = buttonWrapper.querySelector('.vimeo-downloader-quality-menu');
      if (qualityMenu) {
        // Trigger menu population which will update button data
        const populateQualityMenu = window.vimeoDownloaderPopulateQualityMenu;
        if (populateQualityMenu) {
          populateQualityMenu();
        } else {
          // Fallback: re-inject button
          setTimeout(() => {
            injectDownloadButton();
          }, 1000);
        }
      } else {
        // Fallback: re-inject button
        setTimeout(() => {
          injectDownloadButton();
        }, 1000);
      }
      return;
    }
    
    // Get video title from button attribute or fetch from background
    let videoTitle = downloadBtn.getAttribute('data-video-title');
    
    if (!videoTitle) {
      // Fallback: get from background
      safeSendMessage({ 
        action: 'getVideoData', 
        tabId: null 
      }, (response) => {
        if (response && response.videoData) {
          videoTitle = response.videoData.videoTitle || 
                      (response.videoData.videoIds && Object.values(response.videoData.videoIds)[0]?.title) ||
                      'Vimeo Video';
          triggerDownload(url, type, qualityLabel, videoTitle);
        } else {
          triggerDownload(url, type, qualityLabel, 'Vimeo Video');
        }
      });
    } else {
      triggerDownload(url, type, qualityLabel, videoTitle);
    }
    
    function triggerDownload(url, type, qualityLabel, videoTitle) {
      // FINAL SAFETY CHECK: Verify video ID matches before downloading
      const currentVideoId = typeof getCurrentVideoId === 'function' ? getCurrentVideoId() : null;
      const buttonVideoId = downloadBtn.getAttribute('data-video-id');
      
      if (currentVideoId && buttonVideoId && String(currentVideoId) !== String(buttonVideoId)) {
        console.error('❌ CRITICAL: Video ID mismatch detected at download trigger! Aborting download.', {
          currentVideoId,
          buttonVideoId,
          url: url.substring(0, 50) + '...'
        });
        // Destroy button and recreate it
        destroyDownloadButton();
        setTimeout(() => {
          if (typeof injectDownloadButton === 'function') {
            injectDownloadButton();
          }
        }, 500);
        return;
      }
      
      const extension = url.includes('.mp4') ? 'mp4' : (url.includes('.m3u8') ? 'm3u8' : 'mp4');
      const sanitizedTitle = videoTitle.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
      const filename = qualityLabel ? 
        `${sanitizedTitle} - ${qualityLabel}.${extension}` : 
        `${sanitizedTitle}.${extension}`;
      
      // Trigger download
      safeSendMessage({
        action: 'download',
        url: url,
        type: type,
        filename: filename,
        qualityLabel: qualityLabel,
        // Send correct dailymotion videoId for restore filtering
        videoId: currentVideoId
      }, (downloadResponse) => {
        if (downloadResponse && downloadResponse.success) {
          if (DEBUG) console.log('Download started from page button');
        } else if (downloadResponse && downloadResponse.error) {
          // Only show alert for actual errors, not for cancellations or duplicates
          const errorMsg = downloadResponse.error.toLowerCase();
          if (!errorMsg.includes('already being downloaded') && 
              !errorMsg.includes('duplicate') &&
              !errorMsg.includes('cancelled') &&
              !errorMsg.includes('cancel')) {
            // Only show alert for real failures
            if (DEBUG) console.log('Download failed:', downloadResponse.error);
            // Don't show alert - silently fail
          }
        }
        // If no response or no success, silently fail (don't show alert)
      });
    }
  });
  
  // Assemble button group
  buttonGroup.appendChild(downloadBtn);
  buttonGroup.appendChild(dropdownBtn);
  buttonGroup.appendChild(qualityMenu);
  buttonWrapper.appendChild(buttonGroup);
  
  // Insert into Vimeo's button container
  buttonContainer.appendChild(buttonWrapper);
  
  const DEBUG = false; // Can be made configurable
  if (DEBUG) console.log('Download button injected into Dailymotion page');
}
