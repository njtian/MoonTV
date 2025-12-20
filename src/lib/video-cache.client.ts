/**
 * 视频缓存和下载相关的客户端 API 函数
 */

import {
  CacheEntry,
  CacheStats,
  ClearOptions,
  ClearResult,
  DownloadOptions,
  DownloadStatus,
  DownloadedItem,
} from './video-cache.types';

/**
 * 通知服务器播放成功，更新缓存
 */
export async function notifyPlaybackSuccess(
  seriesKey: string,
  episodeIndex: number,
  source: string,
  url: string,
  sourceName?: string
): Promise<void> {
  try {
    const response = await fetch('/api/cache/update-episode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        series_key: seriesKey,
        episode_index: episodeIndex,
        source: source,
        url: url,
        source_name: sourceName,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: '未知错误' }));
      throw new Error(error.error || '更新缓存失败');
    }
  } catch (error) {
    // 静默失败，不影响播放
    console.warn('缓存更新失败（不影响播放）:', error);
    throw error;
  }
}

/**
 * 获取缓存状态
 */
export async function getCacheStatus(filter?: {
  seriesKey?: string;
  title?: string;
  doubanId?: number;
}): Promise<{
  cache_enabled: boolean;
  cache_dir: string;
  total_cached: number;
  total_size_mb: number;
  entries: CacheEntry[];
  stats: {
    hit_count: number;
    miss_count: number;
    hit_rate: number;
  };
}> {
  const params = new URLSearchParams();
  if (filter?.seriesKey) {
    params.append('series_key', filter.seriesKey);
  }
  if (filter?.title) {
    params.append('title', filter.title);
  }
  if (filter?.doubanId) {
    params.append('douban_id', filter.doubanId.toString());
  }

  const url = `/api/cache/status${params.toString() ? `?${params.toString()}` : ''}`;
  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '未知错误' }));
    throw new Error(error.error || '获取缓存状态失败');
  }

  return response.json();
}

/**
 * 获取缓存统计信息
 */
export async function getCacheStats(): Promise<CacheStats> {
  const response = await fetch('/api/cache/stats');

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '未知错误' }));
    throw new Error(error.error || '获取缓存统计失败');
  }

  return response.json();
}

/**
 * 清理缓存
 */
export async function clearCache(options: ClearOptions): Promise<ClearResult> {
  const response = await fetch('/api/cache/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '未知错误' }));
    throw new Error(error.error || '清理缓存失败');
  }

  return response.json();
}

/**
 * 获取清理进度
 */
export async function getCacheProgress(taskId: string): Promise<{
  task_id: string;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  current: number;
  total: number;
  message: string;
  started_at: string;
  estimated_completion?: string;
  deleted_count?: number;
  freed_space_mb?: number;
  error?: string;
}> {
  const response = await fetch(`/api/cache/progress?task_id=${taskId}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '未知错误' }));
    throw new Error(error.error || '获取清理进度失败');
  }

  return response.json();
}

/**
 * 开始下载视频文件
 */
export async function startDownload(
  options: DownloadOptions
): Promise<{
  success: boolean;
  task_id: string;
  message: string;
  status: string;
  already_downloaded?: boolean;
}> {
  const response = await fetch('/api/download/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '未知错误' }));
    throw new Error(error.error || '开始下载失败');
  }

  return response.json();
}

/**
 * 获取下载状态
 */
export async function getDownloadStatus(
  taskId: string
): Promise<DownloadStatus | null> {
  const response = await fetch(`/api/download/status?task_id=${taskId}`);

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    const error = await response.json().catch(() => ({ error: '未知错误' }));
    throw new Error(error.error || '获取下载状态失败');
  }

  const data = await response.json();
  return data as DownloadStatus;
}

/**
 * 取消下载任务
 */
export async function cancelDownload(taskId: string): Promise<void> {
  const response = await fetch('/api/download/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: taskId }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '未知错误' }));
    throw new Error(error.error || '取消下载失败');
  }
}

/**
 * 获取已下载文件列表
 */
export async function getDownloadedList(seriesKey?: string): Promise<{
  total_downloaded: number;
  total_size_mb: number;
  downloads: DownloadedItem[];
}> {
  const url = seriesKey
    ? `/api/download/list?series_key=${seriesKey}`
    : '/api/download/list';

  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '未知错误' }));
    throw new Error(error.error || '获取下载列表失败');
  }

  return response.json();
}

/**
 * 获取已下载文件的播放 URL
 */
export function getDownloadedPlayUrl(
  seriesKey: string,
  episodeIndex: number
): string {
  // IMPORTANT: HLS playlists are aggressively cached by browsers when Cache-Control allows it.
  // We add a cache-busting query to ensure the latest rewritten playlist (absolute segment URLs)
  // is always fetched, otherwise old cached playlists can keep pointing to invalid relative paths.
  return `/api/download/play?series_key=${encodeURIComponent(seriesKey)}&episode_index=${episodeIndex}&_cb=${Date.now()}`;
}

/**
 * 删除已下载文件
 */
export async function deleteDownload(
  seriesKey: string,
  episodeIndex: number
): Promise<{
  success: boolean;
  message: string;
  freed_space_mb: number;
}> {
  const response = await fetch('/api/download/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      series_key: seriesKey,
      episode_index: episodeIndex,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '未知错误' }));
    throw new Error(error.error || '删除下载文件失败');
  }

  return response.json();
}

/**
 * 检查指定集是否已下载
 */
export async function isEpisodeDownloaded(
  seriesKey: string,
  episodeIndex: number
): Promise<boolean> {
  try {
    const list = await getDownloadedList(seriesKey);
    return list.downloads.some(
      (item) => item.episode_index === episodeIndex
    );
  } catch (error) {
    console.warn('检查下载状态失败:', error);
    return false;
  }
}

/**
 * 检查指定集是否有部分下载的文件（用于断点续传）
 */
export async function hasPartialDownload(
  seriesKey: string,
  episodeIndex: number
): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/download/check-partial?series_key=${encodeURIComponent(seriesKey)}&episode_index=${episodeIndex}`
    );

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return data.has_partial_download || false;
  } catch (error) {
    console.warn('检查部分下载状态失败:', error);
    return false;
  }
}

/**
 * 获取所有活跃的下载任务
 */
export async function getAllActiveTasks(): Promise<{
  tasks: DownloadStatus[];
  total: number;
}> {
  const response = await fetch('/api/download/status');

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '未知错误' }));
    throw new Error(error.error || '获取活跃任务失败');
  }

  const data = await response.json();
  // 转换时间戳：API 返回 ISO 字符串，需要转换为时间戳（毫秒）
  return {
    tasks: data.tasks.map((task: any) => ({
      ...task,
      started_at: typeof task.started_at === 'string' 
        ? new Date(task.started_at).getTime() 
        : task.started_at,
      updated_at: typeof task.updated_at === 'string'
        ? new Date(task.updated_at).getTime()
        : task.updated_at,
    })),
    total: data.total,
  };
}
