import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';
import path from 'path';

import { getAvailableApiSites, getCacheTime } from '@/lib/config';
import { getDetailFromApi } from '@/lib/downstream';
import { SearchResult } from '@/lib/types';
import { getVideoCacheService } from '@/lib/video-cache';
import { CacheMeta } from '@/lib/video-cache.types';
import { generateSeriesKey } from '@/lib/video-cache-key';
import { getCacheDir } from '@/lib/video-cache-utils';

// export const runtime = 'edge'; // 注释掉Edge Runtime，因为getCacheTime()需要访问数据库

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const sourceCode = searchParams.get('source');

  if (!id || !sourceCode) {
    return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
  }

  if (!/^[\w-]+$/.test(id)) {
    return NextResponse.json({ error: '无效的视频ID格式' }, { status: 400 });
  }

  try {
    const apiSites = await getAvailableApiSites();
    const apiSite = apiSites.find((site) => site.key === sourceCode);

    if (!apiSite) {
      return NextResponse.json({ error: '无效的API来源' }, { status: 400 });
    }

    const videoCacheService = getVideoCacheService();
    await videoCacheService.initialize();

    // 先调用API获取数据（用于生成series_key）
    const result = await getDetailFromApi(apiSite, id);

    // 生成剧集标识
    const seriesKey = generateSeriesKey(result);

    // 检查缓存是否存在且有效
    const isValid = await videoCacheService.isValid(seriesKey);
    let cachedData = null;

    if (isValid) {
      cachedData = await videoCacheService.getSeries(seriesKey);
      if (cachedData) {
        await videoCacheService.recordHit();

        // 合并新源的集数链接到缓存数据
        // 将新源的集数链接添加到响应中
        const mergedEpisodes = [...result.episodes];

        // 构建响应数据
        const responseData: SearchResult & {
          _cached: boolean;
          _series_key: string;
          _cache_age?: number;
        } = {
          ...result,
          episodes: mergedEpisodes,
          _cached: true,
          _series_key: seriesKey,
        };

        // 计算缓存年龄
        try {
          const cacheDir = getCacheDir();
          const metaFile = path.join(
            cacheDir,
            'videos',
            seriesKey,
            'meta.json'
          );
          const metaContent = await fs.readFile(metaFile, 'utf-8');
          const meta = JSON.parse(metaContent) as CacheMeta;
          const ageSeconds = Math.floor((Date.now() - meta.created_at) / 1000);
          responseData._cache_age = ageSeconds;
        } catch {
          // 忽略错误，继续处理
        }

        // 异步更新缓存（合并新源）
        videoCacheService.setSeries(seriesKey, result).catch((err) => {
          // eslint-disable-next-line no-console
          console.error('更新缓存失败:', err);
        });

        const cacheTime = await getCacheTime();
        return NextResponse.json(responseData, {
          headers: {
            'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
            'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
            'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          },
        });
      }
    }

    // 缓存未命中或无效，使用API数据
    await videoCacheService.recordMiss();

    // 异步写入缓存（不阻塞响应）
    videoCacheService.setSeries(seriesKey, result).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('写入缓存失败:', err);
    });

    const responseData: SearchResult & {
      _cached: boolean;
      _series_key: string;
    } = {
      ...result,
      _cached: false,
      _series_key: seriesKey,
    };

    const cacheTime = await getCacheTime();
    return NextResponse.json(responseData, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    const errorStack = error instanceof Error ? error.stack : undefined;
    // eslint-disable-next-line no-console
    console.error('Detail API Error:', {
      error: errorMessage,
      stack: errorStack,
      source: sourceCode,
      id: id,
    });
    return NextResponse.json(
      {
        error: errorMessage,
        source: sourceCode,
        id: id,
      },
      { status: 500 }
    );
  }
}
