import path from 'path';

import { DownloadResult, SourceHistory } from './video-cache.types';
import {
  atomicWriteFile,
  ensureDirectory,
  getCacheDir,
  safeReadFile,
} from './video-cache-utils';

const HISTORY_DIR = 'source-history';
const MAX_RECENT_SPEEDS = 10;

/**
 * 获取源历史数据
 */
export async function getSourceHistory(source: string): Promise<SourceHistory> {
  const cacheDir = getCacheDir();
  const historyDir = path.join(cacheDir, HISTORY_DIR);
  await ensureDirectory(historyDir);

  const historyFile = path.join(historyDir, `${source}.json`);
  const history = await safeReadFile<SourceHistory>(historyFile);

  if (history) {
    return history;
  }

  // 返回默认历史数据
  return {
    source,
    totalAttempts: 0,
    successCount: 0,
    errorCount: 0,
    timeoutCount: 0,
    avgSpeedMBps: 0,
    lastSuccessTime: 0,
    lastErrorTime: 0,
    recentSpeeds: [],
  };
}

/**
 * 更新源历史数据
 */
export async function updateSourceHistory(
  source: string,
  result: DownloadResult
): Promise<void> {
  const history = await getSourceHistory(source);

  history.totalAttempts++;

  if (result.success) {
    history.successCount++;
    history.lastSuccessTime = Date.now();

    if (result.speedMBps !== undefined) {
      history.recentSpeeds.push(result.speedMBps);

      // 只保留最近N次的速度记录
      if (history.recentSpeeds.length > MAX_RECENT_SPEEDS) {
        history.recentSpeeds.shift();
      }

      // 重新计算平均速度
      if (history.recentSpeeds.length > 0) {
        history.avgSpeedMBps =
          history.recentSpeeds.reduce((a, b) => a + b, 0) /
          history.recentSpeeds.length;
      }
    }
  } else {
    if (result.timeout) {
      history.timeoutCount++;
    } else {
      history.errorCount++;
    }
    history.lastErrorTime = Date.now();
  }

  // 保存历史数据
  const cacheDir = getCacheDir();
  const historyDir = path.join(cacheDir, HISTORY_DIR);
  await ensureDirectory(historyDir);

  const historyFile = path.join(historyDir, `${source}.json`);
  await atomicWriteFile(historyFile, JSON.stringify(history, null, 2));
}

/**
 * 清理旧的历史数据（可选功能）
 */
export async function cleanupOldHistory(maxAgeDays = 30): Promise<void> {
  const cacheDir = getCacheDir();
  const historyDir = path.join(cacheDir, HISTORY_DIR);
  const cutoffTime = Date.now() - maxAgeDays * 24 * 3600 * 1000;

  try {
    const fs = await import('fs/promises');
    const files = await fs.readdir(historyDir);

    for (const file of files) {
      if (file.endsWith('.json')) {
        const historyFile = path.join(historyDir, file);
        const history = await safeReadFile<SourceHistory>(historyFile);

        if (history) {
          // 如果最后成功时间和最后错误时间都超过阈值，且总尝试次数为0，可以删除
          if (
            history.totalAttempts === 0 ||
            (history.lastSuccessTime < cutoffTime &&
              history.lastErrorTime < cutoffTime &&
              history.totalAttempts < 10)
          ) {
            await fs.unlink(historyFile).catch(() => {
              // 忽略删除错误
            });
          }
        }
      }
    }
  } catch {
    // 静默处理清理错误
  }
}
