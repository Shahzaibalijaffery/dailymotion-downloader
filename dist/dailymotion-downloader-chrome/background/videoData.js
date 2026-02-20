async function getVideoTitleFromDailymotionApi(videoId) {
  if (!videoId || typeof videoId !== "string") return null;
  try {
    const url = `https://www.dailymotion.com/services/oembed?url=https://www.dailymotion.com/video/${encodeURIComponent(videoId)}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const title = j && typeof j.title === "string" ? j.title.trim() : null;
    if (title) return title || null;
  } catch (e) {
    return null;
  }
}

function getActiveVideoId(tabId) {
  const data = videoData[tabId];
  if (!data || !data.activeUrl || !Array.isArray(data.urls)) return null;
  return data.urls.find((u) => u.url === data.activeUrl)?.videoId ?? null;
}

function isVideoUrlForTab(item) {
  return (
    item.type !== "config" &&
    !item.url.includes("master.json") &&
    !item.url.includes("config") &&
    !item.type.includes("mp4-full")
  );
}

function storeVideoUrl(
  tabId,
  url,
  type,
  fromNetworkRequest = false,
  videoTitle = null,
  videoId = null,
  fileSize = null,
) {
  url = fixUrlEncoding(url);
  if (!tabId || tabId < 0) {
    console.warn("Invalid tabId, skipping URL storage:", { tabId, url, type });
    return;
  }
  if (fileSize === null && pendingFileSizes && pendingFileSizes.has(url)) {
    fileSize = pendingFileSizes.get(url);
    pendingFileSizes.delete(url);
  }
  if (isFileTooSmall(fileSize)) {
    return;
  }
  if (!videoData[tabId]) {
    videoData[tabId] = {
      urls: [],
      activeUrl: null,
      videoTitle: null,
      videoIds: {},
    };
  }
  if (!videoId) videoId = extractVideoId(url);
  const currentVideoId = getActiveVideoId(tabId);
  if (videoId && currentVideoId && videoId !== currentVideoId) {
    videoData[tabId].videoTitle = null;
  }
  if (videoTitle && videoId) {
    const isActiveVideo = getActiveVideoId(tabId) === videoId;
    if (!videoData[tabId].videoIds[videoId])
      videoData[tabId].videoIds[videoId] = { title: videoTitle };
    else if (!videoData[tabId].videoIds[videoId].title)
      videoData[tabId].videoIds[videoId].title = videoTitle;
    else if (isActiveVideo)
      videoData[tabId].videoIds[videoId].title = videoTitle;
  }
  if (videoTitle && videoId) {
    const activeVideoId = getActiveVideoId(tabId);
    if (
      !activeVideoId ||
      activeVideoId === videoId ||
      !videoData[tabId].videoTitle
    ) {
      videoData[tabId].videoTitle = videoTitle;
    }
  } else if (videoTitle && !videoData[tabId].videoTitle) {
    videoData[tabId].videoTitle = videoTitle;
  }
  const timestamp = Date.now();
  const existingUrl = videoData[tabId].urls.find((item) => item.url === url);
  if (!existingUrl) {
    if (videoId && type.startsWith("hls-") && type !== "hls-master") {
      videoData[tabId].urls = videoData[tabId].urls.filter(
        (item) =>
          !(item.type === "hls-master" && item.videoId === videoId) ||
          item.url === url,
      );
    }
    const urlVideoTitle =
      videoTitle ||
      (videoId && videoData[tabId].videoIds[videoId]?.title) ||
      null;
    videoData[tabId].urls.push({
      url,
      type,
      timestamp,
      fromNetworkRequest,
      videoTitle: urlVideoTitle,
      videoId,
      fileSize,
    });
    const MAX_URLS_PER_TAB = 120;
    if (videoData[tabId].urls.length > MAX_URLS_PER_TAB) {
      videoData[tabId].urls = videoData[tabId].urls.slice(-MAX_URLS_PER_TAB);
      if (
        videoData[tabId].activeUrl &&
        !videoData[tabId].urls.some((u) => u.url === videoData[tabId].activeUrl)
      ) {
        videoData[tabId].activeUrl =
          videoData[tabId].urls[videoData[tabId].urls.length - 1]?.url || null;
      }
    }
    const videoIdKeys = Object.keys(videoData[tabId].videoIds || {});
    if (videoIdKeys.length > 30) {
      const inUse = new Set();
      videoData[tabId].urls.forEach((u) => {
        if (u.videoId != null) {
          inUse.add(u.videoId);
          inUse.add(String(u.videoId));
        }
      });
      const newVideoIds = {};
      videoIdKeys.forEach((k) => {
        if (inUse.has(k)) newVideoIds[k] = videoData[tabId].videoIds[k];
      });
      videoData[tabId].videoIds = newVideoIds;
    }
  } else {
    if (fromNetworkRequest) {
      existingUrl.timestamp = timestamp;
      existingUrl.fromNetworkRequest = true;
    }
    if (videoId && existingUrl.videoId !== videoId) {
      existingUrl.videoId = videoId;
      existingUrl.videoTitle =
        videoData[tabId].videoIds[videoId]?.title ?? null;
    }
    const activeVideoId = getActiveVideoId(tabId);
    const isActiveVideo = activeVideoId === videoId;
    const hasExistingTitle =
      existingUrl.videoTitle &&
      existingUrl.videoTitle !== "Dailymotion Video" &&
      !existingUrl.videoTitle
        .toLowerCase()
        .includes("dailymotion video player");
    if (videoTitle) {
      if (!hasExistingTitle || isActiveVideo || fromNetworkRequest)
        existingUrl.videoTitle = videoTitle;
    } else if (
      videoId &&
      videoData[tabId].videoIds[videoId]?.title &&
      !hasExistingTitle
    ) {
      existingUrl.videoTitle = videoData[tabId].videoIds[videoId].title;
    }
    if (fileSize !== null && fileSize !== undefined && !existingUrl.fileSize)
      existingUrl.fileSize = fileSize;
  }
  updateActiveVideo(tabId);
  updateBadge(tabId);
}

function updateActiveVideo(tabId, currentVideoId = null) {
  if (!videoData[tabId] || !videoData[tabId].urls.length) return;
  chrome.tabs.get(tabId, (tab) => {
    const skipPrune =
      tab && typeof isFeedPage === "function" && isFeedPage(tab.url);
    const videoUrls = videoData[tabId].urls.filter(isVideoUrlForTab);
    if (videoUrls.length === 0) return;
    const previousActiveVideoId = getActiveVideoId(tabId);
    videoData[tabId].urls.forEach((item) => (item.active = false));
    if (currentVideoId) {
      const matchingVideos = videoUrls.filter(
        (v) => v.videoId === currentVideoId,
      );
      if (matchingVideos.length > 0) {
        matchingVideos.forEach((v) => (v.active = true));
        const mostRecent = matchingVideos.reduce((latest, current) =>
          (current.timestamp || 0) > (latest.timestamp || 0) ? current : latest,
        );
        videoData[tabId].activeUrl = mostRecent.url;
        if (previousActiveVideoId && previousActiveVideoId !== currentVideoId) {
          videoData[tabId].videoTitle = null;
          getVideoTitleFromDailymotionApi(tabId).then(({ videoTitle }) => {
            if (videoTitle) {
              videoData[tabId].videoTitle = videoTitle;
              if (currentVideoId) {
                if (!videoData[tabId].videoIds[currentVideoId])
                  videoData[tabId].videoIds[currentVideoId] = {
                    title: videoTitle,
                  };
                else
                  videoData[tabId].videoIds[currentVideoId].title = videoTitle;
              }
              videoData[tabId].urls.forEach((url) => {
                if (url.videoId === currentVideoId) {
                  const hasValidTitle =
                    url.videoTitle &&
                    url.videoTitle !== "Dailymotion Video" &&
                    !url.videoTitle
                      .toLowerCase()
                      .includes("dailymotion video player");
                  if (!hasValidTitle) url.videoTitle = videoTitle;
                }
              });
            }
          });
        }
        if (!skipPrune) {
          videoData[tabId].urls = videoData[tabId].urls.filter(
            (u) => u.videoId === currentVideoId,
          );
          if (videoData[tabId].videoIds && currentVideoId) {
            const keepTitle = videoData[tabId].videoIds[currentVideoId];
            videoData[tabId].videoIds = keepTitle
              ? { [currentVideoId]: keepTitle }
              : {};
          }
        }
        return;
      }
    }
    const networkRequestVideos = videoUrls.filter((v) => v.fromNetworkRequest);
    if (networkRequestVideos.length === 0) {
      const mostRecent = videoUrls.reduce((latest, current) =>
        (current.timestamp || 0) > (latest.timestamp || 0) ? current : latest,
      );
      if (mostRecent) {
        mostRecent.active = true;
        videoData[tabId].activeUrl = mostRecent.url;
        if (!skipPrune && mostRecent.videoId) {
          videoData[tabId].urls = videoData[tabId].urls.filter(
            (u) => u.videoId === mostRecent.videoId,
          );
          if (videoData[tabId].videoIds) {
            const keepTitle = videoData[tabId].videoIds[mostRecent.videoId];
            videoData[tabId].videoIds = keepTitle
              ? { [mostRecent.videoId]: keepTitle }
              : {};
          }
        }
      }
      return;
    }
    const videosByVideoId = {};
    networkRequestVideos.forEach((v) => {
      const key = v.videoId || "unknown";
      if (
        !videosByVideoId[key] ||
        (v.timestamp || 0) > (videosByVideoId[key].timestamp || 0)
      ) {
        videosByVideoId[key] = v;
      }
    });
    const mostRecentNetwork = Object.values(videosByVideoId).reduce(
      (latest, current) =>
        (current.timestamp || 0) > (latest.timestamp || 0) ? current : latest,
    );
    mostRecentNetwork.active = true;
    videoData[tabId].activeUrl = mostRecentNetwork.url;
    if (mostRecentNetwork.videoId) {
      videoUrls.forEach((v) => {
        if (v.videoId === mostRecentNetwork.videoId) v.active = true;
      });
    }
    if (!skipPrune && mostRecentNetwork.videoId) {
      videoData[tabId].urls = videoData[tabId].urls.filter(
        (u) => u.videoId === mostRecentNetwork.videoId,
      );
      if (videoData[tabId].videoIds) {
        const keepTitle = videoData[tabId].videoIds[mostRecentNetwork.videoId];
        videoData[tabId].videoIds = keepTitle
          ? { [mostRecentNetwork.videoId]: keepTitle }
          : {};
      }
    }
  });
}
