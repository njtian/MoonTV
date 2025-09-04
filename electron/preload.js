const { contextBridge, ipcRenderer } = require('electron');

console.log('Preload script loaded');

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 平台信息
  platform: process.platform,

  // 版本信息
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },

  // 应用信息
  app: {
    getName: () => ipcRenderer.invoke('app:getName'),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
  },

  // 窗口控制
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    // 全屏控制
    setFullScreen: (fullscreen) =>
      ipcRenderer.invoke('window:setFullScreen', fullscreen),
    isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
    toggleFullScreen: () => ipcRenderer.invoke('window:toggleFullScreen'),
  },

  // 系统信息
  system: {
    getMemoryUsage: () => ipcRenderer.invoke('system:getMemoryUsage'),
    getCPUUsage: () => ipcRenderer.invoke('system:getCPUUsage'),
  },

  // 文件操作（如果需要）
  files: {
    openFile: () => ipcRenderer.invoke('files:openFile'),
    saveFile: (data) => ipcRenderer.invoke('files:saveFile', data),
  },

  // 事件监听
  on: (channel, callback) => {
    const validChannels = [
      'app:ready',
      'window:maximize',
      'window:unmaximize',
      'window:minimize',
      'window:restore',
    ];

    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, callback);
    }
  },

  // 移除事件监听
  removeListener: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },
});

console.log('electronAPI exposed to main world');

// 在页面加载完成后执行
window.addEventListener('DOMContentLoaded', () => {
  console.log('DOMContentLoaded event fired');
  console.log('window.electronAPI available:', !!window.electronAPI);

  // 检测是否在Electron环境中
  const isElectron = window.navigator.userAgent.includes('Electron');
  console.log('isElectron detected:', isElectron);

  if (isElectron) {
    // 添加Electron标识类到body
    document.body.classList.add('electron-app');

    // 可以在这里添加Electron特有的初始化逻辑
    console.log('MoonTV running in Electron environment');

    // 通知主进程页面已准备就绪
    ipcRenderer.send('renderer:ready');
  }
});
