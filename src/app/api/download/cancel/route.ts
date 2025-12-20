import { NextResponse } from 'next/server';

import { getVideoDownloadService } from '@/lib/video-download-service';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { task_id } = body;

    if (!task_id) {
      return NextResponse.json(
        { error: '缺少 task_id 参数' },
        { status: 400 }
      );
    }

    const videoDownloadService = getVideoDownloadService();
    await videoDownloadService.initialize();

    const cancelled = await videoDownloadService.cancelDownload(task_id);

    if (!cancelled) {
      return NextResponse.json(
        { error: '任务不存在或无法取消' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: '下载任务已取消',
    });
  } catch (error) {
    console.error('取消下载任务失败:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
