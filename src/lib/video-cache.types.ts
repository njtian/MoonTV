
/**
 * 集数链接结构
 */
export interface EpisodeLink {
  source: string;
  source_name: string;
  url: string;
  cached_at: number;
}

/**
 * 缓存的剧集数据结构
 */
export interface CachedSeries {
  series_key: string;
  title: string;
  poster: string;
  year: string;
  class?: string;
  desc?: string;
  type_name?: string;
  douban_id?: number;
  episodes: {
    [episodeIndex: string]: EpisodeLink[];
  };
  sources: string[];
  total_episodes: number;
  last_updated: number;
}

/**
 * 缓存元数据
 */
export interface CacheMeta {
  series_key: string;
  title: string;
  created_at: number;
  expires_at: number;
  file_size: number;
  access_count: number;
  last_accessed: number;
  episode_count: number;
  cached_episodes: number[];
  source_count: number;
}

/**
 * 缓存索引条目
 */
export interface CacheIndexEntry {
  series_key: string;
  title: string;
  year: string;
  douban_id?: number;
  episode_count: number;
  cached_episodes: number[];
  sources: string[];
  created_at: number;
  expires_at: number;
  file_path: string;
}

/**
 * 缓存索引
 */
export interface CacheIndex {
  version: string;
  last_updated: number;
  entries: CacheIndexEntry[];
  title_index: { [key: string]: string };
  douban_index: { [key: string]: string };
}

/**
 * 缓存条目（用于状态查询）
 */
export interface CacheEntry {
  series_key: string;
  title: string;
  year: string;
  douban_id?: number;
  episode_count: number;
  cached_episodes: number[];
  cached_episode_count: number;
  sources: string[];
  created_at: number;
  expires_at: number;
  age_seconds: number;
  is_expired: boolean;
  file_size_bytes: number;
  access_count: number;
  last_accessed: number;
}

/**
 * 缓存统计信息
 */
export interface CacheStats {
  total_cached: number;
  total_size_bytes: number;
  total_size_mb: number;
  oldest_cache: number;
  newest_cache: number;
  hit_count: number;
  miss_count: number;
  hit_rate: number;
  average_file_size_bytes: number;
  series_by_source: {
    [source: string]: {
      series_count: number;
      episode_count: number;
    };
  };
  last_cleaned: number;
}

/**
 * 清理选项
 */
export interface ClearOptions {
  type: 'all' | 'expired' | 'series' | 'episode';
  series_key?: string;
  episode_index?: number;
  max_age_hours?: number;
}

/**
 * 清理结果
 */
export interface ClearResult {
  success: boolean;
  deleted_count: number;
  freed_space_mb: number;
  message: string;
  task_id?: string;
}

/**
 * 清理任务
 */
export interface CleanTask {
  task_id: string;
  type: ClearOptions['type'];
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  current: number;
  total: number;
  started_at: number;
  message: string;
  deleted_count?: number;
  freed_space_mb?: number;
  error?: string;
}

/**
 * 下载任务
 */
export interface DownloadTask {
  task_id: string;
  series_key: string;
  episode_index: number;
  title: string;
  episode_title: string;
  requested_source: string;
  current_source: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'paused' | 'cancelled';
  progress: number;
  downloaded_bytes: number;
  total_bytes: number;
  download_speed_mbps: number;
  estimated_time_remaining_seconds: number;
  started_at: number;
  updated_at: number;
  error: string | null;
  retry_count: number;
  source_switches: SourceSwitchRecord[];
  source_switched: boolean;
}

/**
 * 下载状态
 */
export interface DownloadStatus {
  task_id: string;
  series_key: string;
  episode_index: number;
  title: string;
  episode_title: string;
  status: DownloadTask['status'];
  progress: number;
  downloaded_bytes: number;
  total_bytes: number;
  download_speed_mbps: number;
  estimated_time_remaining_seconds: number;
  requested_source: string;
  actual_source: string;
  source_switched: boolean;
  switched_sources: SourceSwitchRecord[];
  started_at: number;
  updated_at: number;
  error: string | null;
}

/**
 * 已下载项
 */
export interface DownloadedItem {
  series_key: string;
  episode_index: number;
  title: string;
  episode_title: string;
  actual_source: string;
  source_name: string;
  file_size_mb: number;
  downloaded_at: number;
  cached_url: string;
  status: 'completed';
}

/**
 * 下载选项
 */
export interface DownloadOptions {
  series_key: string;
  episode_index: number;
  source: string;
  url?: string;
  title: string;
  episode_title: string;
}

/**
 * 源历史数据
 */
export interface SourceHistory {
  source: string;
  totalAttempts: number;
  successCount: number;
  errorCount: number;
  timeoutCount: number;
  avgSpeedMBps: number;
  lastSuccessTime: number;
  lastErrorTime: number;
  recentSpeeds: number[];
}

/**
 * 源评分
 */
export interface SourceScore {
  source: string;
  score: number;
  factors: {
    userSelected: boolean;
    successRate: number;
    avgSpeed: number;
    stability: number;
  };
}

/**
 * 源切换记录
 */
export interface SourceSwitchRecord {
  from: string;
  to: string;
  reason: string;
  timestamp: number;
  error?: string;
}

/**
 * 下载结果
 */
export interface DownloadResult {
  success: boolean;
  error?: string;
  timeout?: boolean;
  speedMBps?: number;
}

/**
 * M3U8 分段
 */
export interface M3U8Segment {
  duration: number;
  url: string;
  sequence: number;
}

/**
 * 主播放列表流信息
 */
export interface StreamInfo {
  bandwidth: number;
  resolution?: string;
  url: string;
}

/**
 * 主播放列表
 */
export interface MasterPlaylist {
  streams: StreamInfo[];
}

/**
 * 媒体播放列表
 */
export interface MediaPlaylist {
  version?: number;
  targetDuration: number;
  segments: M3U8Segment[];
  endList: boolean;
}

/**
 * M3U8 下载结果
 */
export interface M3U8DownloadResult {
  success: boolean;
  file_path: string;
  file_size: number;
  segment_count: number;
  error?: string;
}
