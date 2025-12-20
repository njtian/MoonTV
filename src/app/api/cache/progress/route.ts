import { NextResponse } from 'next/server';
import path from 'path';

import { CleanTask } from '@/lib/video-cache.types';
import { getCacheDir, safeReadFile } from '@/lib/video-cache-utils';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('task_id');

    if (!taskId) {
      return NextResponse.json({ error: '缺少 task_id 参数' }, { status: 400 });
    }

    const cacheDir = getCacheDir();
    const taskFile = path.join(cacheDir, 'tasks', `clean_${taskId}.json`);
    const task = await safeReadFile<CleanTask>(taskFile);

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    return NextResponse.json({
      task_id: task.task_id,
      status: task.status,
      progress: task.progress,
      current: task.current,
      total: task.total,
      message: task.message,
      started_at: new Date(task.started_at).toISOString(),
      estimated_completion:
        task.status === 'running' && task.progress > 0
          ? new Date(
              task.started_at + (Date.now() - task.started_at) / task.progress
            ).toISOString()
          : null,
      deleted_count: task.deleted_count,
      freed_space_mb: task.freed_space_mb,
      error: task.error,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
