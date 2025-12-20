'use client';

import { Download, Play, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  deleteDownload,
  getDownloadedList,
  getDownloadedPlayUrl,
} from '@/lib/video-cache.client';
import { DownloadedItem } from '@/lib/video-cache.types';

interface DownloadListProps {
  seriesKey?: string;
  onRefresh?: () => void;
}

export default function DownloadList({
  seriesKey,
  onRefresh,
}: DownloadListProps) {
  const [downloads, setDownloads] = useState<DownloadedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const loadDownloads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getDownloadedList(seriesKey);
      setDownloads(data.downloads);
    } catch (err) {
      setError((err as Error).message || '加载下载列表失败');
    } finally {
      setLoading(false);
    }
  }, [seriesKey]);

  useEffect(() => {
    loadDownloads();
  }, [loadDownloads]);

  const handleDelete = async (item: DownloadedItem) => {
    const itemId = `${item.series_key}-${item.episode_index}`;
    if (deletingIds.has(itemId)) return;

    if (!confirm(`确定要删除"${item.episode_title}"吗？`)) {
      return;
    }

    setDeletingIds((prev) => new Set(prev).add(itemId));
    try {
      await deleteDownload(item.series_key, item.episode_index);
      await loadDownloads();
      onRefresh?.();
    } catch (err) {
      alert((err as Error).message || '删除失败');
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  };

  const handlePlay = (item: DownloadedItem) => {
    const url = getDownloadedPlayUrl(item.series_key, item.episode_index);
    // 在新窗口打开播放页面
    window.open(url, '_blank');
  };

  const formatBytes = (mb: number): string => {
    if (mb < 1) return `${(mb * 1024).toFixed(0)} KB`;
    if (mb < 1024) return `${mb.toFixed(2)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  };

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // 按剧集分组
  const groupedDownloads = downloads.reduce(
    (acc, item) => {
      if (!acc[item.series_key]) {
        acc[item.series_key] = {
          title: item.title,
          items: [],
        };
      }
      acc[item.series_key].items.push(item);
      return acc;
    },
    {} as Record<
      string,
      {
        title: string;
        items: DownloadedItem[];
      }
    >
  );

  if (loading) {
    return (
      <div className='flex items-center justify-center py-12'>
        <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-green-500'></div>
        <span className='ml-2 text-gray-600 dark:text-gray-400'>加载中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex items-center justify-center py-12'>
        <div className='text-center'>
          <div className='text-red-500 text-2xl mb-2'>⚠️</div>
          <p className='text-sm text-red-600 dark:text-red-400'>{error}</p>
          <button
            onClick={loadDownloads}
            className='mt-4 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors'
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (downloads.length === 0) {
    return (
      <div className='flex items-center justify-center py-12'>
        <div className='text-center'>
          <Download className='w-12 h-12 text-gray-400 mx-auto mb-4' />
          <p className='text-gray-600 dark:text-gray-400'>暂无已下载文件</p>
        </div>
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {Object.entries(groupedDownloads).map(([key, group]) => (
        <div
          key={key}
          className='bg-white dark:bg-gray-800 rounded-lg shadow p-4'
        >
          <h3 className='text-lg font-semibold text-gray-900 dark:text-white mb-4'>
            {group.title}
          </h3>
          <div className='space-y-2'>
            {group.items
              .sort((a, b) => a.episode_index - b.episode_index)
              .map((item) => {
                const itemId = `${item.series_key}-${item.episode_index}`;
                const isDeleting = deletingIds.has(itemId);
                return (
                  <div
                    key={itemId}
                    className='flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors'
                  >
                    <div className='flex-1'>
                      <div className='flex items-center gap-2'>
                        <span className='font-medium text-gray-900 dark:text-white'>
                          {item.episode_title}
                        </span>
                        <span className='text-xs text-gray-500 dark:text-gray-400'>
                          ({item.source_name})
                        </span>
                      </div>
                      <div className='flex items-center gap-4 mt-1 text-xs text-gray-500 dark:text-gray-400'>
                        <span>{formatBytes(item.file_size_mb)}</span>
                        <span>{formatDate(item.downloaded_at)}</span>
                      </div>
                    </div>
                    <div className='flex items-center gap-2'>
                      <button
                        onClick={() => handlePlay(item)}
                        className='p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-colors'
                        title='播放'
                      >
                        <Play className='w-4 h-4' />
                      </button>
                      <button
                        onClick={() => handleDelete(item)}
                        disabled={isDeleting}
                        className='p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors disabled:opacity-50'
                        title='删除'
                      >
                        {isDeleting ? (
                          <div className='w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full animate-spin' />
                        ) : (
                          <Trash2 className='w-4 h-4' />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}
