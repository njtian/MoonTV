import { NextResponse } from 'next/server';

import { getVideoDownloadService } from '@/lib/video-download-service';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('task_id');
    const recentCompletedMsParam = searchParams.get('recent_completed_ms');
    const recentCompletedMs =
      recentCompletedMsParam !== null && recentCompletedMsParam !== ''
        ? Math.max(0, parseInt(recentCompletedMsParam, 10) || 0)
        : 5 * 60 * 1000;

    const videoDownloadService = getVideoDownloadService();
    await videoDownloadService.initialize();

    if (taskId) {
      // 查询单个任务
      const status = await videoDownloadService.getDownloadStatus(taskId);
      if (!status) {
        return NextResponse.json({ error: '任务不存在' }, { status: 404 });
      }

      return NextResponse.json({
        ...status,
        started_at: new Date(status.started_at).toISOString(),
        updated_at: new Date(status.updated_at).toISOString(),
      });
    } else {
      // 返回所有活跃任务 + 最近完成任务（默认 5 分钟窗口）
      const snapshot = await videoDownloadService.getTasksSnapshot(
        recentCompletedMs
      );
      return NextResponse.json({
        tasks: snapshot.active.map((task) => ({
          ...task,
          started_at: new Date(task.started_at).toISOString(),
          updated_at: new Date(task.updated_at).toISOString(),
        })),
        recent_completed: snapshot.recent_completed.map((task) => ({
          ...task,
          started_at: new Date(task.started_at).toISOString(),
          updated_at: new Date(task.updated_at).toISOString(),
        })),
        total: snapshot.active.length,
        total_recent_completed: snapshot.recent_completed.length,
      });
    }
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
