import { NextResponse } from 'next/server';

import { getVideoCacheService } from '@/lib/video-cache';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const seriesKey = searchParams.get('series_key');
    const title = searchParams.get('title');
    const doubanIdParam = searchParams.get('douban_id');

    const videoCacheService = getVideoCacheService();
    await videoCacheService.initialize();

    const filter: {
      seriesKey?: string;
      title?: string;
      doubanId?: number;
    } = {};

    if (seriesKey) {
      filter.seriesKey = seriesKey;
    }
    if (title) {
      filter.title = title;
    }
    if (doubanIdParam) {
      const doubanId = parseInt(doubanIdParam, 10);
      if (!isNaN(doubanId)) {
        filter.doubanId = doubanId;
      }
    }

    const entries = await videoCacheService.getAllEntries(filter);
    const stats = await videoCacheService.getStats();

    return NextResponse.json({
      cache_enabled: process.env.ENABLE_VIDEO_CACHE !== 'false',
      cache_dir: process.env.VIDEO_CACHE_DIR || '.cache/videos',
      total_cached: entries.length,
      total_size_mb: stats.total_size_mb,
      entries: entries.map((entry) => ({
        series_key: entry.series_key,
        title: entry.title,
        year: entry.year,
        douban_id: entry.douban_id,
        episode_count: entry.episode_count,
        cached_episodes: entry.cached_episodes,
        cached_episode_count: entry.cached_episode_count,
        sources: entry.sources,
        created_at: new Date(entry.created_at).toISOString(),
        expires_at: new Date(entry.expires_at).toISOString(),
        age_seconds: entry.age_seconds,
        is_expired: entry.is_expired,
        file_size_bytes: entry.file_size_bytes,
        access_count: entry.access_count,
        last_accessed: new Date(entry.last_accessed).toISOString(),
      })),
      stats: {
        hit_count: stats.hit_count,
        miss_count: stats.miss_count,
        hit_rate: stats.hit_rate,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
