import { NextResponse } from 'next/server';

import { SearchResult } from '@/lib/types';
import { getVideoCacheService } from '@/lib/video-cache';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      series_key,
      episode_index,
      source,
      url,
      source_name,
    } = body;

    if (!series_key || !episode_index || !source || !url) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    const videoCacheService = getVideoCacheService();
    await videoCacheService.initialize();

    // 检查缓存是否存在
    const cachedSeries = await videoCacheService.getSeries(series_key);

    if (!cachedSeries) {
      // 缓存不存在，尝试从API获取数据创建缓存
      // 注意：这里需要知道 source 和 id，但客户端可能没有提供
      // 如果无法创建，返回错误提示
      return NextResponse.json(
        {
          error: '缓存不存在，请先调用 /api/detail 接口创建缓存',
          series_key,
        },
        { status: 404 }
      );
    }

    // 更新集数链接
    const episodeKey = episode_index.toString();
    if (!cachedSeries.episodes[episodeKey]) {
      cachedSeries.episodes[episodeKey] = [];
    }

    // 检查是否已存在相同URL的链接
    const existingLink = cachedSeries.episodes[episodeKey].find(
      (link) => link.url === url
    );

    if (!existingLink) {
      // 检查是否已存在相同源的链接，如果有则更新
      const existingSourceLink = cachedSeries.episodes[episodeKey].find(
        (link) => link.source === source
      );

      if (existingSourceLink) {
        // 更新现有链接
        existingSourceLink.url = url;
        existingSourceLink.source_name = source_name || existingSourceLink.source_name;
        existingSourceLink.cached_at = Date.now();
      } else {
        // 添加新链接
        cachedSeries.episodes[episodeKey].push({
          source: source,
          source_name: source_name || source,
          url: url,
          cached_at: Date.now(),
        });
      }

      // 更新 sources 列表
      if (!cachedSeries.sources.includes(source)) {
        cachedSeries.sources.push(source);
      }

      // 更新缓存
      // 构建 SearchResult 用于更新缓存
      const searchResult: SearchResult = {
        id: '',
        title: cachedSeries.title,
        poster: cachedSeries.poster,
        episodes: [url], // 只包含这一个URL
        source: source,
        source_name: source_name || source,
        class: cachedSeries.class,
        year: cachedSeries.year,
        desc: cachedSeries.desc,
        type_name: cachedSeries.type_name,
        douban_id: cachedSeries.douban_id,
      };

      // 使用 setSeries 更新缓存（会合并链接）
      await videoCacheService.setSeries(series_key, searchResult);
    }

    return NextResponse.json({
      success: true,
      message: '缓存已更新',
      series_key,
    });
  } catch (error) {
    console.error('更新缓存失败:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
