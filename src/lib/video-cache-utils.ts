import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * 获取缓存目录路径
 * 支持环境变量 VIDEO_CACHE_DIR 配置，默认为 .cache
 */
export function getCacheDir(): string {
  return process.env.VIDEO_CACHE_DIR || path.join(process.cwd(), '.cache');
}

/**
 * 确保目录存在，如果不存在则创建
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

/**
 * 路径安全验证，防止路径遍历攻击
 */
export function validatePath(filePath: string, baseDir: string): boolean {
  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);
  return resolvedPath.startsWith(resolvedBase);
}

/**
 * 安全读取文件，带错误处理
 */
export async function safeReadFile<T>(
  filePath: string,
  baseDir?: string
): Promise<T | null> {
  try {
    // 如果提供了 baseDir，验证路径安全
    if (baseDir && !validatePath(filePath, baseDir)) {
      return null;
    }

    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null; // 文件不存在，返回 null
    }
    return null;
  }
}

/**
 * 原子写入文件（使用临时文件+重命名确保数据完整性）
 */
export async function atomicWriteFile(
  filePath: string,
  data: string | Buffer,
  baseDir?: string
): Promise<void> {
  // 如果提供了 baseDir，验证路径安全
  if (baseDir && !validatePath(filePath, baseDir)) {
    throw new Error(`路径不安全: ${filePath}`);
  }

  // 确保目录存在
  const dir = path.dirname(filePath);
  await ensureDirectory(dir);

  // 生成临时文件名
  const tempFileName = `${path.basename(filePath)}.tmp.${randomBytes(
    8
  ).toString('hex')}`;
  const tempFilePath = path.join(dir, tempFileName);

  try {
    // 写入临时文件
    await fs.writeFile(tempFilePath, data, 'utf-8');

    // 原子性重命名
    await fs.rename(tempFilePath, filePath);
  } catch (error) {
    // 清理临时文件
    try {
      await fs.unlink(tempFilePath);
    } catch {
      // 忽略清理错误
    }
    throw error;
  }
}

/**
 * 安全删除文件
 */
export async function safeDeleteFile(filePath: string): Promise<boolean> {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return true; // 文件不存在，视为成功
    }
    return false;
  }
}

/**
 * 安全删除目录（递归）
 */
export async function safeDeleteDirectory(dirPath: string): Promise<boolean> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取文件大小（字节）
 */
export async function getFileSize(filePath: string): Promise<number> {
  try {
    const stats = await fs.stat(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

/**
 * 获取目录大小（递归计算所有文件）
 */
export async function getDirectorySize(dirPath: string): Promise<number> {
  try {
    let totalSize = 0;
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalSize += await getDirectorySize(fullPath);
      } else {
        totalSize += await getFileSize(fullPath);
      }
    }

    return totalSize;
  } catch {
    return 0;
  }
}

/**
 * 检查文件是否存在
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 规范化路径（移除 .. 和 . 等）
 */
export function normalizePath(filePath: string): string {
  return path.normalize(filePath);
}
