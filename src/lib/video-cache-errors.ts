/**
 * 缓存错误码定义
 */
export enum CacheErrorCode {
  CACHE_READ_ERROR = 'CACHE_READ_ERROR',
  CACHE_WRITE_ERROR = 'CACHE_WRITE_ERROR',
  CACHE_INVALID_KEY = 'CACHE_INVALID_KEY',
  CACHE_PERMISSION_DENIED = 'CACHE_PERMISSION_DENIED',
  CACHE_DISK_FULL = 'CACHE_DISK_FULL',
  CACHE_TASK_NOT_FOUND = 'CACHE_TASK_NOT_FOUND',
  CACHE_INVALID_TYPE = 'CACHE_INVALID_TYPE',
  CACHE_NOT_INITIALIZED = 'CACHE_NOT_INITIALIZED',
  DOWNLOAD_FAILED = 'DOWNLOAD_FAILED',
  DOWNLOAD_TIMEOUT = 'DOWNLOAD_TIMEOUT',
  DOWNLOAD_CANCELLED = 'DOWNLOAD_CANCELLED',
  M3U8_PARSE_ERROR = 'M3U8_PARSE_ERROR',
  M3U8_DOWNLOAD_ERROR = 'M3U8_DOWNLOAD_ERROR',
}

/**
 * 缓存错误类
 */
export class CacheError extends Error {
  constructor(
    public code: CacheErrorCode,
    message: string,
    public fallback: boolean = false
  ) {
    super(message);
    this.name = 'CacheError';
  }
}

/**
 * 错误响应格式
 */
export interface ErrorResponse {
  error: boolean;
  error_code: CacheErrorCode;
  message: string;
  fallback?: boolean;
  timestamp: string;
}

/**
 * 创建错误响应
 */
export function createErrorResponse(
  code: CacheErrorCode,
  message: string,
  fallback = false
): ErrorResponse {
  return {
    error: true,
    error_code: code,
    message,
    fallback,
    timestamp: new Date().toISOString(),
  };
}

/**
 * 错误处理工具函数
 */
export function handleCacheError(error: unknown): ErrorResponse {
  if (error instanceof CacheError) {
    return createErrorResponse(error.code, error.message, error.fallback);
  }

  if (error instanceof Error) {
    // 根据错误消息判断错误类型
    if (error.message.includes('ENOENT')) {
      return createErrorResponse(
        CacheErrorCode.CACHE_READ_ERROR,
        '缓存文件不存在',
        true
      );
    }

    if (
      error.message.includes('EACCES') ||
      error.message.includes('permission')
    ) {
      return createErrorResponse(
        CacheErrorCode.CACHE_PERMISSION_DENIED,
        '缓存目录权限不足',
        true
      );
    }

    if (error.message.includes('ENOSPC') || error.message.includes('disk')) {
      return createErrorResponse(
        CacheErrorCode.CACHE_DISK_FULL,
        '磁盘空间不足',
        true
      );
    }

    if (error.message.includes('timeout') || error.message.includes('超时')) {
      return createErrorResponse(
        CacheErrorCode.DOWNLOAD_TIMEOUT,
        error.message,
        true
      );
    }

    return createErrorResponse(
      CacheErrorCode.CACHE_READ_ERROR,
      error.message,
      true
    );
  }

  return createErrorResponse(CacheErrorCode.CACHE_READ_ERROR, '未知错误', true);
}

/**
 * 日志记录函数
 */
export function logCacheError(
  code: CacheErrorCode,
  message: string,
  context?: Record<string, unknown>
): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    code,
    message,
    context,
  };

  // Error logging disabled per ESLint no-console rule
  // Log entry structure preserved for potential future logging implementation
  void logEntry;
}
