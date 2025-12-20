import { randomBytes } from 'crypto';
import path from 'path';

import { M3U8Downloader } from './m3u8-downloader';
import { updateSourceHistory } from './source-history';
import { getSourcePriority } from './source-priority';
import { getVideoCacheService } from './video-cache';
import {
  DownloadedItem,
  DownloadOptions,
  DownloadResult,
  DownloadStatus,
  DownloadTask,
  SourceSwitchRecord,
} from './video-cache.types';
import {
  atomicWriteFile,
  ensureDirectory,
  getCacheDir,
  getDirectorySize,
  safeDeleteDirectory,
  safeReadFile,
  validatePath,
} from './video-cache-utils';

/**
 * 速度监控类
 */
class SpeedMonitor {
  private speeds: number[] = [];
  private startTime: number = Date.now();
  private readonly CHECK_INTERVAL = 10000; // 10秒检查一次
  private readonly MIN_SPEED_KBPS = 100; // 最低速度100KB/s

  updateSpeed(bytesDownloaded: number): void {
    const now = Date.now();
    const elapsed = (now - this.startTime) / 1000; // 秒
    if (elapsed > 0) {
      const speedKBps = bytesDownloaded / 1024 / elapsed;
      this.speeds.push(speedKBps);

      // 只保留最近10秒的数据
      const cutoff = now - this.CHECK_INTERVAL;
      this.speeds = this.speeds.filter((_, i) => {
        const time = this.startTime + i * (this.CHECK_INTERVAL / 10);
        return time > cutoff;
      });
    }
  }

  isSpeedTooSlow(): boolean {
    if (this.speeds.length < 2) return false; // 至少需要2个数据点
    const avgSpeed =
      this.speeds.reduce((a, b) => a + b, 0) / this.speeds.length;
    return avgSpeed < this.MIN_SPEED_KBPS;
  }

  getAverageSpeed(): number {
    if (this.speeds.length === 0) return 0;
    return this.speeds.reduce((a, b) => a + b, 0) / this.speeds.length;
  }

  reset(): void {
    this.speeds = [];
    this.startTime = Date.now();
  }
}

/**
 * VideoDownloadService - 视频下载服务类
 */
export class VideoDownloadService {
  private downloadDir: string;
  private tasksDir: string;
  private downloadQueue: DownloadTask[] = [];
  private currentDownload: DownloadTask | null = null;
  private processingQueue = false;
  // 存储每个任务的 AbortController，用于取消下载
  private abortControllers: Map<string, AbortController> = new Map();

  constructor() {
    const cacheDir = getCacheDir();
    this.downloadDir = path.join(cacheDir, 'downloads');
    this.tasksDir = path.join(cacheDir, 'tasks');
  }

  /**
   * 初始化下载服务
   */
  async initialize(): Promise<void> {
    await ensureDirectory(this.downloadDir);
    await ensureDirectory(this.tasksDir);
  }

  /**
   * 开始下载（加入队列）
   */
  async startDownload(options: DownloadOptions): Promise<DownloadTask> {
    await this.initialize();

    // 检查是否已下载
    const isDownloaded = await this.isDownloaded(
      options.series_key,
      options.episode_index
    );
    if (isDownloaded) {
      throw new Error('该集已下载');
    }

    // 检查是否已有正在进行的下载任务（pending 或 downloading）
    const existingTask = await this.findActiveTaskForEpisode(
      options.series_key,
      options.episode_index
    );
    if (existingTask) {
      throw new Error(
        `该集已有下载任务（${
          existingTask.status === 'pending' ? '等待中' : '下载中'
        }）`
      );
    }

    // 检查是否有部分下载的文件（支持断点续传）
    // 如果有部分文件但没有完成，允许继续下载
    const hasPartialDownload = await this.hasPartialDownload(
      options.series_key,
      options.episode_index
    );
    if (hasPartialDownload) {
      // 允许继续下载，m3u8-downloader 会自动跳过已存在的分段
    }

    // 获取下载URL（如果未提供）
    let downloadUrl: string | null = options.url || null;
    if (!downloadUrl) {
      downloadUrl = await this.getDownloadUrl(
        options.series_key,
        options.episode_index,
        options.source
      );
      if (!downloadUrl) {
        throw new Error('无法获取下载URL，请先调用 /api/detail 接口');
      }
    }

    if (!downloadUrl) {
      throw new Error('无法获取下载URL');
    }

    // 创建下载任务
    const taskId = `download_${Date.now()}_${randomBytes(4).toString('hex')}`;
    const task: DownloadTask = {
      task_id: taskId,
      series_key: options.series_key,
      episode_index: options.episode_index,
      title: options.title,
      episode_title: options.episode_title,
      requested_source: options.source,
      current_source: options.source,
      status: 'pending',
      progress: 0,
      downloaded_bytes: 0,
      total_bytes: 0,
      download_speed_mbps: 0,
      estimated_time_remaining_seconds: 0,
      started_at: Date.now(),
      updated_at: Date.now(),
      error: null,
      retry_count: 0,
      source_switches: [],
      source_switched: false,
    };

    // 保存任务文件
    await this.saveTask(task);

    // 加入队列
    this.downloadQueue.push(task);

    // 如果队列为空且无正在下载的任务，立即开始处理
    if (!this.processingQueue && this.currentDownload === null) {
      this.processDownloadQueue().catch(() => {
        // 静默处理错误
      });
    }

    return task;
  }

  /**
   * 处理下载队列（顺序执行，不支持并发）
   */
  private async processDownloadQueue(): Promise<void> {
    if (this.processingQueue) {
      return; // 已经在处理中
    }

    this.processingQueue = true;

    try {
      while (this.downloadQueue.length > 0 || this.currentDownload !== null) {
        // 如果当前有正在下载的任务，等待完成
        if (this.currentDownload !== null) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        // 从队列取出下一个任务
        const task = this.downloadQueue.shift();
        if (!task) {
          break;
        }

        this.currentDownload = task;
        task.status = 'downloading';
        task.started_at = Date.now();
        await this.saveTask(task);

        try {
          await this.downloadTask(task);
        } catch (error) {
          // 检查是否是因为取消导致的错误
          const currentTask = await this.getTask(task.task_id);
          if (currentTask?.status === 'cancelled') {
            // 任务已取消，不需要设置为 failed
          } else {
            task.status = 'failed';
            task.error = (error as Error).message;
            await this.saveTask(task);
          }
        } finally {
          // 清理 AbortController
          this.abortControllers.delete(task.task_id);
          this.currentDownload = null;
        }
      }
    } finally {
      this.processingQueue = false;
    }
  }

  /**
   * 下载任务
   */
  private async downloadTask(task: DownloadTask): Promise<void> {
    const videoCacheService = getVideoCacheService();
    const cachedSeries = await videoCacheService.getSeries(task.series_key);

    if (!cachedSeries) {
      throw new Error('剧集缓存不存在');
    }

    // 获取该集的所有可用源
    const episodeKey = task.episode_index.toString();
    const episodeLinks = cachedSeries.episodes[episodeKey] || [];

    if (episodeLinks.length === 0) {
      throw new Error('该集没有可用的下载链接');
    }

    // 获取优先级排序的源列表
    const availableSources = episodeLinks.map((link) => link.source);
    const prioritizedSources = await getSourcePriority(
      availableSources,
      task.requested_source
    );

    // 尝试从每个源下载（顺序尝试，不支持并发）
    let downloadSuccess = false;
    const speedMonitor = new SpeedMonitor();

    for (const source of prioritizedSources) {
      // 检查任务是否已被取消
      const currentTask = await this.getTask(task.task_id);
      if (currentTask?.status === 'cancelled') {
        throw new Error('任务已取消');
      }

      const sourceLink = episodeLinks.find((link) => link.source === source);
      if (!sourceLink) {
        continue;
      }

      task.current_source = source;
      if (source !== task.requested_source) {
        // 记录源切换
        const switchRecord: SourceSwitchRecord = {
          from: task.requested_source,
          to: source,
          reason: '自动切换',
          timestamp: Date.now(),
        };
        task.source_switches.push(switchRecord);
        task.source_switched = true;
      }

      await this.saveTask(task);

      try {
        const result = await this.tryDownloadWithSource(
          sourceLink.url,
          source,
          task,
          speedMonitor
        );

        if (result.success) {
          // 下载成功
          await updateSourceHistory(source, {
            success: true,
            speedMBps: result.speedMBps,
          });

          task.status = 'completed';
          task.progress = 1;
          await this.saveTask(task);
          downloadSuccess = true;
          break;
        } else {
          // 下载失败，记录并尝试下一个源
          await updateSourceHistory(source, {
            success: false,
            error: result.error,
            timeout: result.timeout,
          });
        }
      } catch (error) {
        // 记录错误，继续尝试下一个源
        await updateSourceHistory(source, {
          success: false,
          error: (error as Error).message,
        });
      }
    }

    if (!downloadSuccess) {
      throw new Error('所有源都下载失败');
    }
  }

  /**
   * 尝试从指定源下载
   */
  private async tryDownloadWithSource(
    url: string,
    source: string,
    task: DownloadTask,
    speedMonitor: SpeedMonitor
  ): Promise<DownloadResult> {
    const outputDir = path.join(
      this.downloadDir,
      task.series_key,
      task.episode_index.toString()
    );
    await ensureDirectory(outputDir);

    // 创建 AbortController 用于取消下载
    const abortController = new AbortController();
    this.abortControllers.set(task.task_id, abortController);

    const downloader = new M3U8Downloader();
    const startTime = Date.now();
    let downloadedBytes = 0;

    try {
      // 在开始下载前检查任务是否已被取消
      const currentTask = await this.getTask(task.task_id);
      if (currentTask?.status === 'cancelled') {
        this.abortControllers.delete(task.task_id);
        throw new Error('任务已取消');
      }

      const result = await downloader.downloadM3U8(
        url,
        outputDir,
        task.task_id,
        abortController.signal, // 传递 signal 给下载器
        (progress: number, downloaded: number, total: number) => {
          // 如果已取消，直接返回，不保存任务（避免覆盖取消状态）
          if (abortController.signal.aborted) {
            return;
          }

          downloadedBytes = downloaded;
          task.progress = progress;
          task.downloaded_bytes = downloaded;
          task.total_bytes = total || downloaded;

          // 更新速度
          speedMonitor.updateSpeed(downloaded);
          const avgSpeedKBps = speedMonitor.getAverageSpeed();
          task.download_speed_mbps = avgSpeedKBps / 1024;

          // 计算剩余时间
          if (task.download_speed_mbps > 0) {
            const remainingBytes = task.total_bytes - task.downloaded_bytes;
            task.estimated_time_remaining_seconds = Math.ceil(
              remainingBytes / (task.download_speed_mbps * 1024 * 1024)
            );
          }

          task.updated_at = Date.now();

          // 再次检查 abortController（在保存前最后检查一次）
          if (abortController.signal.aborted) {
            return;
          }

          // 保存任务（saveTask 内部会检查取消状态，避免覆盖）
          this.saveTask(task).catch(() => {
            // 静默处理错误
          });
        }
      );

      // 清理 AbortController
      this.abortControllers.delete(task.task_id);

      if (result.success) {
        const duration = (Date.now() - startTime) / 1000; // 秒
        const speedMBps = downloadedBytes / (1024 * 1024) / duration;

        // 保存下载元数据
        await this.saveDownloadMetadata(
          task,
          source,
          result.file_path,
          result.file_size
        );

        return {
          success: true,
          speedMBps,
        };
      } else {
        return {
          success: false,
          error: result.error,
        };
      }
    } catch (error) {
      // 清理 AbortController
      this.abortControllers.delete(task.task_id);

      // 检查是否是因为取消导致的错误
      if (
        abortController.signal.aborted ||
        (error as Error).name === 'AbortError'
      ) {
        return {
          success: false,
          error: '任务已取消',
        };
      }

      const isTimeout = (error as Error).message.includes('超时');
      return {
        success: false,
        error: (error as Error).message,
        timeout: isTimeout,
      };
    }
  }

  /**
   * 保存下载元数据
   */
  private async saveDownloadMetadata(
    task: DownloadTask,
    actualSource: string,
    filePath: string,
    fileSize: number
  ): Promise<void> {
    const downloadDir = path.join(
      this.downloadDir,
      task.series_key,
      task.episode_index.toString()
    );
    const metadataFile = path.join(downloadDir, 'download.json');

    const videoCacheService = getVideoCacheService();
    const cachedSeries = await videoCacheService.getSeries(task.series_key);
    const sourceName =
      cachedSeries?.episodes[task.episode_index.toString()]?.find(
        (link) => link.source === actualSource
      )?.source_name || actualSource;

    const metadata = {
      series_key: task.series_key,
      episode_index: task.episode_index,
      title: task.title,
      episode_title: task.episode_title,
      requested_source: task.requested_source,
      actual_source: actualSource,
      source_name: sourceName,
      // original_url: master or media m3u8 URL (best effort)
      original_url: await this.getDownloadUrl(
        task.series_key,
        task.episode_index,
        actualSource
      ).catch(() => null),
      cached_url: `/api/download/play?series_key=${task.series_key}&episode_index=${task.episode_index}`,
      file_path: filePath,
      file_size_bytes: fileSize,
      file_size_mb: fileSize / (1024 * 1024),
      download_status: 'completed',
      download_started_at: task.started_at,
      download_completed_at: Date.now(),
      download_duration_seconds: Math.floor(
        (Date.now() - task.started_at) / 1000
      ),
      download_speed_mbps: task.download_speed_mbps,
      retry_count: task.retry_count,
      source_switched: task.source_switched,
      switched_sources: task.source_switches,
      error: null,
      checksum: '', // 可选
      last_accessed: Date.now(),
      access_count: 0,
    };

    await atomicWriteFile(metadataFile, JSON.stringify(metadata, null, 2));

    // 更新剧集的下载记录
    await this.updateSeriesDownloads(task.series_key);
  }

  /**
   * Ensure encrypted HLS downloads have key + playlist with EXT-X-KEY.
   * Some sources use AES-128 but our initial downloader rebuilt playlist without EXT-X-KEY,
   * making playback impossible even though segments were downloaded.
   *
   * This method is safe to call during playback: it is idempotent and will no-op
   * once the key and playlist are repaired.
   */
  async ensurePlayableHlsDownload(
    seriesKey: string,
    episodeIndex: number
  ): Promise<void> {
    await this.initialize();

    const episodeDir = path.join(
      this.downloadDir,
      seriesKey,
      episodeIndex.toString()
    );
    const playlistFile = path.join(episodeDir, 'playlist.m3u8');
    const keyFile = path.join(episodeDir, 'key.key');

    if (
      !validatePath(episodeDir, this.downloadDir) ||
      !validatePath(playlistFile, this.downloadDir)
    ) {
      return;
    }

    const fs = await import('fs/promises');

    // Quick check: if key exists AND playlist already has EXT-X-KEY, we're done
    try {
      const playlistText = await fs.readFile(playlistFile, 'utf-8');
      const hasKeyTag = playlistText.includes('#EXT-X-KEY');
      if (hasKeyTag) {
        try {
          await fs.access(keyFile);
          return;
        } catch {
          // key missing, continue to repair
        }
      }
    } catch {
      return;
    }

    // Determine original master URL from metadata or cache
    let originalUrl: string | null = null;
    const metadataFile = path.join(episodeDir, 'download.json');
    interface EpisodeMetadata {
      original_url?: string | null;
      actual_source?: string;
      requested_source?: string;
    }
    const metadata = await safeReadFile<EpisodeMetadata>(metadataFile);
    if (metadata?.original_url && typeof metadata.original_url === 'string') {
      originalUrl = metadata.original_url;
    }
    if (!originalUrl) {
      const source =
        metadata?.actual_source || metadata?.requested_source || 'unknown';
      originalUrl = await this.getDownloadUrl(
        seriesKey,
        episodeIndex,
        source
      ).catch(() => null);
    }
    if (!originalUrl) {
      return;
    }

    // Fetch master/media playlist, extract EXT-X-KEY, download key bytes, and rewrite local playlist
    const fetchText = async (url: string): Promise<string> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      try {
        const resp = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.text();
      } finally {
        clearTimeout(timeoutId);
      }
    };

    const resolveUrl = (base: string, relative: string): string => {
      if (relative.startsWith('http://') || relative.startsWith('https://'))
        return relative;
      try {
        return new URL(relative, base).href;
      } catch {
        const basePath = base.substring(0, base.lastIndexOf('/') + 1);
        return basePath + relative.replace(/^\//, '');
      }
    };

    const masterText = await fetchText(originalUrl);
    let mediaUrl = originalUrl;
    if (masterText.includes('#EXT-X-STREAM-INF')) {
      // choose first stream (best) for now
      const lines = masterText.split('\n').map((l) => l.trim());
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
          const next = lines[i + 1]?.trim();
          if (next && !next.startsWith('#')) {
            mediaUrl = resolveUrl(originalUrl, next);
            break;
          }
        }
      }
    }

    const mediaText =
      mediaUrl === originalUrl ? masterText : await fetchText(mediaUrl);

    // Extract KEY line (AES-128)
    const keyLine = mediaText
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('#EXT-X-KEY:'));
    if (!keyLine) {
      return; // not encrypted
    }

    const uriMatch = keyLine.match(/URI="([^"]+)"/);
    if (!uriMatch) return;
    const keyUriRaw = uriMatch[1];
    const keyUrl = resolveUrl(mediaUrl, keyUriRaw);

    // Download key
    const keyBytes = await (async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      try {
        const resp = await fetch(keyUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
        return Buffer.from(buf);
      } finally {
        clearTimeout(timeoutId);
      }
    })();

    await atomicWriteFile(keyFile, keyBytes);

    // Rewrite playlist to:
    // - keep tags (including EXT-X-KEY) but set URI="key.key"
    // - map segment URIs to local segments/segmentNNN.ts
    let segIndex = 0;
    const rewritten = mediaText
      .split('\n')
      .map((lineRaw) => {
        const line = lineRaw.trim();
        if (!line) return '';
        if (line.startsWith('#EXT-X-KEY:')) {
          return lineRaw.replace(/URI="([^"]+)"/, 'URI="key.key"');
        }
        if (line.startsWith('#')) return lineRaw;
        // segment uri line
        segIndex += 1;
        const localName = `segments/segment${String(segIndex).padStart(
          3,
          '0'
        )}.ts`;
        return localName;
      })
      .join('\n');

    await atomicWriteFile(playlistFile, rewritten);
  }

  /**
   * 更新剧集的下载记录
   */
  private async updateSeriesDownloads(seriesKey: string): Promise<void> {
    const seriesDir = path.join(this.downloadDir, seriesKey);
    const downloadsFile = path.join(seriesDir, 'downloads.json');

    const videoCacheService = getVideoCacheService();
    const cachedSeries = await videoCacheService.getSeries(seriesKey);

    interface SeriesDownloadItem {
      episode_index: number;
      actual_source: string;
      source_name: string;
      file_size_mb: number;
      downloaded_at: number;
      status: 'completed';
      source_switched: boolean;
      requested_source: string;
    }

    interface SeriesDownloadsList {
      series_key: string;
      title: string;
      total_episodes: number;
      downloaded_episodes: number[];
      downloads: SeriesDownloadItem[];
      total_size_mb: number;
      last_updated: number;
    }

    let downloadsList: SeriesDownloadsList = {
      series_key: seriesKey,
      title: cachedSeries?.title || '',
      total_episodes: cachedSeries?.total_episodes || 0,
      downloaded_episodes: [],
      downloads: [],
      total_size_mb: 0,
      last_updated: Date.now(),
    };

    try {
      const existing = await safeReadFile<SeriesDownloadsList>(downloadsFile);
      if (existing) {
        downloadsList = existing;
      }
    } catch {
      // 文件不存在，使用默认值
    }

    // 扫描所有已下载的集
    const downloadedEpisodes: number[] = [];
    const downloads: SeriesDownloadItem[] = [];

    try {
      const fs = await import('fs/promises');
      const entries = await fs.readdir(seriesDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const episodeIndex = parseInt(entry.name, 10);
          if (!isNaN(episodeIndex)) {
            const episodeDir = path.join(seriesDir, entry.name);
            const metadataFile = path.join(episodeDir, 'download.json');
            interface DownloadMetadata {
              download_status?: string;
              actual_source?: string;
              source_name?: string;
              file_size_mb?: number;
              download_completed_at?: number;
              source_switched?: boolean;
              requested_source?: string;
            }
            const metadata = await safeReadFile<DownloadMetadata>(metadataFile);

            if (metadata && metadata.download_status === 'completed') {
              downloadedEpisodes.push(episodeIndex);
              downloads.push({
                episode_index: episodeIndex,
                actual_source: metadata.actual_source,
                source_name: metadata.source_name,
                file_size_mb: metadata.file_size_mb,
                downloaded_at: metadata.download_completed_at,
                status: 'completed',
                source_switched: metadata.source_switched,
                requested_source: metadata.requested_source,
              });
            }
          }
        }
      }
    } catch {
      // 忽略错误
    }

    downloadsList.downloaded_episodes = downloadedEpisodes.sort(
      (a, b) => a - b
    );
    downloadsList.downloads = downloads;
    downloadsList.total_size_mb = downloads.reduce(
      (sum, d) => sum + (d.file_size_mb || 0),
      0
    );
    downloadsList.last_updated = Date.now();

    await atomicWriteFile(
      downloadsFile,
      JSON.stringify(downloadsList, null, 2)
    );
  }

  /**
   * 获取下载状态
   */
  async getDownloadStatus(taskId: string): Promise<DownloadStatus | null> {
    const task = await this.getTask(taskId);
    if (!task) {
      return null;
    }

    return {
      task_id: task.task_id,
      series_key: task.series_key,
      episode_index: task.episode_index,
      title: task.title,
      episode_title: task.episode_title,
      status: task.status,
      progress: task.progress,
      downloaded_bytes: task.downloaded_bytes,
      total_bytes: task.total_bytes,
      download_speed_mbps: task.download_speed_mbps,
      estimated_time_remaining_seconds: task.estimated_time_remaining_seconds,
      requested_source: task.requested_source,
      actual_source: task.current_source,
      source_switched: task.source_switched,
      switched_sources: task.source_switches,
      started_at: task.started_at,
      updated_at: task.updated_at,
      error: task.error,
    };
  }

  /**
   * 取消下载
   */
  async cancelDownload(taskId: string): Promise<boolean> {
    const task = await this.getTask(taskId);
    if (!task) {
      return false;
    }

    if (task.status === 'completed' || task.status === 'failed') {
      return false; // 已完成或失败的任务无法取消
    }

    // 先触发 AbortController 来真正停止下载
    // 注意：不要立即删除 abortController，保留它以便进度回调检查
    const abortController = this.abortControllers.get(taskId);
    if (abortController) {
      abortController.abort();
      // 不立即删除，让进度回调能够检查到 aborted 状态
    }

    // 从队列中移除
    const index = this.downloadQueue.findIndex((t) => t.task_id === taskId);
    if (index >= 0) {
      this.downloadQueue.splice(index, 1);
    }

    // 如果是当前正在下载的任务，标记为取消
    if (this.currentDownload?.task_id === taskId) {
      this.currentDownload = null;
    }

    // 更新任务状态为 cancelled（使用原子写入，并立即保存，避免被进度回调覆盖）
    task.status = 'cancelled';
    task.error = '任务已取消';
    task.updated_at = Date.now();

    // 使用 atomicWriteFile 确保原子写入，避免竞态条件
    const taskFile = path.join(this.tasksDir, `${taskId}.json`);
    await atomicWriteFile(taskFile, JSON.stringify(task, null, 2));

    return true;
  }

  /**
   * 获取已下载列表
   */
  async getDownloadedList(filter?: {
    seriesKey?: string;
  }): Promise<DownloadedItem[]> {
    await this.initialize();

    const items: DownloadedItem[] = [];

    try {
      const fs = await import('fs/promises');
      const seriesDirs = filter?.seriesKey
        ? [filter.seriesKey]
        : await fs.readdir(this.downloadDir).catch(() => []);

      for (const seriesKey of seriesDirs) {
        const seriesDir = path.join(this.downloadDir, seriesKey);
        if (!validatePath(seriesDir, this.downloadDir)) {
          continue;
        }

        try {
          const entries = await fs.readdir(seriesDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const episodeIndex = parseInt(entry.name, 10);
              if (!isNaN(episodeIndex)) {
                const episodeDir = path.join(seriesDir, entry.name);
                const metadataFile = path.join(episodeDir, 'download.json');
                interface EpisodeDownloadMetadata {
                  download_status?: string;
                }
                const metadata = await safeReadFile<EpisodeDownloadMetadata>(
                  metadataFile
                );

                if (metadata && metadata.download_status === 'completed') {
                  items.push({
                    series_key: seriesKey,
                    episode_index: episodeIndex,
                    title: metadata.title,
                    episode_title: metadata.episode_title,
                    actual_source: metadata.actual_source,
                    source_name: metadata.source_name,
                    file_size_mb: metadata.file_size_mb,
                    downloaded_at: metadata.download_completed_at,
                    cached_url: metadata.cached_url,
                    status: 'completed',
                  });
                }
              }
            }
          }
        } catch {
          // 忽略错误
        }
      }
    } catch {
      // 忽略错误
    }

    return items;
  }

  /**
   * 删除已下载文件
   * @returns 返回删除的文件大小（MB），如果删除失败返回 null
   */
  async deleteDownload(
    seriesKey: string,
    episodeIndex: number
  ): Promise<{ success: boolean; freedSpaceMB: number }> {
    const episodeDir = path.join(
      this.downloadDir,
      seriesKey,
      episodeIndex.toString()
    );

    if (!validatePath(episodeDir, this.downloadDir)) {
      return { success: false, freedSpaceMB: 0 };
    }

    // 在删除前计算目录大小
    let freedSpaceBytes = 0;
    try {
      freedSpaceBytes = await getDirectorySize(episodeDir);
    } catch {
      // 如果计算大小失败，继续删除操作
    }

    const deleted = await safeDeleteDirectory(episodeDir);
    if (deleted) {
      await this.updateSeriesDownloads(seriesKey);
      const freedSpaceMB = freedSpaceBytes / (1024 * 1024);
      return { success: true, freedSpaceMB };
    }

    return { success: false, freedSpaceMB: 0 };
  }

  /**
   * 检查是否已下载
   */
  async isDownloaded(
    seriesKey: string,
    episodeIndex: number
  ): Promise<boolean> {
    const episodeDir = path.join(
      this.downloadDir,
      seriesKey,
      episodeIndex.toString()
    );
    const metadataFile = path.join(episodeDir, 'download.json');

    if (!validatePath(metadataFile, this.downloadDir)) {
      return false;
    }

    interface DownloadMetadata {
      download_status?: string;
    }
    const metadata = await safeReadFile<DownloadMetadata>(metadataFile);
    return metadata?.download_status === 'completed';
  }

  /**
   * 获取下载文件路径
   */
  async getDownloadPath(
    seriesKey: string,
    episodeIndex: number
  ): Promise<string | null> {
    const episodeDir = path.join(
      this.downloadDir,
      seriesKey,
      episodeIndex.toString()
    );
    const playlistFile = path.join(episodeDir, 'playlist.m3u8');

    if (!validatePath(playlistFile, this.downloadDir)) {
      return null;
    }

    const fs = await import('fs/promises');
    try {
      await fs.access(playlistFile);
      return playlistFile;
    } catch {
      return null;
    }
  }

  /**
   * 获取下载URL（从缓存中查找）
   */
  private async getDownloadUrl(
    seriesKey: string,
    episodeIndex: number,
    source: string
  ): Promise<string | null> {
    const videoCacheService = getVideoCacheService();
    const cachedSeries = await videoCacheService.getSeries(seriesKey);

    if (!cachedSeries) {
      return null;
    }

    const episodeKey = episodeIndex.toString();
    const episodeLinks = cachedSeries.episodes[episodeKey] || [];

    // 优先使用指定源的链接
    const sourceLink = episodeLinks.find((link) => link.source === source);
    if (sourceLink) {
      return sourceLink.url;
    }

    // 如果没有指定源的链接，返回第一个可用链接
    if (episodeLinks.length > 0) {
      return episodeLinks[0].url;
    }

    return null;
  }

  /**
   * 检查是否有部分下载的文件（用于断点续传）
   */
  private async hasPartialDownload(
    seriesKey: string,
    episodeIndex: number
  ): Promise<boolean> {
    const episodeDir = path.join(
      this.downloadDir,
      seriesKey,
      episodeIndex.toString()
    );

    if (!validatePath(episodeDir, this.downloadDir)) {
      return false;
    }

    try {
      const fs = await import('fs/promises');
      const segmentsDir = path.join(episodeDir, 'segments');

      // 检查 segments 目录是否存在
      try {
        await fs.access(segmentsDir);
      } catch {
        return false; // segments 目录不存在
      }

      // 检查是否有分段文件
      const files = await fs.readdir(segmentsDir);
      const segmentFiles = files.filter(
        (f) => f.startsWith('segment') && f.endsWith('.ts')
      );

      // 如果有分段文件但没有完成标记，说明是部分下载
      if (segmentFiles.length > 0) {
        const metadataFile = path.join(episodeDir, 'download.json');
        interface PartialDownloadMetadata {
          download_status?: string;
        }
        const metadata = await safeReadFile<PartialDownloadMetadata>(
          metadataFile
        );
        // 如果 metadata 不存在或状态不是 completed，说明是部分下载
        return !metadata || metadata.download_status !== 'completed';
      }
    } catch {
      // 忽略错误
    }

    return false;
  }

  /**
   * 查找指定剧集的活跃下载任务（pending 或 downloading）
   */
  private async findActiveTaskForEpisode(
    seriesKey: string,
    episodeIndex: number
  ): Promise<DownloadTask | null> {
    // 1. 检查当前正在下载的任务
    if (
      this.currentDownload &&
      this.currentDownload.series_key === seriesKey &&
      this.currentDownload.episode_index === episodeIndex &&
      (this.currentDownload.status === 'pending' ||
        this.currentDownload.status === 'downloading')
    ) {
      return this.currentDownload;
    }

    // 2. 检查队列中的任务
    const queuedTask = this.downloadQueue.find(
      (task) =>
        task.series_key === seriesKey &&
        task.episode_index === episodeIndex &&
        (task.status === 'pending' || task.status === 'downloading')
    );
    if (queuedTask) {
      return queuedTask;
    }

    // 3. 检查文件系统中的活跃任务（防止服务重启后丢失内存状态）
    try {
      const fs = await import('fs/promises');
      const taskFiles = await fs.readdir(this.tasksDir).catch(() => []);

      for (const fileName of taskFiles) {
        if (!fileName.endsWith('.json')) {
          continue;
        }

        const taskFile = path.join(this.tasksDir, fileName);

        if (!validatePath(taskFile, this.tasksDir)) {
          continue;
        }

        const task = await safeReadFile<DownloadTask>(taskFile);
        if (
          task &&
          task.series_key === seriesKey &&
          task.episode_index === episodeIndex &&
          (task.status === 'pending' ||
            task.status === 'downloading' ||
            task.status === 'paused')
        ) {
          return task;
        }
      }
    } catch {
      // 静默处理错误
    }

    return null;
  }

  /**
   * 获取任务
   */
  private async getTask(taskId: string): Promise<DownloadTask | null> {
    const taskFile = path.join(this.tasksDir, `${taskId}.json`);
    return safeReadFile<DownloadTask>(taskFile);
  }

  /**
   * 获取所有活跃任务
   */
  async getAllActiveTasks(): Promise<DownloadStatus[]> {
    await this.initialize();

    const activeStatuses: DownloadStatus[] = [];

    try {
      const fs = await import('fs/promises');
      const taskFiles = await fs.readdir(this.tasksDir).catch(() => []);

      for (const fileName of taskFiles) {
        if (!fileName.endsWith('.json')) {
          continue;
        }

        const taskFile = path.join(this.tasksDir, fileName);

        if (!validatePath(taskFile, this.tasksDir)) {
          continue;
        }

        const task = await safeReadFile<DownloadTask>(taskFile);
        if (!task) {
          continue;
        }

        // 只返回活跃任务（非 completed 和 failed）
        if (
          task.status !== 'completed' &&
          task.status !== 'failed' &&
          task.status !== 'cancelled'
        ) {
          const status = await this.getDownloadStatus(taskId);
          if (status) {
            activeStatuses.push(status);
          }
        }
      }
    } catch {
      // 静默处理错误
    }

    return activeStatuses;
  }

  /**
   * 保存任务
   */
  private async saveTask(task: DownloadTask): Promise<void> {
    const taskFile = path.join(this.tasksDir, `${task.task_id}.json`);

    // 快速检查：如果 abortController 已触发，不保存（避免覆盖取消状态）
    const abortController = this.abortControllers.get(task.task_id);
    if (abortController?.signal.aborted) {
      return;
    }

    // 读取文件中的实际状态，如果已取消则不保存（双重检查，避免竞态条件）
    try {
      const fileTask = await safeReadFile<DownloadTask>(taskFile);
      if (fileTask?.status === 'cancelled') {
        return; // 文件中的状态是 cancelled，不覆盖
      }
    } catch {
      // 文件不存在，继续保存
    }

    // 再次检查 abortController（在写入前最后检查一次）
    if (abortController?.signal.aborted) {
      return;
    }

    await atomicWriteFile(taskFile, JSON.stringify(task, null, 2));
  }
}

// 单例实例
let videoDownloadServiceInstance: VideoDownloadService | null = null;

/**
 * 获取 VideoDownloadService 单例
 */
export function getVideoDownloadService(): VideoDownloadService {
  if (!videoDownloadServiceInstance) {
    videoDownloadServiceInstance = new VideoDownloadService();
  }
  return videoDownloadServiceInstance;
}
