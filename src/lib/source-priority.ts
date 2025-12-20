import { getSourceHistory } from './source-history';
import { SourceHistory, SourceScore } from './video-cache.types';

/**
 * 计算稳定性评分
 */
export function calculateStability(history: SourceHistory): number {
  if (history.totalAttempts === 0) {
    return 0.5; // 默认中等稳定性
  }

  const errorRate = history.errorCount / history.totalAttempts;
  const timeoutRate = history.timeoutCount / history.totalAttempts;

  // 稳定性 = 1 - 错误率 - 超时率（最低0）
  return Math.max(0, 1 - errorRate - timeoutRate);
}

/**
 * 计算源综合评分
 */
export function calculateSourceScore(
  source: string,
  userSelected: boolean,
  history: SourceHistory
): SourceScore {
  const factors = {
    userSelected,
    successRate:
      history.totalAttempts > 0
        ? history.successCount / history.totalAttempts
        : 0.5, // 默认50%成功率
    avgSpeed: Math.min(history.avgSpeedMBps || 0, 10), // 最高10MB/s
    stability: calculateStability(history),
  };

  const score =
    (factors.userSelected ? 50 : 0) +
    factors.successRate * 30 +
    factors.avgSpeed * 1 +
    factors.stability * 10;

  return { source, score, factors };
}

/**
 * 获取源优先级排序列表
 */
export async function getSourcePriority(
  sources: string[],
  userSelectedSource: string
): Promise<string[]> {
  // 获取所有源的历史数据
  const sourceHistories = await Promise.all(
    sources.map((source) => getSourceHistory(source))
  );

  // 计算每个源的综合评分
  const scoredSources = sources.map((source, index) =>
    calculateSourceScore(
      source,
      source === userSelectedSource,
      sourceHistories[index]
    )
  );

  // 按评分降序排序
  scoredSources.sort((a, b) => b.score - a.score);

  // 返回排序后的源列表
  return scoredSources.map((s) => s.source);
}
