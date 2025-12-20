'use client';

import { Download, RefreshCw } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';

import { getDownloadedList } from '@/lib/video-cache.client';

import ActiveDownloadsList from '@/components/ActiveDownloadsList';
import DownloadList from '@/components/DownloadList';
import DownloadStatusProvider from '@/components/DownloadStatusProvider';
import { useDownloadStatusSafe } from '@/components/DownloadStatusProvider';
import PageLayout from '@/components/PageLayout';

function DownloadsPageContent() {
  const downloadStatusContext = useDownloadStatusSafe();
  const [totalDownloaded, setTotalDownloaded] = useState(0);
  const [totalSize, setTotalSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadStats = async () => {
    try {
      const data = await getDownloadedList();
      setTotalDownloaded(data.total_downloaded);
      setTotalSize(data.total_size_mb);
    } catch {
      // 静默处理错误，保持 UI 状态
    } finally {
      setLoading(false);
    }
  };

  // 从 Context 获取活跃任务（如果可用）
  const activeTasks = downloadStatusContext
    ? downloadStatusContext.getAllTasks()
    : [];

  // 计算进行中任务的统计
  const activeTasksStats = {
    count: activeTasks.length,
    totalSpeed: activeTasks.reduce(
      (sum: number, task) => sum + (task.download_speed_mbps || 0),
      0
    ),
    totalDownloaded: activeTasks.reduce(
      (sum: number, task) => sum + task.downloaded_bytes,
      0
    ),
    totalSize: activeTasks.reduce(
      (sum: number, task) => sum + task.total_bytes,
      0
    ),
  };

  useEffect(() => {
    loadStats();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadStats();
      // 如果使用 Context，刷新状态
      if (downloadStatusContext) {
        await downloadStatusContext.refresh();
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleTaskComplete = () => {
    // 当任务完成时，刷新已下载列表
    loadStats();
    // Context 会自动更新任务状态，无需手动刷新
  };

  const formatBytes = (mb: number): string => {
    if (mb < 1) return `${(mb * 1024).toFixed(0)} KB`;
    if (mb < 1024) return `${mb.toFixed(2)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  };

  const formatSpeed = (mbps: number): string => {
    if (mbps < 0.001) return '0 KB/s';
    if (mbps < 1) return `${(mbps * 1024).toFixed(2)} KB/s`;
    return `${mbps.toFixed(2)} MB/s`;
  };

  return (
    <div className='container mx-auto px-4 py-8'>
      {/* 页面标题 */}
      <div className='flex items-center justify-between mb-6'>
        <div className='flex items-center gap-3'>
          <Download className='w-8 h-8 text-green-500' />
          <h1 className='text-3xl font-bold text-gray-900 dark:text-white'>
            下载管理
          </h1>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className='flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
        >
          <RefreshCw
            className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
          />
          <span>刷新</span>
        </button>
      </div>

      {/* 统计信息 */}
      {!loading && (
        <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6'>
          {/* 进行中的任务数 */}
          <div className='bg-white dark:bg-gray-800 rounded-lg shadow p-4'>
            <div className='text-sm text-gray-500 dark:text-gray-400 mb-1'>
              进行中任务
            </div>
            <div className='text-2xl font-bold text-blue-600 dark:text-blue-400'>
              {activeTasksStats.count}
            </div>
          </div>
          {/* 总下载速度 */}
          <div className='bg-white dark:bg-gray-800 rounded-lg shadow p-4'>
            <div className='text-sm text-gray-500 dark:text-gray-400 mb-1'>
              总下载速度
            </div>
            <div className='text-2xl font-bold text-green-600 dark:text-green-400'>
              {activeTasksStats.totalSpeed > 0
                ? formatSpeed(activeTasksStats.totalSpeed)
                : activeTasksStats.count > 0
                ? '计算中...'
                : '0 KB/s'}
            </div>
          </div>
          {/* 已下载文件数 */}
          <div className='bg-white dark:bg-gray-800 rounded-lg shadow p-4'>
            <div className='text-sm text-gray-500 dark:text-gray-400 mb-1'>
              已下载文件数
            </div>
            <div className='text-2xl font-bold text-gray-900 dark:text-white'>
              {totalDownloaded}
            </div>
          </div>
          {/* 总大小 */}
          <div className='bg-white dark:bg-gray-800 rounded-lg shadow p-4'>
            <div className='text-sm text-gray-500 dark:text-gray-400 mb-1'>
              总大小
            </div>
            <div className='text-2xl font-bold text-gray-900 dark:text-white'>
              {formatBytes(totalSize)}
            </div>
          </div>
        </div>
      )}

      {/* 进行中的下载任务 */}
      <div className='bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6'>
        <h2 className='text-xl font-semibold text-gray-900 dark:text-white mb-4'>
          进行中的下载
        </h2>
        <ActiveDownloadsList onTaskComplete={handleTaskComplete} />
      </div>

      {/* 已下载文件列表 */}
      <div className='bg-white dark:bg-gray-800 rounded-lg shadow p-6'>
        <h2 className='text-xl font-semibold text-gray-900 dark:text-white mb-4'>
          已下载文件
        </h2>
        <DownloadList onRefresh={handleRefresh} />
      </div>
    </div>
  );
}

export default function DownloadsPage() {
  return (
    <Suspense fallback={<div>加载中...</div>}>
      <PageLayout activePath='/downloads'>
        <DownloadStatusProvider pollInterval={2000}>
          <DownloadsPageContent />
        </DownloadStatusProvider>
      </PageLayout>
    </Suspense>
  );
}
