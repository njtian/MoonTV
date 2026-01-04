import {
  M3U8Segment,
  MasterPlaylist,
  MediaPlaylist,
  StreamInfo,
} from './video-cache.types';

/**
 * 下载M3U8文件
 */
export async function downloadM3U8File(
  url: string,
  resolveDepth = 0,
  cookieHeader?: string
): Promise<string> {
  const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

  const maxResolveDepth = 1; // 仅允许一次 HTML -> m3u8 解析，避免死循环

  const fetchText = async (
    fetchUrl: string,
    cookie?: string
  ): Promise<{
    text: string;
    contentType: string;
    cookieHeader?: string;
  }> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

    try {
      const response = await fetch(fetchUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          ...(cookie ? { Cookie: cookie } : {}),
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';

      // best-effort: 尝试带上 set-cookie（不同运行时实现不同）
      let extractedCookie: string | undefined;
      const anyHeaders = response.headers as unknown as {
        getSetCookie?: () => string[];
      };
      const setCookies = anyHeaders.getSetCookie?.();
      if (setCookies && Array.isArray(setCookies) && setCookies.length > 0) {
        extractedCookie = setCookies
          .map((c) => c.split(';')[0])
          .filter(Boolean)
          .join('; ');
      } else {
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) {
          extractedCookie = setCookie.split(';')[0];
        }
      }

      return {
        text: await response.text(),
        contentType,
        cookieHeader: extractedCookie,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === 'AbortError') {
        throw new Error('下载M3U8文件超时');
      }
      throw error;
    }
  };

  const isValidM3U8 = (text: string): boolean => {
    return text.trimStart().startsWith('#EXTM3U');
  };

  const rewriteM3U8UrlsToAbsolute = (m3u8Text: string, playlistUrl: string) => {
    const lines = m3u8Text.split('\n');
    const rewritten = lines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      // Rewrite key URI inside tag lines (important if baseUrl at caller is wrong)
      if (trimmed.startsWith('#EXT-X-KEY:') && trimmed.includes('URI="')) {
        const uriMatch = trimmed.match(/URI="([^"]+)"/);
        if (uriMatch?.[1]) {
          const uri = uriMatch[1];
          if (!uri.startsWith('http://') && !uri.startsWith('https://')) {
            try {
              const abs = new URL(uri, playlistUrl).href;
              return trimmed.replace(/URI="([^"]+)"/, `URI="${abs}"`);
            } catch {
              return line;
            }
          }
        }
        return line;
      }

      // Non-tag lines are URLs (stream playlist / media segment)
      if (!trimmed.startsWith('#')) {
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          return trimmed;
        }
        try {
          return new URL(trimmed, playlistUrl).href;
        } catch {
          return line;
        }
      }

      return line;
    });

    return rewritten.join('\n');
  };

  const isLikelyHtml = (text: string, contentType: string): boolean => {
    const t = text.trimStart();
    if (contentType.toLowerCase().includes('text/html')) return true;
    if (t.startsWith('<!doctype') || t.startsWith('<html') || t.startsWith('<'))
      return true;
    return false;
  };

  const extractM3U8UrlFromHtml = (
    html: string,
    baseUrl: string
  ): string | null => {
    // 1) var main = "/path/index.m3u8?sign=..."
    const mainVarMatch = html.match(/var\s+main\s*=\s*["']([^"']+)["']\s*;/i);
    if (mainVarMatch?.[1] && mainVarMatch[1].includes('.m3u8')) {
      try {
        return new URL(mainVarMatch[1], baseUrl).href;
      } catch {
        // ignore
      }
    }

    // 2) 兜底：任意绝对 m3u8
    const absMatch = html.match(/https?:\/\/[^\s"'<>]+?\.m3u8[^\s"'<>]*/i);
    if (absMatch?.[0]) return absMatch[0];

    return null;
  };

  const {
    text,
    contentType,
    cookieHeader: responseCookie,
  } = await fetchText(url, cookieHeader);

  if (isValidM3U8(text)) {
    return text;
  }

  // 兼容 lzi share 等返回 HTML 的情况：从 HTML 中解析真实 m3u8 再请求一次
  if (resolveDepth < maxResolveDepth && isLikelyHtml(text, contentType)) {
    const resolved = extractM3U8UrlFromHtml(text, url);
    if (!resolved) {
      throw new Error('返回内容不是M3U8，且无法从HTML中解析出真实M3U8地址');
    }
    const { text: resolvedText, contentType: resolvedType } = await fetchText(
      resolved,
      responseCookie || cookieHeader
    );
    if (!isValidM3U8(resolvedText)) {
      throw new Error(
        `已解析到真实地址，但返回内容仍不是M3U8 (${resolvedType || 'unknown'})`
      );
    }

    // 关键兼容性：当原始 url 是 share 页时，调用方会用 share 的 baseUrl 去 resolve 相对路径
    // 这里把 resolved 播放列表里的相对 URL 全部改写为绝对 URL，避免后续解析/下载走错路径
    return rewriteM3U8UrlsToAbsolute(resolvedText, resolved);
  }

  // 非 m3u8 且不满足 HTML fallback 条件
  throw new Error('返回内容不是有效的M3U8播放列表');
}

/**
 * 解析相对URL为绝对URL
 */
export function resolveUrl(baseUrl: string, relativeUrl: string): string {
  if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
    return relativeUrl; // 绝对路径
  }

  // 相对路径，需要拼接
  try {
    const base = new URL(baseUrl);
    return new URL(relativeUrl, base).href;
  } catch {
    // 如果baseUrl不是有效的URL，尝试简单拼接
    const basePath = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
    return basePath + relativeUrl;
  }
}

/**
 * 检查是否是主播放列表
 */
export function isMasterPlaylist(content: string): boolean {
  return content.includes('#EXT-X-STREAM-INF');
}

/**
 * 解析主播放列表
 */
export function parseMasterPlaylist(
  content: string,
  baseUrl: string
): MasterPlaylist {
  const lines = content.split('\n');
  const streams: StreamInfo[] = [];
  let currentBandwidth = 0;
  let currentResolution = '';
  let currentUrl = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      // 解析带宽
      const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
      if (bandwidthMatch) {
        currentBandwidth = parseInt(bandwidthMatch[1], 10);
      }

      // 解析分辨率
      const resolutionMatch = line.match(/RESOLUTION=([^\s,]+)/);
      if (resolutionMatch) {
        currentResolution = resolutionMatch[1];
      }

      // 下一行应该是URL
      if (i + 1 < lines.length) {
        const urlLine = lines[i + 1].trim();
        if (urlLine && !urlLine.startsWith('#')) {
          currentUrl = resolveUrl(baseUrl, urlLine);
          streams.push({
            bandwidth: currentBandwidth,
            resolution: currentResolution,
            url: currentUrl,
          });
        }
      }
    }
  }

  return { streams };
}

/**
 * 选择最佳质量流
 */
export function selectBestStream(playlist: MasterPlaylist): string {
  if (playlist.streams.length === 0) {
    throw new Error('播放列表中没有可用的流');
  }

  // 按带宽降序排序，选择最高质量的流
  const sortedStreams = [...playlist.streams].sort(
    (a, b) => b.bandwidth - a.bandwidth
  );

  return sortedStreams[0].url;
}

/**
 * 解析媒体播放列表
 */
export function parseMediaPlaylist(
  content: string,
  baseUrl: string
): MediaPlaylist {
  const lines = content.split('\n');
  const segments: M3U8Segment[] = [];
  let version: number | undefined;
  let targetDuration = 10;
  let currentDuration = 0;
  let sequence = 0;
  let endList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 解析版本
    if (line.startsWith('#EXT-X-VERSION:')) {
      const versionMatch = line.match(/#EXT-X-VERSION:(\d+)/);
      if (versionMatch) {
        version = parseInt(versionMatch[1], 10);
      }
    }

    // 解析目标时长
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      const durationMatch = line.match(/#EXT-X-TARGETDURATION:(\d+)/);
      if (durationMatch) {
        targetDuration = parseInt(durationMatch[1], 10);
      }
    }

    // 解析分段时长
    if (line.startsWith('#EXTINF:')) {
      const durationMatch = line.match(/#EXTINF:([\d.]+)/);
      if (durationMatch) {
        currentDuration = parseFloat(durationMatch[1]);
      }
    }

    // 检查结束标记
    if (line === '#EXT-X-ENDLIST') {
      endList = true;
    }

    // 解析分段URL
    if (line && !line.startsWith('#')) {
      const segmentUrl = resolveUrl(baseUrl, line);
      segments.push({
        duration: currentDuration,
        url: segmentUrl,
        sequence: sequence++,
      });
      currentDuration = 0; // 重置
    }
  }

  return {
    version,
    targetDuration,
    segments,
    endList,
  };
}
