import path from 'path';

import { SearchResult } from './types';
import { CacheIndex } from './video-cache.types';
import { getCacheDir, safeReadFile } from './video-cache-utils';

/**
 * 标准化标题
 * 移除特殊字符，保留中文和英文，转小写，去除空格
 */
export function normalizeTitle(title: string): string {
  return (
    title
      .toLowerCase()
      // 移除常见的标点符号和特殊字符，保留中文和英文
      .replace(/[^\w\u4e00-\u9fa5]/g, '')
      // 统一处理空格和空白字符
      .replace(/\s+/g, '')
      .trim()
  );
}

/**
 * 生成剧集标识（series_key）
 * 优先使用豆瓣ID，否则使用标准化标题+年份
 */
export function generateSeriesKey(data: SearchResult): string {
  // 优先使用豆瓣ID
  if (data.douban_id) {
    return `douban_${data.douban_id}`;
  }

  // 使用标准化标题+年份
  const normalizedTitle = normalizeTitle(data.title);
  const year = data.year.match(/\d{4}/)?.[0] || 'unknown';
  return `title_${normalizedTitle}_${year}`;
}

/**
 * 根据标题/豆瓣ID查找剧集标识
 * 支持模糊匹配
 */
export async function findSeriesKey(
  title?: string,
  year?: string,
  doubanId?: number,
  options?: {
    fuzzyMatch?: boolean;
    yearTolerance?: number;
  }
): Promise<string | null> {
  const cacheDir = getCacheDir();
  const indexFile = path.join(cacheDir, 'index.json');
  const index = await safeReadFile<CacheIndex>(indexFile);

  if (!index) {
    return null;
  }

  // 优先使用豆瓣ID查找
  if (doubanId) {
    const seriesKey = index.douban_index[doubanId.toString()];
    if (seriesKey) {
      return seriesKey;
    }
  }

  // 使用标题查找
  if (title) {
    const normalizedTitle = normalizeTitle(title);
    const yearStr = year?.match(/\d{4}/)?.[0] || 'unknown';
    const titleKey = `title_${normalizedTitle}_${yearStr}`;

    // 精确匹配
    const seriesKey = index.title_index[titleKey];
    if (seriesKey) {
      return seriesKey;
    }

    // 模糊匹配
    if (options?.fuzzyMatch) {
      const yearTolerance = options.yearTolerance || 0;
      const yearNum = parseInt(yearStr);

      // 遍历所有条目查找相似标题
      for (const entry of index.entries) {
        const entryNormalizedTitle = normalizeTitle(entry.title);
        const entryYearNum = parseInt(entry.year || '0');

        // 标题相似度检查（简单实现：包含关系）
        const titleSimilar =
          normalizedTitle.includes(entryNormalizedTitle) ||
          entryNormalizedTitle.includes(normalizedTitle);

        // 年份容差检查
        const yearMatch =
          yearTolerance === 0
            ? entry.year === yearStr
            : Math.abs(yearNum - entryYearNum) <= yearTolerance;

        if (titleSimilar && yearMatch) {
          return entry.series_key;
        }
      }
    }
  }

  return null;
}

/**
 * 查找可能的重复剧集（用于管理界面）
 */
export async function findPossibleDuplicates(
  title: string,
  year?: string
): Promise<
  Array<{
    series_key: string;
    title: string;
    year: string;
    similarity: number;
  }>
> {
  const cacheDir = getCacheDir();
  const indexFile = path.join(cacheDir, 'index.json');
  const index = await safeReadFile<CacheIndex>(indexFile);

  if (!index) {
    return [];
  }

  const normalizedTitle = normalizeTitle(title);
  const yearStr = year?.match(/\d{4}/)?.[0] || '';
  const results: Array<{
    series_key: string;
    title: string;
    year: string;
    similarity: number;
  }> = [];

  for (const entry of index.entries) {
    const entryNormalizedTitle = normalizeTitle(entry.title);

    // 计算相似度（简单实现：基于包含关系和编辑距离）
    let similarity = 0;

    // 标题相似度
    if (normalizedTitle === entryNormalizedTitle) {
      similarity += 100;
    } else if (
      normalizedTitle.includes(entryNormalizedTitle) ||
      entryNormalizedTitle.includes(normalizedTitle)
    ) {
      similarity += 50;
    } else {
      // 简单的编辑距离计算（简化版）
      const maxLen = Math.max(
        normalizedTitle.length,
        entryNormalizedTitle.length
      );
      const minLen = Math.min(
        normalizedTitle.length,
        entryNormalizedTitle.length
      );
      if (maxLen > 0) {
        similarity += (minLen / maxLen) * 30;
      }
    }

    // 年份匹配
    if (yearStr && entry.year === yearStr) {
      similarity += 20;
    }

    if (similarity > 30) {
      results.push({
        series_key: entry.series_key,
        title: entry.title,
        year: entry.year,
        similarity: Math.min(100, similarity),
      });
    }
  }

  // 按相似度降序排序
  results.sort((a, b) => b.similarity - a.similarity);

  return results;
}
