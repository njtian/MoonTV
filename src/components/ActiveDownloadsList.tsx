'use client';

import { useState, useEffect, useRef } from 'react';
import DownloadProgress from './DownloadProgress';
import {
  getAllActiveTasks,
  cancelDownload,
  getDownloadStatus,
} from '@/lib/video-cache.client';
import { DownloadStatus } from '@/lib/video-cache.types';

interface ActiveDownloadsListProps {
  onTaskComplete?: () => void;
}

export default function ActiveDownloadsList({
  onTaskComplete,
}: ActiveDownloadsListProps) {
  const [tasks, setTasks] = useState<DownloadStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  const loadActiveTasks = async () => {
    try {
      const data = await getAllActiveTasks();
      if (!mountedRef.current) return;

      // 更新任务状态
      setTasks(data.tasks);

      // 检查是否有任务完成或失败，触发回调
      const completedOrFailed = data.tasks.filter(
        (task) => task.status === 'completed' || task.status === 'failed'
      );
      if (completedOrFailed.length > 0) {
        onTaskComplete?.();
      }

      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError((err as Error).message || '加载活跃任务失败');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    loadActiveTasks();

    // 开始轮询
    pollingIntervalRef.current = setInterval(() => {
      loadActiveTasks();
    }, 2000); // 每2秒更新一次

    return () => {
      mountedRef.current = false;
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [onTaskComplete]);

  const handleCancel = async (taskId: string) => {
    try {
      await cancelDownload(taskId);
      // 重新加载任务列表
      await loadActiveTasks();
    } catch (err) {
      alert((err as Error).message || '取消下载失败');
    }
  };

  const handleClose = async (taskId: string) => {
    // 检查任务是否已完成或失败，如果是则从列表中移除
    try {
      const status = await getDownloadStatus(taskId);
      if (!status || status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
        setTasks((prev) => prev.filter((task) => task.task_id !== taskId));
        onTaskComplete?.();
      }
    } catch (err) {
      // 如果任务不存在，也从列表中移除
      setTasks((prev) => prev.filter((task) => task.task_id !== taskId));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500"></div>
        <span className="ml-2 text-gray-600 dark:text-gray-400">加载中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="text-red-500 text-2xl mb-2">⚠️</div>
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <button
            onClick={loadActiveTasks}
            className="mt-4 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <p className="text-gray-600 dark:text-gray-400">暂无进行中的下载任务</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tasks.map((task) => (
        <div key={task.task_id} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg">
          <DownloadProgress
            status={task}
            onCancel={() => handleCancel(task.task_id)}
            onClose={() => handleClose(task.task_id)}
          />
        </div>
      ))}
    </div>
  );
}
