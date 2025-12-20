import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import path from 'path';

import { getVideoCacheService } from '@/lib/video-cache';
import { ClearOptions } from '@/lib/video-cache.types';
import { CleanTask } from '@/lib/video-cache.types';
import { atomicWriteFile, getCacheDir } from '@/lib/video-cache-utils';

// 存储清理任务（在实际应用中应该使用持久化存储）
const cleanTasks = new Map<string, CleanTask>();

/**
 * 异步执行清理任务
 */
async function executeCleanTask(
  taskId: string,
  options: ClearOptions
): Promise<void> {
  const videoCacheService = getVideoCacheService();
  await videoCacheService.initialize();

  const task = cleanTasks.get(taskId);
  if (!task) {
    return;
  }

  try {
    task.status = 'running';
    task.message = '正在清理缓存...';
    await updateTask(task);

    const result = await videoCacheService.clear(options);

    task.status = 'completed';
    task.progress = 1;
    task.current = task.total;
    task.message = result.message;
    task.deleted_count = result.deleted_count;
    task.freed_space_mb = result.freed_space_mb;
    await updateTask(task);
  } catch (error) {
    task.status = 'failed';
    task.message = `清理失败: ${(error as Error).message}`;
    task.error = (error as Error).message;
    await updateTask(task);
  }
}

/**
 * 更新任务文件
 */
async function updateTask(task: CleanTask): Promise<void> {
  cleanTasks.set(task.task_id, task);
  const cacheDir = getCacheDir();
  const taskFile = path.join(cacheDir, 'tasks', `clean_${task.task_id}.json`);
  await atomicWriteFile(taskFile, JSON.stringify(task, null, 2));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const options: ClearOptions = {
      type: body.type || 'expired',
      series_key: body.series_key,
      episode_index: body.episode_index,
      max_age_hours: body.max_age_hours,
    };

    // 验证选项
    if (options.type === 'series' && !options.series_key) {
      return NextResponse.json(
        { error: '清理类型为 series 时必须提供 series_key' },
        { status: 400 }
      );
    }

    if (options.type === 'episode' && (!options.series_key || !options.episode_index)) {
      return NextResponse.json(
        { error: '清理类型为 episode 时必须提供 series_key 和 episode_index' },
        { status: 400 }
      );
    }

    // 创建任务
    const taskId = `clean_${Date.now()}_${randomBytes(4).toString('hex')}`;
    const task: CleanTask = {
      task_id: taskId,
      type: options.type,
      status: 'pending',
      progress: 0,
      current: 0,
      total: 0,
      started_at: Date.now(),
      message: '任务已创建，等待执行...',
    };

    cleanTasks.set(taskId, task);
    await updateTask(task);

    // 异步执行清理任务
    executeCleanTask(taskId, options).catch((error) => {
      console.error('执行清理任务失败:', error);
    });

    return NextResponse.json({
      success: true,
      task_id: taskId,
      message: '清理任务已创建',
    });
  } catch (error) {
    console.error('创建清理任务失败:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
