import { NextResponse } from 'next/server';
import { getVideoDownloadService } from '@/lib/video-download-service';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { series_key, episode_index } = body;

    if (!series_key || episode_index === undefined) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    const videoDownloadService = getVideoDownloadService();
    await videoDownloadService.initialize();

    const result = await videoDownloadService.deleteDownload(
      series_key,
      parseInt(episode_index.toString(), 10)
    );

    if (!result.success) {
      return NextResponse.json(
        { error: '文件不存在或删除失败' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: '文件已删除',
      freed_space_mb: result.freedSpaceMB,
    });
  } catch (error) {
    console.error('删除下载文件失败:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
