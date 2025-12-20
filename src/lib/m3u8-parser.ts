import {
  MasterPlaylist,
  MediaPlaylist,
  M3U8Segment,
  StreamInfo,
} from './video-cache.types';

/**
 * 下载M3U8文件
 */
export async function downloadM3U8File(url: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.text();
  } catch (error) {
    clearTimeout(timeoutId);
    if ((error as Error).name === 'AbortError') {
      throw new Error('下载M3U8文件超时');
    }
    throw error;
  }
}

/**
 * 解析相对URL为绝对URL
 */
export function resolveUrl(baseUrl: string, relativeUrl: string): string {
  if (
    relativeUrl.startsWith('http://') ||
    relativeUrl.startsWith('https://')
  ) {
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
