'use client';

import React from 'react';
import { X, Download, CheckCircle, AlertCircle } from 'lucide-react';
import { DownloadStatus } from '@/lib/video-cache.types';

interface DownloadProgressProps {
  status: DownloadStatus;
  onClose?: () => void;
  onCancel?: () => void;
}

export default function DownloadProgress({
  status,
  onClose,
  onCancel,
}: DownloadProgressProps) {
  // 使用 useRef 来跟踪上次的状态，用于计算瞬时速度
  const prevStateRef = React.useRef<{
    downloaded_bytes: number;
    updated_at: number;
  } | null>(null);
  const [calculatedSpeed, setCalculatedSpeed] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (status.status === 'downloading' && status.downloaded_bytes > 0) {
      const now = Date.now();
      const prev = prevStateRef.current;

      if (prev && prev.downloaded_bytes < status.downloaded_bytes) {
        const timeDiff = (now - prev.updated_at) / 1000; // 秒
        const bytesDiff = status.downloaded_bytes - prev.downloaded_bytes;
        
        if (timeDiff > 0) {
          // 计算瞬时速度 (MB/s)
          const speedMBps = (bytesDiff / (1024 * 1024)) / timeDiff;
          setCalculatedSpeed(speedMBps);
        }
      }

      prevStateRef.current = {
        downloaded_bytes: status.downloaded_bytes,
        updated_at: status.updated_at || now,
      };
    } else {
      prevStateRef.current = null;
      setCalculatedSpeed(null);
    }
  }, [status.downloaded_bytes, status.updated_at, status.status]);

  // 优先使用后端速度，如果为0则使用前端计算的瞬时速度
  const displaySpeed = React.useMemo(() => {
    return status.download_speed_mbps > 0 
      ? status.download_speed_mbps 
      : (calculatedSpeed || 0);
  }, [status.download_speed_mbps, calculatedSpeed]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${Math.round(seconds)}秒`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    if (minutes < 60) {
      return `${minutes}分${remainingSeconds}秒`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}小时${remainingMinutes}分`;
  };

  const formatSpeed = (mbps: number): string => {
    if (mbps < 0.001) return '0 KB/s';
    if (mbps < 1) return `${(mbps * 1024).toFixed(2)} KB/s`;
    return `${mbps.toFixed(2)} MB/s`;
  };

  const getStatusIcon = () => {
    switch (status.status) {
      case 'completed':
        return <CheckCircle className="w-6 h-6 text-green-500" />;
      case 'failed':
        return <AlertCircle className="w-6 h-6 text-red-500" />;
      case 'downloading':
        return <Download className="w-6 h-6 text-blue-500 animate-pulse" />;
      default:
        return <Download className="w-6 h-6 text-gray-500" />;
    }
  };

  const getStatusText = () => {
    switch (status.status) {
      case 'completed':
        return '下载完成';
      case 'failed':
        return '下载失败';
      case 'downloading':
        return '下载中';
      case 'pending':
        return '等待中';
      case 'cancelled':
        return '已取消';
      default:
        return '未知状态';
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-3 w-full">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {getStatusIcon()}
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white truncate">
              {status.episode_title || `第${status.episode_index}集`}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {status.title}
            </p>
          </div>
        </div>
        {onClose && status.status !== 'downloading' && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0 ml-2"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 进度信息 */}
      {status.status === 'downloading' && (
        <div className="mb-2">
          {/* 进度条 */}
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-1.5">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${status.progress * 100}%` }}
            />
          </div>

          {/* 进度文本 */}
          <div className="flex justify-between items-center text-xs text-gray-600 dark:text-gray-400 mb-1">
            <span className="font-medium">{`${(status.progress * 100).toFixed(1)}%`}</span>
            <span>
              {formatBytes(status.downloaded_bytes)}
              {status.total_bytes > status.downloaded_bytes && (
                <> / {formatBytes(status.total_bytes)}</>
              )}
            </span>
          </div>

          {/* 速度和剩余时间 */}
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-500">
            <span>
              速度: {displaySpeed > 0 
                ? formatSpeed(displaySpeed)
                : '0 KB/s'}
            </span>
            {status.estimated_time_remaining_seconds > 0 && (
              <span>
                剩余: {formatTime(status.estimated_time_remaining_seconds)}
              </span>
            )}
            {displaySpeed > 0 && status.total_bytes > status.downloaded_bytes && (
              <span>
                剩余: {formatTime(
                  Math.ceil((status.total_bytes - status.downloaded_bytes) / (displaySpeed * 1024 * 1024))
                )}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 完成状态 */}
      {status.status === 'completed' && (
        <div className="mb-2">
          <div className="bg-green-50 dark:bg-green-900/20 rounded p-2">
            <p className="text-xs text-green-700 dark:text-green-400">
              ✓ 下载完成
            </p>
            {status.total_bytes > 0 && (
              <p className="text-xs text-green-600 dark:text-green-500 mt-0.5">
                文件大小: {formatBytes(status.total_bytes)}
              </p>
            )}
          </div>
        </div>
      )}

      {/* 失败状态 */}
      {status.status === 'failed' && (
        <div className="mb-2">
          <div className="bg-red-50 dark:bg-red-900/20 rounded p-2">
            <p className="text-xs text-red-700 dark:text-red-400">
              ✗ 下载失败
            </p>
            {status.error && (
              <p className="text-xs text-red-600 dark:text-red-500 mt-0.5 truncate">
                {status.error}
              </p>
            )}
          </div>
        </div>
      )}

      {/* 源信息和操作按钮 */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3 text-xs">
          <span className="text-gray-500 dark:text-gray-400">
            {status.requested_source}
          </span>
          {status.source_switched && status.switched_sources.length > 0 && (
            <span className="text-yellow-600 dark:text-yellow-500">
              ⚠ 已切换
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {status.status === 'downloading' && onCancel && (
            <button
              onClick={onCancel}
              className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
            >
              取消
            </button>
          )}
          {onClose && status.status !== 'downloading' && (
            <button
              onClick={onClose}
              className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              关闭
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
