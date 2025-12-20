import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';
import path from 'path';

import { getCacheDir, validatePath } from '@/lib/video-cache-utils';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const seriesKey = searchParams.get('series_key');
    const episodeIndex = searchParams.get('episode_index');
    const keyName = searchParams.get('key') || 'key.key';

    if (!seriesKey || !episodeIndex) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const cacheDir = getCacheDir();
    const keyPath = path.join(
      cacheDir,
      'downloads',
      seriesKey,
      episodeIndex,
      keyName
    );

    if (!validatePath(keyPath, cacheDir)) {
      return NextResponse.json({ error: '路径不安全' }, { status: 400 });
    }

    // Ensure file exists
    try {
      await fs.access(keyPath);
    } catch {
      return NextResponse.json({ error: '密钥文件不存在' }, { status: 404 });
    }

    const keyBytes = await fs.readFile(keyPath);
    return new NextResponse(keyBytes, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
