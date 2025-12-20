import { promises as fs } from 'fs';
import path from 'path';

import {
  downloadM3U8File,
  isMasterPlaylist,
  parseMasterPlaylist,
  parseMediaPlaylist,
  selectBestStream,
} from './m3u8-parser';
import { resolveUrl } from './m3u8-parser';
import { M3U8DownloadResult, M3U8Segment } from './video-cache.types';
import { atomicWriteFile, ensureDirectory } from './video-cache-utils';

/**
 * M3U8下载器类
 */
export class M3U8Downloader {
  /**
   * 下载M3U8文件及其所有分段
   */
  async downloadM3U8(
    m3u8Url: string,
    outputDir: string,
    taskId: string,
    abortSignal?: AbortSignal,
    onProgress?: (progress: number, downloaded: number, total: number) => void
  ): Promise<M3U8DownloadResult> {
    try {
      // 1. 下载并解析M3U8文件
      const m3u8Content = await downloadM3U8File(m3u8Url);
      const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);

      // 检查是否已取消
      if (abortSignal?.aborted) {
        throw new Error('下载已取消');
      }

      // 2. 检查是否是主播放列表
      if (isMasterPlaylist(m3u8Content)) {
        // 选择最佳质量的流
        const masterPlaylist = parseMasterPlaylist(m3u8Content, baseUrl);
        const bestStreamUrl = selectBestStream(masterPlaylist);
        // 递归下载媒体播放列表
        return this.downloadM3U8(
          bestStreamUrl,
          outputDir,
          taskId,
          abortSignal,
          onProgress
        );
      }

      // 3. 解析媒体播放列表
      const mediaPlaylist = parseMediaPlaylist(m3u8Content, baseUrl);
      const segments = mediaPlaylist.segments;

      if (segments.length === 0) {
        throw new Error('播放列表中没有分段');
      }

      // 3.1 如果播放列表使用 AES-128 加密，下载 key 文件并在本地播放列表中保留 EXT-X-KEY
      const keyLine = m3u8Content
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('#EXT-X-KEY:'));
      let rewrittenKeyLine: string | null = null;
      if (keyLine) {
        // 检查是否已取消
        if (abortSignal?.aborted) {
          throw new Error('下载已取消');
        }

        const uriMatch = keyLine.match(/URI="([^"]+)"/);
        if (uriMatch) {
          const keyUri = uriMatch[1];
          const keyUrl = resolveUrl(baseUrl, keyUri);
          const keyBytes = await this.downloadSegment(
            keyUrl,
            taskId,
            abortSignal
          );
          const keyPath = path.join(outputDir, 'key.key');
          await fs.writeFile(keyPath, keyBytes);
          // rewrite to local key filename
          rewrittenKeyLine = keyLine.replace(/URI="([^"]+)"/, 'URI="key.key"');
        }
      }

      // 4. 创建segments目录
      const segmentsDir = path.join(outputDir, 'segments');
      await ensureDirectory(segmentsDir);

      // 5. 顺序下载所有分段（不支持并发，避免源服务器限制）
      // 支持断点续传：检查已存在的分段文件
      const downloadedSegments: string[] = [];
      let totalSize = 0;
      let existingSegmentsCount = 0;

      // 检查已存在的分段文件（断点续传）
      // 注意：需要按顺序检查，如果中间有缺失，从第一个缺失的开始下载
      for (let i = 0; i < segments.length; i++) {
        const segmentFileName = `segment${String(i + 1).padStart(3, '0')}.ts`;
        const segmentPath = path.join(segmentsDir, segmentFileName);
        try {
          const stats = await fs.stat(segmentPath);
          if (stats.isFile() && stats.size > 0) {
            // 分段文件已存在且不为空，跳过下载
            downloadedSegments.push(segmentFileName);
            totalSize += stats.size;
            existingSegmentsCount++;

            // 不在这里更新进度，等所有已存在的分段检查完后再统一更新
          } else {
            // 文件不存在或为空，停止检查，从这里开始下载
            break;
          }
        } catch {
          // 文件不存在，停止检查，从这里开始下载
          break;
        }
      }

      // 如果有已存在的分段，先更新一次进度
      if (existingSegmentsCount > 0 && onProgress && !abortSignal?.aborted) {
        onProgress(
          existingSegmentsCount / segments.length,
          totalSize,
          totalSize
        );
      }

      // 继续下载未完成的分段（从 existingSegmentsCount 开始）
      for (let i = existingSegmentsCount; i < segments.length; i++) {
        // 检查是否已取消
        if (abortSignal?.aborted) {
          throw new Error('下载已取消');
        }

        const segment = segments[i];
        const segmentFileName = `segment${String(i + 1).padStart(3, '0')}.ts`;
        const segmentPath = path.join(segmentsDir, segmentFileName);

        try {
          // 顺序下载分段（await确保前一个完成后再下载下一个）
          const segmentData = await this.downloadSegment(
            segment.url,
            taskId,
            abortSignal
          );
          await fs.writeFile(segmentPath, segmentData);

          downloadedSegments.push(segmentFileName);
          totalSize += segmentData.length;

          // 更新进度
          if (onProgress && !abortSignal?.aborted) {
            onProgress(
              (i + 1) / segments.length,
              totalSize,
              totalSize // 总大小在下载完成前无法确定，使用当前已下载大小
            );
          }
        } catch (error) {
          // 如果是取消错误，直接抛出
          if (abortSignal?.aborted || (error as Error).name === 'AbortError') {
            throw new Error('下载已取消');
          }
          throw new Error(
            `下载分段失败: ${segment.url} - ${(error as Error).message}`
          );
        }
      }

      // 6. 生成修改后的M3U8文件
      const modifiedM3U8 = this.generateLocalM3U8(
        segments,
        downloadedSegments,
        mediaPlaylist,
        rewrittenKeyLine
      );
      const playlistPath = path.join(outputDir, 'playlist.m3u8');
      await atomicWriteFile(playlistPath, modifiedM3U8);

      return {
        success: true,
        file_path: playlistPath,
        file_size: totalSize,
        segment_count: segments.length,
      };
    } catch (error) {
      return {
        success: false,
        file_path: '',
        file_size: 0,
        segment_count: 0,
        error: (error as Error).message,
      };
    }
  }

  /**
   * 下载单个分段
   */
  private async downloadSegment(
    url: string,
    taskId: string,
    abortSignal?: AbortSignal
  ): Promise<Buffer> {
    // 如果外部已取消，直接抛出错误
    if (abortSignal?.aborted) {
      throw new Error('下载已取消');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

    // 如果外部信号被触发，也取消当前请求
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        controller.abort();
      });
    }

    try {
      const response = await fetch(url, {
        signal: abortSignal || controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === 'AbortError') {
        throw new Error('下载分段超时');
      }
      throw error;
    }
  }

  /**
   * 生成本地M3U8文件（分段指向本地文件）
   */
  private generateLocalM3U8(
    segments: M3U8Segment[],
    downloadedSegments: string[],
    playlist: { version?: number; targetDuration: number; endList: boolean },
    keyLine?: string | null
  ): string {
    let m3u8 = '#EXTM3U\n';

    if (playlist.version) {
      m3u8 += `#EXT-X-VERSION:${playlist.version}\n`;
    }

    m3u8 += `#EXT-X-TARGETDURATION:${Math.ceil(playlist.targetDuration)}\n`;

    if (keyLine) {
      m3u8 += `${keyLine}\n`;
    }

    segments.forEach((segment, index) => {
      m3u8 += `#EXTINF:${segment.duration.toFixed(1)},\n`;
      m3u8 += `segments/${downloadedSegments[index]}\n`;
    });

    if (playlist.endList) {
      m3u8 += '#EXT-X-ENDLIST\n';
    }

    return m3u8;
  }
}
