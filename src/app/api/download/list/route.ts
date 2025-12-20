import { NextResponse } from 'next/server';

import { getVideoDownloadService } from '@/lib/video-download-service';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const seriesKey = searchParams.get('series_key');

    const videoDownloadService = getVideoDownloadService();
    await videoDownloadService.initialize();

    const filter = seriesKey ? { seriesKey } : undefined;
    const downloads = await videoDownloadService.getDownloadedList(filter);

    const totalSize = downloads.reduce(
      (sum, item) => sum + item.file_size_mb,
      0
    );

    return NextResponse.json({
      total_downloaded: downloads.length,
      total_size_mb: totalSize,
      downloads: downloads.map((item) => ({
        series_key: item.series_key,
        episode_index: item.episode_index,
        title: item.title,
        episode_title: item.episode_title,
        actual_source: item.actual_source,
        source_name: item.source_name,
        file_size_mb: item.file_size_mb,
        downloaded_at: new Date(item.downloaded_at).toISOString(),
        cached_url: item.cached_url,
      })),
    });
  } catch (error) {
    console.error('获取下载列表失败:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
