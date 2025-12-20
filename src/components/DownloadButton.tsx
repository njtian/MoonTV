'use client';

import { Download, Check, X, Loader2, Trash2, Play } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import {
  startDownload,
  getDownloadStatus,
  cancelDownload,
  isEpisodeDownloaded,
  deleteDownload,
  hasPartialDownload,
  getAllActiveTasks,
} from '@/lib/video-cache.client';
import { DownloadStatus } from '@/lib/video-cache.types';

interface DownloadButtonProps {
  seriesKey: string;
  episodeIndex: number;
  source: string;
  url?: string;
  title: string;
  episodeTitle: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

type DownloadState =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'cancelled';

export default function DownloadButton({
  seriesKey,
  episodeIndex,
  source,
  url,
  title,
  episodeTitle,
  className = '',
  size = 'sm',
}: DownloadButtonProps) {
  const [state, setState] = useState<DownloadState>('idle');
  const [progress, setProgress] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false); // 是否处于准备删除状态
  const [hasPartial, setHasPartial] = useState(false); // 是否有部分下载

  const statusIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const deleteTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    // 检查是否已下载
    checkDownloaded();
    return () => {
      isMountedRef.current = false;
      if (statusIntervalRef.current) {
        clearInterval(statusIntervalRef.current);
        statusIntervalRef.current = null;
      }
      if (deleteTimeoutRef.current) {
        clearTimeout(deleteTimeoutRef.current);
        deleteTimeoutRef.current = null;
      }
    };
  }, [seriesKey, episodeIndex]);

  const checkDownloaded = async () => {
    try {
      // 首先检查是否有正在进行的下载任务
      try {
        const activeTasks = await getAllActiveTasks();
        const activeTask = activeTasks.tasks.find(
          (task) =>
            task.series_key === seriesKey &&
            task.episode_index === episodeIndex &&
            (task.status === 'pending' || task.status === 'downloading')
        );

        if (activeTask && isMountedRef.current) {
          // 找到正在进行的任务，恢复下载状态
          setTaskId(activeTask.task_id);
          setState(activeTask.status === 'pending' ? 'downloading' : 'downloading');
          setProgress(activeTask.progress);
          setDownloadSpeed(activeTask.download_speed_mbps);
          setHasPartial(false);
          setPendingDelete(false);
          // 开始轮询任务状态
          startPolling(activeTask.task_id);
          return;
        }
      } catch (error) {
        console.warn('检查活跃任务失败:', error);
        // 继续检查其他状态
      }

      // 检查是否已下载
      const downloaded = await isEpisodeDownloaded(seriesKey, episodeIndex);
      if (downloaded && isMountedRef.current) {
        setState('completed');
        setPendingDelete(false); // 重置准备删除状态
        setHasPartial(false);
      } else if (isMountedRef.current) {
        // 检查是否有部分下载的文件
        const partial = await hasPartialDownload(seriesKey, episodeIndex);
        if (isMountedRef.current) {
          setHasPartial(partial);
          setState('idle');
          setPendingDelete(false); // 重置准备删除状态
          console.log(`[DownloadButton] ${seriesKey} 第${episodeIndex}集 - 部分下载: ${partial}`);
        }
      }
    } catch (error) {
      console.warn('检查下载状态失败:', error);
      if (isMountedRef.current) {
        setState('idle');
        setPendingDelete(false); // 重置准备删除状态
        setHasPartial(false);
      }
    }
  };

  const handleDownload = async () => {
    if (state === 'downloading' || state === 'checking') {
      return;
    }

    // 如果处于准备删除状态，不处理（由 handleDeleteClick 处理）
    if (pendingDelete) {
      return;
    }

    // 已完成、已取消或失败状态不应该调用 handleDownload
    // 这些状态应该通过 handleButtonClick -> handleDeleteClick 处理
    if (state === 'completed' || state === 'cancelled' || state === 'failed') {
      return;
    }

    setState('checking');
    setError(null);

    try {
      const result = await startDownload({
        series_key: seriesKey,
        episode_index: episodeIndex,
        source: source,
        url: url,
        title: title,
        episode_title: episodeTitle,
      });

      if (result.already_downloaded) {
        setState('completed');
        return;
      }

      if (!result.task_id) {
        throw new Error('未获取到任务ID');
      }

      setTaskId(result.task_id);
      setState('downloading');
      setHasPartial(false); // 开始下载后重置部分下载状态
      startPolling(result.task_id);
    } catch (error) {
      console.error('开始下载失败:', error);
      const errorMessage = (error as Error).message || '下载失败';
      setError(errorMessage);
      
      // 如果错误是"已有下载任务"，尝试查找并恢复该任务
      if (errorMessage.includes('已有下载任务') || errorMessage.includes('下载中')) {
        try {
          const activeTasks = await getAllActiveTasks();
          const activeTask = activeTasks.tasks.find(
            (task) =>
              task.series_key === seriesKey &&
              task.episode_index === episodeIndex &&
              (task.status === 'pending' || task.status === 'downloading')
          );

          if (activeTask && isMountedRef.current) {
            // 找到正在进行的任务，恢复下载状态
            setTaskId(activeTask.task_id);
            setState('downloading');
            setProgress(activeTask.progress);
            setDownloadSpeed(activeTask.download_speed_mbps);
            setError(null);
            setHasPartial(false);
            startPolling(activeTask.task_id);
            return;
          }
        } catch (recoveryError) {
          console.warn('恢复下载任务失败:', recoveryError);
        }
      }
      
      setState('failed');
    }
  };

  const startPolling = (tid: string) => {
    if (statusIntervalRef.current) {
      clearInterval(statusIntervalRef.current);
    }

    statusIntervalRef.current = setInterval(async () => {
      try {
        const status = await getDownloadStatus(tid);
        if (!status) {
          // 任务不存在，可能已完成或失败
          await checkDownloaded();
          if (statusIntervalRef.current) {
            clearInterval(statusIntervalRef.current);
            statusIntervalRef.current = null;
          }
          return;
        }

        if (!isMountedRef.current) return;

        setProgress(status.progress);
        setDownloadSpeed(status.download_speed_mbps);

        if (status.status === 'completed') {
          setState('completed');
          setProgress(100);
          setPendingDelete(false); // 重置准备删除状态
          setHasPartial(false); // 重置部分下载状态
          if (statusIntervalRef.current) {
            clearInterval(statusIntervalRef.current);
            statusIntervalRef.current = null;
          }
        } else if (status.status === 'failed') {
          setState('failed');
          setError(status.error || '下载失败');
          setPendingDelete(false); // 重置准备删除状态
          // 失败时检查是否有部分下载
          const partial = await hasPartialDownload(seriesKey, episodeIndex);
          setHasPartial(partial);
          if (statusIntervalRef.current) {
            clearInterval(statusIntervalRef.current);
            statusIntervalRef.current = null;
          }
        } else if (status.status === 'cancelled') {
          setState('cancelled');
          setPendingDelete(false); // 重置准备删除状态
          // 取消时检查是否有部分下载
          const partial = await hasPartialDownload(seriesKey, episodeIndex);
          setHasPartial(partial);
          if (statusIntervalRef.current) {
            clearInterval(statusIntervalRef.current);
            statusIntervalRef.current = null;
          }
        }
      } catch (error) {
        console.error('获取下载状态失败:', error);
        // 继续轮询，不中断
      }
    }, 1000); // 每秒查询一次
  };

  const handleCancel = async () => {
    if (!taskId || state !== 'downloading') {
      return;
    }

    try {
      await cancelDownload(taskId);
      setState('cancelled');
      // 取消后检查是否有部分下载
      const partial = await hasPartialDownload(seriesKey, episodeIndex);
      setHasPartial(partial);
      if (statusIntervalRef.current) {
        clearInterval(statusIntervalRef.current);
        statusIntervalRef.current = null;
      }
    } catch (error) {
      console.error('取消下载失败:', error);
    }
  };

  const handleDeleteClick = async () => {
    if (state === 'downloading' || state === 'checking') {
      return; // 下载中不能删除
    }

    // 如果已经在准备删除状态，执行删除
    if (pendingDelete) {
      // 清除定时器
      if (deleteTimeoutRef.current) {
        clearTimeout(deleteTimeoutRef.current);
        deleteTimeoutRef.current = null;
      }
      setPendingDelete(false);

      // 执行删除
      try {
        await deleteDownload(seriesKey, episodeIndex);
        setState('idle');
        setProgress(0);
        setError(null);
        setTaskId(null);
        setHasPartial(false); // 重置部分下载状态
        await checkDownloaded();
      } catch (error) {
        console.error('删除下载失败:', error);
        setError((error as Error).message || '删除失败');
        // 删除失败后，保持当前状态
      }
    } else {
      // 第一次点击，进入准备删除状态
      setPendingDelete(true);

      // 清除之前的定时器
      if (deleteTimeoutRef.current) {
        clearTimeout(deleteTimeoutRef.current);
      }

      // 3秒后自动恢复
      deleteTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          setPendingDelete(false);
          deleteTimeoutRef.current = null;
        }
      }, 3000);
    }
  };

  const sizeClasses = {
    sm: 'w-6 h-6 p-1',
    md: 'w-8 h-8 p-1.5',
    lg: 'w-10 h-10 p-2',
  };

  const iconSizes = {
    sm: 14,
    md: 18,
    lg: 22,
  };

  const iconSize = iconSizes[size];
  const sizeClass = sizeClasses[size];

  // 确定按钮的点击处理函数
  const handleButtonClick = () => {
    if (state === 'downloading' || state === 'checking') {
      handleCancel();
    } else if (state === 'completed' || state === 'cancelled' || state === 'failed') {
      // 已完成、已取消或失败：第一次点击进入准备删除状态，第二次点击执行删除
      handleDeleteClick();
    } else {
      // 空闲状态：开始下载
      handleDownload();
    }
  };

  // 确定显示的图标
  const getIcon = () => {
    if (state === 'checking') {
      return <Loader2 className="animate-spin" size={iconSize} />;
    } else if (state === 'downloading') {
      return <X size={iconSize} />;
    } else if (state === 'completed' || state === 'cancelled' || state === 'failed') {
      // 如果处于准备删除状态，显示删除图标，否则显示对应的状态图标
      return pendingDelete ? <Trash2 size={iconSize} /> : 
        (state === 'completed' ? <Check size={iconSize} /> : <X size={iconSize} />);
    } else {
      // 空闲状态：如果有部分下载，显示继续图标，否则显示下载图标
      return hasPartial ? <Play size={iconSize} /> : <Download size={iconSize} />;
    }
  };

  // 确定按钮的样式
  const getButtonClassName = () => {
    if (pendingDelete) {
      return `bg-red-500/20 text-red-500 hover:bg-red-500/30`;
    } else if (state === 'completed') {
      return `bg-green-500/20 text-green-500 hover:bg-green-500/30`;
    } else if (state === 'downloading' || state === 'checking') {
      return `bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30`;
    } else if (state === 'failed' || state === 'cancelled') {
      return `bg-red-500/20 text-red-500 hover:bg-red-500/30`;
    } else {
      return `bg-gray-500/20 text-gray-400 hover:bg-gray-500/30 hover:text-gray-300`;
    }
  };

  // 确定按钮的提示文本
  const getButtonTitle = () => {
    if (pendingDelete) {
      return '再次点击确认删除';
    } else if (state === 'completed') {
      return '已下载（点击删除）';
    } else if (state === 'downloading') {
      return `下载中 ${(progress * 100).toFixed(0)}% (点击取消)`;
    } else if (state === 'failed') {
      return `下载失败: ${error || '未知错误'} (点击删除)`;
    } else if (state === 'cancelled') {
      return `已取消 (点击删除)`;
    } else if (state === 'checking') {
      return '检查中...';
    } else {
      // 如果有部分下载，显示继续下载提示
      return hasPartial ? '继续下载' : '下载';
    }
  };

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <button
        onClick={handleButtonClick}
        disabled={state === 'checking'}
        className={`
          ${sizeClass}
          rounded-full
          transition-all
          duration-200
          flex items-center justify-center
          ${getButtonClassName()}
          disabled:opacity-50
          disabled:cursor-not-allowed
        `}
        title={getButtonTitle()}
      >
        {getIcon()}
      </button>

      {/* 下载进度条（仅在下载中显示） */}
      {state === 'downloading' && (
        <div
          className="absolute -bottom-1 left-0 right-0 h-0.5 bg-yellow-500 rounded-full transition-all duration-300"
          style={{ width: `${progress * 100}%` }}
        />
      )}

      {/* 错误提示 */}
      {state === 'failed' && error && (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-red-500 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10">
          {error}
        </div>
      )}
    </div>
  );
}
