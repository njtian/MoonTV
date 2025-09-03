// Electron兼容性工具函数

export const isElectron =
  typeof window !== 'undefined' &&
  window.navigator.userAgent.includes('Electron');

export const isStaticExport = process.env.ELECTRON_BUILD === 'true';

// 在静态导出模式下禁用某些功能
export const shouldDisableServerFeatures = isStaticExport;

// 安全的URL构造函数
export function createSafeURL(url: string): URL | null {
  try {
    if (typeof URL !== 'undefined') {
      return new URL(url);
    }
    return null;
  } catch {
    return null;
  }
}

// 安全的process.env访问
export function getEnvVar(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key];
  }
  return undefined;
}

// 检查是否在服务器环境中
export function isServer(): boolean {
  return typeof window === 'undefined';
}

// 检查是否在客户端环境中
export function isClient(): boolean {
  return typeof window !== 'undefined';
}
