import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';
import path from 'path';

import { getCacheDir, validatePath } from '@/lib/video-cache-utils';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const seriesKey = searchParams.get('series_key');
    const episodeIndex = searchParams.get('episode_index');
    const segment = searchParams.get('segment');

    if (!seriesKey || !episodeIndex || !segment) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const cacheDir = getCacheDir();
    const segmentPath = path.join(
      cacheDir,
      'downloads',
      seriesKey,
      episodeIndex,
      'segments',
      segment
    );

    if (!validatePath(segmentPath, cacheDir)) {
      return NextResponse.json({ error: '路径不安全' }, { status: 400 });
    }

    // 检查文件是否存在
    try {
      await fs.access(segmentPath);
    } catch {
      return NextResponse.json({ error: '分段文件不存在' }, { status: 404 });
    }

    // 读取文件
    const fileBuffer = await fs.readFile(segmentPath);

    // 支持Range请求
    const range = request.headers.get('range');
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileBuffer.length - 1;
      const chunk = fileBuffer.slice(start, end + 1);

      return new NextResponse(chunk, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileBuffer.length}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunk.length.toString(),
          'Content-Type': 'video/mp2t',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    // 返回完整文件
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': 'video/mp2t',
        'Content-Length': fileBuffer.length.toString(),
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
