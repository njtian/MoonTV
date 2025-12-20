'use client';

import { createContext, useContext, useEffect, useState, useRef, useMemo, ReactNode } from 'react';
import { getAllActiveTasks } from '@/lib/video-cache.client';
import { DownloadStatus } from '@/lib/video-cache.types';

// Context 类型定义
interface DownloadStatusContextValue {
  // 获取指定任务的状态
  getTaskStatus: (seriesKey: string, episodeIndex: number) => DownloadStatus | undefined;
  // 获取所有任务（按 seriesKey 过滤）
  getAllTasksForSeries: (seriesKey: string) => DownloadStatus[];
  // 获取所有任务（不按 seriesKey 过滤，用于 ActiveDownloadsList）
  getAllTasks: () => DownloadStatus[];
  // 手动刷新（用于用户操作后立即更新）
  refresh: () => Promise<void>;
  // 是否正在加载
  loading: boolean;
}

const DownloadStatusContext = createContext<DownloadStatusContextValue | null>(null);

// Hook
export const useDownloadStatus = () => {
  const context = useContext(DownloadStatusContext);
  if (!context) {
    throw new Error('useDownloadStatus must be used within DownloadStatusProvider');
  }
  return context;
};

// Safe hook that returns null if context is not available (for backward compatibility)
export const useDownloadStatusSafe = () => {
  return useContext(DownloadStatusContext);
};

// Provider 组件
interface DownloadStatusProviderProps {
  children: ReactNode;
  // 可选的 seriesKey，如果提供则只轮询该系列的任务
  seriesKey?: string;
  // 轮询间隔（毫秒），默认 2000
  pollInterval?: number;
  // 是否启用轮询，默认 true
  enabled?: boolean;
}

export default function DownloadStatusProvider({
  children,
  seriesKey,
  pollInterval = 2000,
  enabled = true,
}: DownloadStatusProviderProps) {
  // 所有任务状态（key: `${seriesKey}_${episodeIndex}`）
  const [tasksMap, setTasksMap] = useState<Map<string, DownloadStatus>>(new Map());
  const [allTasks, setAllTasks] = useState<DownloadStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  // 轮询函数
  const pollTasks = async () => {
    if (!mountedRef.current) return;

    try {
      const data = await getAllActiveTasks();

      if (!mountedRef.current) return;

      setAllTasks(data.tasks); // 存储所有任务
      const newTasksMap = new Map<string, DownloadStatus>();

      data.tasks.forEach((task) => {
        // 如果指定了 seriesKey，只保留该系列的任务
        if (seriesKey && task.series_key !== seriesKey) {
          return;
        }

        const key = `${task.series_key}_${task.episode_index}`;
        newTasksMap.set(key, task);
      });

      setTasksMap(newTasksMap);
      setLoading(false);
    } catch (error) {
      console.warn('获取下载任务状态失败:', error);
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  };

  // 手动刷新
  const refresh = async () => {
    setLoading(true);
    await pollTasks();
  };

  // 轮询逻辑
  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      setLoading(false);
      return;
    }

    // 立即执行一次
    pollTasks();

    // 设置轮询
    pollingIntervalRef.current = setInterval(pollTasks, pollInterval);

    return () => {
      mountedRef.current = false;
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [seriesKey, pollInterval, enabled]);

  // 页面可见性控制（页面隐藏时停止轮询）
  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // 页面隐藏，停止轮询
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      } else {
        // 页面可见，恢复轮询
        if (!pollingIntervalRef.current) {
          pollTasks(); // 立即执行一次
          pollingIntervalRef.current = setInterval(pollTasks, pollInterval);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [pollInterval, enabled]);

  // Context 值 - 使用 useMemo 确保 tasksMap 更新时重新创建
  const contextValue: DownloadStatusContextValue = useMemo(() => ({
    getTaskStatus: (targetSeriesKey: string, episodeIndex: number) => {
      const key = `${targetSeriesKey}_${episodeIndex}`;
      return tasksMap.get(key);
    },
    getAllTasksForSeries: (targetSeriesKey: string) => {
      return Array.from(tasksMap.values()).filter(
        (task) => task.series_key === targetSeriesKey
      );
    },
    getAllTasks: () => {
      // 如果指定了 seriesKey，返回过滤后的任务；否则返回所有任务
      if (seriesKey) {
        return Array.from(tasksMap.values());
      }
      return allTasks;
    },
    refresh,
    loading,
  }), [tasksMap, allTasks, seriesKey, loading]);

  return (
    <DownloadStatusContext.Provider value={contextValue}>
      {children}
    </DownloadStatusContext.Provider>
  );
}
