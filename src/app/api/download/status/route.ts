import { NextResponse } from 'next/server';
import { getVideoDownloadService } from '@/lib/video-download-service';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('task_id');

    const videoDownloadService = getVideoDownloadService();
    await videoDownloadService.initialize();

    if (taskId) {
      // 查询单个任务
      const status = await videoDownloadService.getDownloadStatus(taskId);
      if (!status) {
        return NextResponse.json(
          { error: '任务不存在' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        ...status,
        started_at: new Date(status.started_at).toISOString(),
        updated_at: new Date(status.updated_at).toISOString(),
      });
    } else {
      // 返回所有活跃任务
      const activeTasks = await videoDownloadService.getAllActiveTasks();
      return NextResponse.json({
        tasks: activeTasks.map((task) => ({
          ...task,
          started_at: new Date(task.started_at).toISOString(),
          updated_at: new Date(task.updated_at).toISOString(),
        })),
        total: activeTasks.length,
      });
    }
  } catch (error) {
    console.error('获取下载状态失败:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
