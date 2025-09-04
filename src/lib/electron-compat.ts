// Electron兼容性工具函数

// 定义Electron API类型
interface ElectronAPI {
  window: {
    setFullScreen: (fullscreen: boolean) => Promise<boolean>;
    isFullScreen: () => Promise<boolean>;
    toggleFullScreen: () => Promise<boolean>;
  };
}

// 扩展Window接口
declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export const isElectron =
  typeof window !== 'undefined' &&
  window.navigator.userAgent.includes('Electron');

// 检查是否有Electron API可用
export const hasElectronAPI =
  typeof window !== 'undefined' && window.electronAPI;

// 调试函数 - 检查Electron API状态
export function debugElectronAPI() {
  if (typeof window === 'undefined') {
    // eslint-disable-next-line no-console
    console.log('debugElectronAPI: 在服务器环境中');
    return;
  }

  // eslint-disable-next-line no-console
  console.log('debugElectronAPI: 在客户端环境中');
  // eslint-disable-next-line no-console
  console.log('isElectron:', isElectron);
  // eslint-disable-next-line no-console
  console.log('window.electronAPI:', window.electronAPI);
  // eslint-disable-next-line no-console
  console.log('hasElectronAPI:', hasElectronAPI);

  if (window.electronAPI) {
    // eslint-disable-next-line no-console
    console.log('electronAPI.window:', window.electronAPI.window);
  }
}

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

// Electron全屏API封装
export const electronFullscreen = {
  // 设置全屏状态
  setFullScreen: async (fullscreen: boolean): Promise<boolean> => {
    if (hasElectronAPI && window.electronAPI) {
      try {
        return await window.electronAPI.window.setFullScreen(fullscreen);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Electron全屏设置失败:', error);
        return false;
      }
    }
    return false;
  },

  // 检查是否全屏
  isFullScreen: async (): Promise<boolean> => {
    if (hasElectronAPI && window.electronAPI) {
      try {
        return await window.electronAPI.window.isFullScreen();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Electron全屏状态检查失败:', error);
        return false;
      }
    }
    return false;
  },

  // 切换全屏状态
  toggleFullScreen: async (): Promise<boolean> => {
    if (hasElectronAPI && window.electronAPI) {
      try {
        return await window.electronAPI.window.toggleFullScreen();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Electron全屏切换失败:', error);
        return false;
      }
    }
    return false;
  },
};
