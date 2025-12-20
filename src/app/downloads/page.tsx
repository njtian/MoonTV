'use client';

import { useState, useEffect } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import DownloadList from '@/components/DownloadList';
import ActiveDownloadsList from '@/components/ActiveDownloadsList';
import PageLayout from '@/components/PageLayout';
import { getDownloadedList, getAllActiveTasks } from '@/lib/video-cache.client';
import { DownloadStatus } from '@/lib/video-cache.types';

export default function DownloadsPage() {
  const [totalDownloaded, setTotalDownloaded] = useState(0);
  const [totalSize, setTotalSize] = useState(0);
  const [activeTasks, setActiveTasks] = useState<DownloadStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadStats = async () => {
    try {
      const data = await getDownloadedList();
      setTotalDownloaded(data.total_downloaded);
      setTotalSize(data.total_size_mb);
    } catch (error) {
      console.error('加载统计信息失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadActiveTasks = async () => {
    try {
      const data = await getAllActiveTasks();
      setActiveTasks(data.tasks);
    } catch (error) {
      console.error('加载活跃任务失败:', error);
    }
  };

  useEffect(() => {
    loadStats();
    loadActiveTasks();
    
    // 定期刷新活跃任务
    const interval = setInterval(() => {
      loadActiveTasks();
    }, 3000);
    
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadStats();
      await loadActiveTasks();
    } finally {
      setRefreshing(false);
    }
  };

  const handleTaskComplete = () => {
    // 当任务完成时，刷新已下载列表和活跃任务
    loadStats();
    loadActiveTasks();
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

  // 计算进行中任务的统计
  const activeTasksStats = {
    count: activeTasks.length,
    totalSpeed: activeTasks.reduce((sum, task) => sum + (task.download_speed_mbps || 0), 0),
    totalDownloaded: activeTasks.reduce((sum, task) => sum + task.downloaded_bytes, 0),
    totalSize: activeTasks.reduce((sum, task) => sum + task.total_bytes, 0),
  };

  return (
    <PageLayout activePath="/downloads">
      <div className="container mx-auto px-4 py-8">
        {/* 页面标题 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Download className="w-8 h-8 text-green-500" />
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              下载管理
            </h1>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw
              className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
            />
            <span>刷新</span>
          </button>
        </div>

        {/* 统计信息 */}
        {!loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {/* 进行中的任务数 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
              <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                进行中任务
              </div>
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {activeTasksStats.count}
              </div>
            </div>
            {/* 总下载速度 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
              <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                总下载速度
              </div>
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                {activeTasksStats.totalSpeed > 0 
                  ? formatSpeed(activeTasksStats.totalSpeed)
                  : activeTasksStats.count > 0 
                  ? '计算中...'
                  : '0 KB/s'}
              </div>
            </div>
            {/* 已下载文件数 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
              <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                已下载文件数
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {totalDownloaded}
              </div>
            </div>
            {/* 总大小 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
              <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                总大小
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {formatBytes(totalSize)}
              </div>
            </div>
          </div>
        )}

        {/* 进行中的下载任务 */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            进行中的下载
          </h2>
          <ActiveDownloadsList onTaskComplete={handleTaskComplete} />
        </div>

        {/* 已下载文件列表 */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            已下载文件
          </h2>
          <DownloadList onRefresh={handleRefresh} />
        </div>
      </div>
    </PageLayout>
  );
}
