import { NextResponse } from 'next/server';
import { getVideoDownloadService } from '@/lib/video-download-service';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const seriesKey = searchParams.get('series_key');
    const episodeIndex = searchParams.get('episode_index');

    if (!seriesKey || !episodeIndex) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    const episodeIndexNum = parseInt(episodeIndex, 10);
    if (isNaN(episodeIndexNum)) {
      return NextResponse.json(
        { error: '无效的集数' },
        { status: 400 }
      );
    }

    // 使用 videoDownloadService 的私有方法检查部分下载
    // 为了访问私有方法，我们直接检查文件系统
    const hasPartial = await checkPartialDownload(seriesKey, episodeIndexNum);

    return NextResponse.json({
      has_partial_download: hasPartial,
    });
  } catch (error) {
    console.error('检查部分下载失败:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

async function checkPartialDownload(
  seriesKey: string,
  episodeIndex: number
): Promise<boolean> {
  const { promises: fs } = await import('fs');
  const path = await import('path');
  const { getCacheDir, validatePath, safeReadFile } = await import('@/lib/video-cache-utils');

  const cacheDir = getCacheDir();
  const episodeDir = path.join(
    cacheDir,
    'downloads',
    seriesKey,
    episodeIndex.toString()
  );

  if (!validatePath(episodeDir, path.join(cacheDir, 'downloads'))) {
    return false;
  }

  try {
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
      const metadata = await safeReadFile<any>(metadataFile);
      // 如果 metadata 不存在或状态不是 completed，说明是部分下载
      return !metadata || metadata.download_status !== 'completed';
    }
  } catch {
    // 忽略错误
  }

  return false;
}
