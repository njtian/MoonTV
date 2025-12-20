import { NextResponse } from 'next/server';
import { getVideoDownloadService } from '@/lib/video-download-service';
import { DownloadOptions } from '@/lib/video-cache.types';
import { getVideoCacheService } from '@/lib/video-cache';
import { getDetailFromApi } from '@/lib/downstream';
import { getAvailableApiSites } from '@/lib/config';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      series_key,
      episode_index,
      source,
      url,
      title,
      episode_title,
    } = body;

    if (!series_key || !episode_index || !source || !title) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    const videoDownloadService = getVideoDownloadService();
    await videoDownloadService.initialize();

    // 检查是否已下载
    const isDownloaded = await videoDownloadService.isDownloaded(
      series_key,
      episode_index
    );
    if (isDownloaded) {
      return NextResponse.json({
        success: true,
        message: '该集已下载',
        already_downloaded: true,
      });
    }

    // 如果未提供URL，从缓存中查找
    let downloadUrl = url;
    if (!downloadUrl) {
      const videoCacheService = getVideoCacheService();
      await videoCacheService.initialize();
      const cachedSeries = await videoCacheService.getSeries(series_key);

      if (!cachedSeries) {
        // 缓存不存在，尝试创建缓存
        // 需要知道source和id，但这里只有series_key，无法直接获取
        // 返回错误提示
        return NextResponse.json(
          {
            error: '剧集缓存不存在，请先调用 /api/detail 接口创建缓存',
            series_key,
          },
          { status: 404 }
        );
      }

      const episodeKey = episode_index.toString();
      const episodeLinks = cachedSeries.episodes[episodeKey] || [];
      const sourceLink = episodeLinks.find((link) => link.source === source);

      if (!sourceLink) {
        return NextResponse.json(
          {
            error: '该集没有指定源的链接',
            series_key,
            episode_index,
            source,
          },
          { status: 404 }
        );
      }

      downloadUrl = sourceLink.url;
    }

    const options: DownloadOptions = {
      series_key,
      episode_index: parseInt(episode_index.toString(), 10),
      source,
      url: downloadUrl,
      title,
      episode_title: episode_title || `第${episode_index}集`,
    };

    const task = await videoDownloadService.startDownload(options);

    return NextResponse.json({
      success: true,
      task_id: task.task_id,
      message: '下载任务已创建',
      status: task.status,
    });
  } catch (error) {
    console.error('创建下载任务失败:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
