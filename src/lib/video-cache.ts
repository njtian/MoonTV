import path from 'path';

import { getCacheTime } from './config';
import { SearchResult } from './types';
import {
  CachedSeries,
  CacheEntry,
  CacheIndex,
  CacheIndexEntry,
  CacheMeta,
  CacheStats,
  ClearOptions,
  ClearResult,
  EpisodeLink,
} from './video-cache.types';
import { normalizeTitle } from './video-cache-key';
import {
  atomicWriteFile,
  ensureDirectory,
  getCacheDir,
  getDirectorySize,
  getFileSize,
  safeDeleteDirectory,
  safeReadFile,
  validatePath,
} from './video-cache-utils';

/**
 * VideoCacheService - 视频缓存服务类
 */
export class VideoCacheService {
  private cacheDir: string;
  private videosDir: string;
  private indexFile: string;
  private statsFile: string;
  private initialized = false;

  constructor() {
    this.cacheDir = getCacheDir();
    this.videosDir = path.join(this.cacheDir, 'videos');
    this.indexFile = path.join(this.cacheDir, 'index.json');
    this.statsFile = path.join(this.cacheDir, 'stats.json');
  }

  /**
   * 初始化缓存目录结构
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // 检查是否启用缓存
    const enableCache = process.env.ENABLE_VIDEO_CACHE !== 'false';
    if (!enableCache) {
      this.initialized = true;
      return;
    }

    try {
      // 创建缓存目录
      await ensureDirectory(this.cacheDir);
      await ensureDirectory(this.videosDir);
      await ensureDirectory(path.join(this.cacheDir, 'downloads'));
      await ensureDirectory(path.join(this.cacheDir, 'tasks'));

      // 初始化索引文件
      const indexExists = await safeReadFile<CacheIndex>(this.indexFile);
      if (!indexExists) {
        const initialIndex: CacheIndex = {
          version: '1.0.0',
          last_updated: Date.now(),
          entries: [],
          title_index: {},
          douban_index: {},
        };
        await atomicWriteFile(
          this.indexFile,
          JSON.stringify(initialIndex, null, 2)
        );
      }

      // 初始化统计文件
      const statsExists = await safeReadFile<CacheStats>(this.statsFile);
      if (!statsExists) {
        const initialStats: CacheStats = {
          total_cached: 0,
          total_size_bytes: 0,
          total_size_mb: 0,
          oldest_cache: 0,
          newest_cache: 0,
          hit_count: 0,
          miss_count: 0,
          hit_rate: 0,
          average_file_size_bytes: 0,
          series_by_source: {},
          last_cleaned: 0,
        };
        await atomicWriteFile(
          this.statsFile,
          JSON.stringify(initialStats, null, 2)
        );
      }

      this.initialized = true;
    } catch (error) {
      console.error('初始化缓存目录失败:', error);
      throw error;
    }
  }

  /**
   * 获取剧集缓存
   */
  async getSeries(seriesKey: string): Promise<CachedSeries | null> {
    await this.initialize();

    const seriesDir = path.join(this.videosDir, seriesKey);
    const dataFile = path.join(seriesDir, 'data.json');

    // 验证路径安全
    if (!validatePath(dataFile, this.videosDir)) {
      return null;
    }

    const data = await safeReadFile<CachedSeries>(dataFile);
    if (!data) {
      return null;
    }

    // 更新访问统计
    await this.updateAccessStats(seriesKey);

    return data;
  }

  /**
   * 设置/更新剧集缓存（合并新源的集数链接）
   */
  async setSeries(seriesKey: string, data: SearchResult): Promise<void> {
    await this.initialize();

    const seriesDir = path.join(this.videosDir, seriesKey);
    const dataFile = path.join(seriesDir, 'data.json');
    const metaFile = path.join(seriesDir, 'meta.json');

    // 验证路径安全
    if (!validatePath(dataFile, this.videosDir)) {
      throw new Error('路径不安全');
    }

    // 确保目录存在
    await ensureDirectory(seriesDir);

    // 读取现有缓存
    const existing = await this.getSeries(seriesKey);
    const now = Date.now();
    const cacheTime = await getCacheTime();
    const expiresAt = now + cacheTime * 1000;

    // 合并集数链接
    const episodes: { [key: string]: EpisodeLink[] } = existing?.episodes || {};
    
    // 将新源的集数链接添加到缓存
    data.episodes.forEach((url, index) => {
      const episodeIndex = (index + 1).toString();
      if (!episodes[episodeIndex]) {
        episodes[episodeIndex] = [];
      }

      // 检查是否已存在相同URL的链接
      const existingLink = episodes[episodeIndex].find(
        (link) => link.url === url
      );

      if (!existingLink) {
        // 添加新链接
        episodes[episodeIndex].push({
          source: data.source,
          source_name: data.source_name,
          url: url,
          cached_at: now,
        });
      } else {
        // 更新现有链接的缓存时间
        existingLink.cached_at = now;
      }
    });

    // 构建缓存数据
    const cachedSeries: CachedSeries = {
      series_key: seriesKey,
      title: data.title,
      poster: data.poster,
      year: data.year,
      class: data.class,
      desc: data.desc,
      type_name: data.type_name,
      douban_id: data.douban_id,
      episodes: episodes,
      sources: existing
        ? Array.from(new Set([...existing.sources, data.source]))
        : [data.source],
      total_episodes: Math.max(
        existing?.total_episodes || 0,
        data.episodes.length
      ),
      last_updated: now,
    };

    // 计算缓存的集数索引
    const cachedEpisodes = Object.keys(episodes).map(Number).sort((a, b) => a - b);

    // 构建元数据
    const meta: CacheMeta = {
      series_key: seriesKey,
      title: data.title,
      created_at: existing
        ? (await safeReadFile<CacheMeta>(metaFile))?.created_at || now
        : now,
      expires_at: expiresAt,
      file_size: 0, // 将在写入后更新
      access_count: existing
        ? (await safeReadFile<CacheMeta>(metaFile))?.access_count || 0
        : 0,
      last_accessed: now,
      episode_count: cachedSeries.total_episodes,
      cached_episodes: cachedEpisodes,
      source_count: cachedSeries.sources.length,
    };

    // 写入文件
    await atomicWriteFile(
      dataFile,
      JSON.stringify(cachedSeries, null, 2)
    );
    await atomicWriteFile(metaFile, JSON.stringify(meta, null, 2));

    // 更新文件大小
    meta.file_size = await getFileSize(dataFile);
    await atomicWriteFile(metaFile, JSON.stringify(meta, null, 2));

    // 更新索引
    await this.updateIndex();
    // 异步更新统计（不阻塞）
    this.updateStats().catch((err) => {
      console.error('更新统计失败:', err);
    });
  }

  /**
   * 检查缓存是否存在且有效
   */
  async isValid(seriesKey: string): Promise<boolean> {
    await this.initialize();

    const seriesDir = path.join(this.videosDir, seriesKey);
    const metaFile = path.join(seriesDir, 'meta.json');

    // 验证路径安全
    if (!validatePath(metaFile, this.videosDir)) {
      return false;
    }

    const meta = await safeReadFile<CacheMeta>(metaFile);
    if (!meta) {
      return false;
    }

    // 检查是否过期
    return Date.now() < meta.expires_at;
  }

  /**
   * 删除剧集缓存
   */
  async deleteSeries(seriesKey: string): Promise<boolean> {
    await this.initialize();

    const seriesDir = path.join(this.videosDir, seriesKey);

    // 验证路径安全
    if (!validatePath(seriesDir, this.videosDir)) {
      return false;
    }

    const deleted = await safeDeleteDirectory(seriesDir);
    if (deleted) {
      await this.updateIndex();
      this.updateStats().catch((err) => {
        console.error('更新统计失败:', err);
      });
    }
    return deleted;
  }

  /**
   * 删除指定集的缓存
   */
  async deleteEpisode(
    seriesKey: string,
    episodeIndex: number
  ): Promise<boolean> {
    await this.initialize();

    const series = await this.getSeries(seriesKey);
    if (!series) {
      return false;
    }

    const episodeKey = episodeIndex.toString();
    if (series.episodes[episodeKey]) {
      delete series.episodes[episodeKey];
    }

    // 更新缓存数据
    const seriesDir = path.join(this.videosDir, seriesKey);
    const dataFile = path.join(seriesDir, 'data.json');
    const metaFile = path.join(seriesDir, 'meta.json');

    // 验证路径安全
    if (!validatePath(dataFile, this.videosDir)) {
      return false;
    }

    await atomicWriteFile(
      dataFile,
      JSON.stringify(series, null, 2)
    );

    // 更新元数据
    const meta = await safeReadFile<CacheMeta>(metaFile);
    if (meta) {
      meta.cached_episodes = meta.cached_episodes.filter(
        (ep) => ep !== episodeIndex
      );
      await atomicWriteFile(metaFile, JSON.stringify(meta, null, 2));
    }

    await this.updateIndex();
    return true;
  }

  /**
   * 获取所有缓存条目
   */
  async getAllEntries(filter?: {
    seriesKey?: string;
    title?: string;
    doubanId?: number;
  }): Promise<CacheEntry[]> {
    await this.initialize();

    const index = await safeReadFile<CacheIndex>(this.indexFile);
    if (!index) {
      return [];
    }

    let entries = index.entries;

    // 应用过滤
    if (filter) {
      if (filter.seriesKey) {
        entries = entries.filter((e) => e.series_key === filter.seriesKey);
      }
      if (filter.title) {
        const normalizedTitle = normalizeTitle(filter.title);
        entries = entries.filter((e) =>
          normalizeTitle(e.title).includes(normalizedTitle)
        );
      }
      if (filter.doubanId) {
        entries = entries.filter((e) => e.douban_id === filter.doubanId);
      }
    }

    // 读取每个条目的详细信息
    const result: CacheEntry[] = [];
    const now = Date.now();

    for (const entry of entries) {
      const seriesDir = path.join(this.videosDir, entry.series_key);
      const metaFile = path.join(seriesDir, 'meta.json');

      if (!validatePath(metaFile, this.videosDir)) {
        continue;
      }

      const meta = await safeReadFile<CacheMeta>(metaFile);
      if (meta) {
        result.push({
          series_key: entry.series_key,
          title: entry.title,
          year: entry.year,
          douban_id: entry.douban_id,
          episode_count: entry.episode_count,
          cached_episodes: entry.cached_episodes,
          cached_episode_count: entry.cached_episodes.length,
          sources: entry.sources,
          created_at: entry.created_at,
          expires_at: entry.expires_at,
          age_seconds: Math.floor((now - entry.created_at) / 1000),
          is_expired: now >= entry.expires_at,
          file_size_bytes: meta.file_size,
          access_count: meta.access_count,
          last_accessed: meta.last_accessed,
        });
      }
    }

    return result;
  }

  /**
   * 获取缓存统计
   */
  async getStats(): Promise<CacheStats> {
    await this.initialize();

    const stats = await safeReadFile<CacheStats>(this.statsFile);
    if (stats) {
      return stats;
    }

    // 如果统计文件不存在，重新计算
    return this.updateStats();
  }

  /**
   * 清理缓存
   */
  async clear(options: ClearOptions): Promise<ClearResult> {
    await this.initialize();

    let deletedCount = 0;
    let freedSpaceBytes = 0;

    try {
      if (options.type === 'all') {
        // 清理所有缓存
        const index = await safeReadFile<CacheIndex>(this.indexFile);
        if (index) {
          for (const entry of index.entries) {
            const seriesDir = path.join(this.videosDir, entry.series_key);
            if (validatePath(seriesDir, this.videosDir)) {
              const size = await getDirectorySize(seriesDir);
              if (await safeDeleteDirectory(seriesDir)) {
                deletedCount++;
                freedSpaceBytes += size;
              }
            }
          }
        }
      } else if (options.type === 'expired') {
        // 清理过期缓存
        const now = Date.now();
        const maxAge = options.max_age_hours
          ? options.max_age_hours * 3600 * 1000
          : Infinity;

        const index = await safeReadFile<CacheIndex>(this.indexFile);
        if (index) {
          for (const entry of index.entries) {
            const isExpired = now >= entry.expires_at;
            const isOld = now - entry.created_at > maxAge;

            if (isExpired || isOld) {
              const seriesDir = path.join(this.videosDir, entry.series_key);
              if (validatePath(seriesDir, this.videosDir)) {
                const size = await getDirectorySize(seriesDir);
                if (await safeDeleteDirectory(seriesDir)) {
                  deletedCount++;
                  freedSpaceBytes += size;
                }
              }
            }
          }
        }
      } else if (options.type === 'series' && options.series_key) {
        // 清理指定剧集
        const seriesDir = path.join(this.videosDir, options.series_key);
        if (validatePath(seriesDir, this.videosDir)) {
          const size = await getDirectorySize(seriesDir);
          if (await safeDeleteDirectory(seriesDir)) {
            deletedCount++;
            freedSpaceBytes += size;
          }
        }
      } else if (
        options.type === 'episode' &&
        options.series_key &&
        options.episode_index
      ) {
        // 清理指定集的缓存
        await this.deleteEpisode(
          options.series_key,
          options.episode_index
        );
        deletedCount = 1;
        // 集级别的空间释放较小，这里简化处理
        freedSpaceBytes = 0;
      }

      // 更新索引和统计
      await this.updateIndex();
      await this.updateStats();

      return {
        success: true,
        deleted_count: deletedCount,
        freed_space_mb: freedSpaceBytes / (1024 * 1024),
        message: `成功清理 ${deletedCount} 个缓存`,
      };
    } catch (error) {
      console.error('清理缓存失败:', error);
      return {
        success: false,
        deleted_count: deletedCount,
        freed_space_mb: freedSpaceBytes / (1024 * 1024),
        message: `清理失败: ${(error as Error).message}`,
      };
    }
  }

  /**
   * 记录缓存命中
   */
  async recordHit(): Promise<void> {
    await this.initialize();

    const stats = await this.getStats();
    stats.hit_count++;
    stats.hit_rate =
      stats.hit_count / (stats.hit_count + stats.miss_count) || 0;

    await atomicWriteFile(this.statsFile, JSON.stringify(stats, null, 2));
  }

  /**
   * 记录缓存未命中
   */
  async recordMiss(): Promise<void> {
    await this.initialize();

    const stats = await this.getStats();
    stats.miss_count++;
    stats.hit_rate =
      stats.hit_count / (stats.hit_count + stats.miss_count) || 0;

    await atomicWriteFile(this.statsFile, JSON.stringify(stats, null, 2));
  }

  /**
   * 更新访问统计
   */
  private async updateAccessStats(seriesKey: string): Promise<void> {
    const seriesDir = path.join(this.videosDir, seriesKey);
    const metaFile = path.join(seriesDir, 'meta.json');

    if (!validatePath(metaFile, this.videosDir)) {
      return;
    }

    const meta = await safeReadFile<CacheMeta>(metaFile);
    if (meta) {
      meta.access_count++;
      meta.last_accessed = Date.now();
      await atomicWriteFile(metaFile, JSON.stringify(meta, null, 2));
    }
  }

  /**
   * 更新索引
   */
  private async updateIndex(): Promise<void> {
    const index = await safeReadFile<CacheIndex>(this.indexFile);
    if (!index) {
      return;
    }

    const entries: CacheIndexEntry[] = [];
    const titleIndex: { [key: string]: string } = {};
    const doubanIndex: { [key: string]: string } = {};

    try {
      const files = await require('fs').promises.readdir(this.videosDir);
      
      for (const file of files) {
        const seriesKey = file;
        const seriesDir = path.join(this.videosDir, seriesKey);
        const dataFile = path.join(seriesDir, 'data.json');
        const metaFile = path.join(seriesDir, 'meta.json');

        if (!validatePath(dataFile, this.videosDir)) {
          continue;
        }

        const data = await safeReadFile<CachedSeries>(dataFile);
        const meta = await safeReadFile<CacheMeta>(metaFile);

        if (data && meta) {
          const cachedEpisodes = Object.keys(data.episodes)
            .map(Number)
            .sort((a, b) => a - b);

          const entry: CacheIndexEntry = {
            series_key: seriesKey,
            title: data.title,
            year: data.year,
            douban_id: data.douban_id,
            episode_count: data.total_episodes,
            cached_episodes: cachedEpisodes,
            sources: data.sources,
            created_at: meta.created_at,
            expires_at: meta.expires_at,
            file_path: `videos/${seriesKey}/data.json`,
          };

          entries.push(entry);

          // 更新标题索引
          const normalizedTitle = normalizeTitle(data.title);
          const yearStr = data.year.match(/\d{4}/)?.[0] || 'unknown';
          const titleKey = `title_${normalizedTitle}_${yearStr}`;
          titleIndex[titleKey] = seriesKey;

          // 更新豆瓣ID索引
          if (data.douban_id) {
            doubanIndex[data.douban_id.toString()] = seriesKey;
          }
        }
      }

      index.entries = entries;
      index.title_index = titleIndex;
      index.douban_index = doubanIndex;
      index.last_updated = Date.now();

      await atomicWriteFile(
        this.indexFile,
        JSON.stringify(index, null, 2)
      );
    } catch (error) {
      console.error('更新索引失败:', error);
    }
  }

  /**
   * 更新统计信息
   */
  private async updateStats(): Promise<CacheStats> {
    const index = await safeReadFile<CacheIndex>(this.indexFile);
    const existingStats = await safeReadFile<CacheStats>(this.statsFile);

    const stats: CacheStats = {
      total_cached: 0,
      total_size_bytes: 0,
      total_size_mb: 0,
      oldest_cache: 0,
      newest_cache: 0,
      hit_count: existingStats?.hit_count || 0,
      miss_count: existingStats?.miss_count || 0,
      hit_rate: 0,
      average_file_size_bytes: 0,
      series_by_source: {},
      last_cleaned: existingStats?.last_cleaned || 0,
    };

    if (!index) {
      await atomicWriteFile(this.statsFile, JSON.stringify(stats, null, 2));
      return stats;
    }

    stats.total_cached = index.entries.length;

    let totalSize = 0;
    let oldestTime = Infinity;
    let newestTime = 0;
    const sourceMap: {
      [source: string]: { series_count: number; episode_count: number };
    } = {};

    for (const entry of index.entries) {
      const seriesDir = path.join(this.videosDir, entry.series_key);
      if (validatePath(seriesDir, this.videosDir)) {
        const size = await getDirectorySize(seriesDir);
        totalSize += size;

        if (entry.created_at < oldestTime) {
          oldestTime = entry.created_at;
        }
        if (entry.created_at > newestTime) {
          newestTime = entry.created_at;
        }

        // 统计按源的数据
        for (const source of entry.sources) {
          if (!sourceMap[source]) {
            sourceMap[source] = { series_count: 0, episode_count: 0 };
          }
          sourceMap[source].series_count++;
          sourceMap[source].episode_count += entry.cached_episodes.length;
        }
      }
    }

    stats.total_size_bytes = totalSize;
    stats.total_size_mb = totalSize / (1024 * 1024);
    stats.oldest_cache = oldestTime === Infinity ? 0 : oldestTime;
    stats.newest_cache = newestTime;
    stats.hit_rate =
      stats.hit_count / (stats.hit_count + stats.miss_count) || 0;
    stats.average_file_size_bytes =
      stats.total_cached > 0 ? totalSize / stats.total_cached : 0;
    stats.series_by_source = sourceMap;

    await atomicWriteFile(this.statsFile, JSON.stringify(stats, null, 2));
    return stats;
  }
}

// 单例实例
let videoCacheServiceInstance: VideoCacheService | null = null;

/**
 * 获取 VideoCacheService 单例
 */
export function getVideoCacheService(): VideoCacheService {
  if (!videoCacheServiceInstance) {
    videoCacheServiceInstance = new VideoCacheService();
  }
  return videoCacheServiceInstance;
}
