import { NextResponse } from 'next/server';

import { getVideoCacheService } from '@/lib/video-cache';

export async function GET(request: Request) {
  try {
    const videoCacheService = getVideoCacheService();
    await videoCacheService.initialize();

    const stats = await videoCacheService.getStats();

    return NextResponse.json({
      total_cached: stats.total_cached,
      total_size_bytes: stats.total_size_bytes,
      total_size_mb: stats.total_size_mb,
      oldest_cache: stats.oldest_cache
        ? new Date(stats.oldest_cache).toISOString()
        : null,
      newest_cache: stats.newest_cache
        ? new Date(stats.newest_cache).toISOString()
        : null,
      hit_count: stats.hit_count,
      miss_count: stats.miss_count,
      hit_rate: stats.hit_rate,
      average_file_size_bytes: stats.average_file_size_bytes,
      series_by_source: stats.series_by_source,
      last_cleaned: stats.last_cleaned
        ? new Date(stats.last_cleaned).toISOString()
        : null,
    });
  } catch (error) {
    console.error('获取缓存统计失败:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
