import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';
import path from 'path';

import { getCacheDir, validatePath } from '@/lib/video-cache-utils';
import { getVideoDownloadService } from '@/lib/video-download-service';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const seriesKey = searchParams.get('series_key');
    const episodeIndex = searchParams.get('episode_index');

    if (!seriesKey || !episodeIndex) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const videoDownloadService = getVideoDownloadService();
    await videoDownloadService.initialize();

    // 检查是否已下载
    const isDownloaded = await videoDownloadService.isDownloaded(
      seriesKey,
      parseInt(episodeIndex, 10)
    );

    if (!isDownloaded) {
      return NextResponse.json({ error: '该集未下载' }, { status: 404 });
    }

    // Repair AES-128 encrypted downloads (ensure playlist has EXT-X-KEY and key file exists)
    // This is idempotent and will no-op for unencrypted sources.
    try {
      await videoDownloadService.ensurePlayableHlsDownload(
        seriesKey,
        parseInt(episodeIndex, 10)
      );
    } catch {
      // don't fail playback endpoint; worst case HLS will error and user can re-download
      // Silently ignore errors to allow playback to continue
    }

    // 获取播放列表文件路径
    const cacheDir = getCacheDir();
    const playlistFile = path.join(
      cacheDir,
      'downloads',
      seriesKey,
      episodeIndex,
      'playlist.m3u8'
    );

    if (!validatePath(playlistFile, cacheDir)) {
      return NextResponse.json({ error: '路径不安全' }, { status: 400 });
    }

    // 读取M3U8文件
    let content = await fs.readFile(playlistFile, 'utf-8');

    // 将相对路径转换为绝对URL
    // 获取请求的origin（协议+主机+端口）
    const url = new URL(request.url);
    // 使用请求头中的host，如果没有则使用url.host
    const host = request.headers.get('host') || url.host;
    // 如果host是0.0.0.0，替换为localhost
    const finalHost = host.replace(/^0\.0\.0\.0:/, 'localhost:');
    const baseUrl = `${url.protocol}//${finalHost}`;

    // 替换相对路径为绝对URL
    // 匹配 segments/segmentXXX.ts 这样的相对路径（行首或前面有#EXTINF的行）
    // 需要确保URL是完整的绝对路径，避免HLS.js解析错误
    content = content.replace(/^segments\/(.+)$/gm, (match, filename) => {
      const absoluteUrl = `${baseUrl}/api/download/segment?series_key=${encodeURIComponent(
        seriesKey
      )}&episode_index=${episodeIndex}&segment=${encodeURIComponent(filename)}`;
      return absoluteUrl;
    });

    // 确保所有URL都是绝对路径（如果还有相对路径，也转换）
    // 这可以处理一些边缘情况
    const lines = content.split('\n');
    const processedLines = lines.map((line) => {
      // 如果是segment URL行（不是标签行，且不是空行）
      if (line.trim() && !line.startsWith('#') && line.includes('segment')) {
        // 如果已经是绝对URL，保持不变
        if (line.startsWith('http://') || line.startsWith('https://')) {
          return line;
        }
        // 如果是相对路径，转换为绝对URL
        if (line.startsWith('segments/')) {
          const filename = line.replace('segments/', '');
          return `${baseUrl}/api/download/segment?series_key=${encodeURIComponent(
            seriesKey
          )}&episode_index=${episodeIndex}&segment=${encodeURIComponent(
            filename
          )}`;
        }
      }
      return line;
    });
    content = processedLines.join('\n');

    // Rewrite local key URI (key.key) to an absolute API URL
    // Example: #EXT-X-KEY:METHOD=AES-128,URI="key.key",IV=...
    content = content.replace(
      /#EXT-X-KEY:([^\n]*?)URI="(key\.key)"([^\n]*)/g,
      (_m, pre, _uri, post) => {
        return `#EXT-X-KEY:${pre}URI="${baseUrl}/api/download/key?series_key=${encodeURIComponent(
          seriesKey
        )}&episode_index=${encodeURIComponent(
          episodeIndex
        )}&key=${encodeURIComponent('key.key')}"${post}`;
      }
    );

    // 返回M3U8文件内容
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        // IMPORTANT: do NOT cache playlist responses; otherwise clients may keep stale playlists
        // with old relative segment paths and request invalid URLs (e.g. /api/download/segments/...).
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
