function getBaseUrl(url) {
  return url.substring(0, url.lastIndexOf("/") + 1);
}

function resolvePlaylistUri(uri, baseUrl) {
  if (uri.startsWith("http://") || uri.startsWith("https://")) return uri;
  if (uri.startsWith("/")) {
    const urlObj = new URL(baseUrl);
    return `${urlObj.protocol}//${urlObj.host}${uri}`;
  }
  if (uri.startsWith("./")) return baseUrl + uri.substring(2);
  return baseUrl + uri;
}

function getMasterPlaylistInfo(playlistText) {
  const hasVideoVariants =
    playlistText && playlistText.includes("#EXT-X-STREAM-INF");
  const hasAudioMedia =
    playlistText && /#EXT-X-MEDIA:.*TYPE=AUDIO/i.test(playlistText);
  return { hasVideoVariants, hasAudioMedia };
}

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

  if (abortController?.signal) options.signal = abortController.signal;
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

function parseM3U8(playlistText, baseUrl) {
  const lines = playlistText.split("\n");
  const segments = [];
  let initSegmentUrl = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const upper = line.toUpperCase();

    if (upper.startsWith("#EXT-X-MAP")) {
      const uriMatch =
        line.match(/URI=["']?([^"'\s]+)["']?/i) ||
        line.match(/(https?:\/\/[^\s"']+|\.\/[^\s"']+|\/[^\s"']+)/);
      if (uriMatch) {
        try {
          initSegmentUrl = resolvePlaylistUri(
            decodeURIComponent(uriMatch[1].trim()),
            baseUrl,
          );
        } catch (e) {
          initSegmentUrl = resolvePlaylistUri(uriMatch[1].trim(), baseUrl);
        }
      }
      continue;
    }
    if (line.startsWith("#") || !line) continue;
    if (line) segments.push(resolvePlaylistUri(line, baseUrl));
  }
  return { segments, initSegmentUrl };
}

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
      currentVariant.url = resolvePlaylistUri(line, baseUrl);
      variants.push(currentVariant);
      currentVariant = null;
    }
  }

  variants.sort((a, b) => b.bandwidth - a.bandwidth);
  return variants;
}

async function getSegmentCountForM3u8Url(m3u8Url, tabId = null) {
  if (!m3u8Url || typeof m3u8Url !== "string") return { segmentCount: 0 };
  try {
    const url = fixUrlEncoding(m3u8Url);
    const opts = await getFetchOptionsWithHeaders(url, tabId, null);
    const res = await fetch(url, opts);
    if (!res.ok) return { segmentCount: 0 };
    const text = await res.text();
    if (!text || !text.trim()) return { segmentCount: 0 };
    const baseUrl = getBaseUrl(url);
    const { hasVideoVariants: isMaster } = getMasterPlaylistInfo(text);
    let segments;
    if (isMaster) {
      const variants = parseMasterPlaylist(text, baseUrl);
      if (variants.length === 0) return { segmentCount: 0 };
      const variantUrl = fixUrlEncoding(variants[0].url);
      const vOpts = await getFetchOptionsWithHeaders(variantUrl, tabId, null);
      const vRes = await fetch(variantUrl, vOpts);
      if (!vRes.ok) return { segmentCount: 0 };
      const vText = await vRes.text();
      segments = parseM3U8(vText || "", getBaseUrl(variantUrl)).segments || [];
    } else {
      segments = parseM3U8(text, baseUrl).segments || [];
    }
    return { segmentCount: segments.length };
  } catch (e) {
    return { segmentCount: 0 };
  }
}

function parseMasterPlaylistToVariants(playlistText, masterPlaylistUrl) {
  const { hasVideoVariants } = getMasterPlaylistInfo(playlistText);
  const baseUrl = getBaseUrl(masterPlaylistUrl);
  return {
    variants: hasVideoVariants
      ? parseMasterPlaylist(playlistText, baseUrl)
      : [],
    audioTracks: [],
  };
}
