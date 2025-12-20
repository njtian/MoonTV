const {
  app,
  BrowserWindow,
  Menu,
  shell,
  screen,
  ipcMain,
  net,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { getCurrentConfig, getServerUrl } = require('./config');
const { debugNetwork } = require('./debug-network');

// 保持对窗口对象的全局引用
let mainWindow;

// 服务器配置
const config = getCurrentConfig();
const SERVER_URL = getServerUrl();

// 窗口状态文件路径
const stateFilePath = path.join(os.homedir(), '.moontv', 'window-state.json');

// 窗口状态管理
let windowState = {
  width: undefined,
  height: undefined,
  x: undefined,
  y: undefined,
  isMaximized: false,
};

// 加载窗口状态
function loadWindowState() {
  try {
    if (fs.existsSync(stateFilePath)) {
      const data = fs.readFileSync(stateFilePath, 'utf8');
      windowState = { ...windowState, ...JSON.parse(data) };
    }
  } catch (error) {
    console.warn('Failed to load window state:', error.message);
  }
}

// 保存窗口状态
function saveWindowState() {
  if (mainWindow) {
    const bounds = mainWindow.getBounds();
    windowState.width = bounds.width;
    windowState.height = bounds.height;
    windowState.x = bounds.x;
    windowState.y = bounds.y;
    windowState.isMaximized = mainWindow.isMaximized();

    try {
      // 确保目录存在
      const stateDir = path.dirname(stateFilePath);
      if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
      }

      fs.writeFileSync(stateFilePath, JSON.stringify(windowState, null, 2));
    } catch (error) {
      console.warn('Failed to save window state:', error.message);
    }
  }
}

// 防抖定时器
let saveStateTimer = null;

// 网络连接测试函数
async function testConnection(url) {
  return new Promise((resolve) => {
    console.log('测试网络连接:', url);

    const request = net.request({
      method: 'HEAD',
      url: url,
      timeout: 10000, // 10秒超时
    });

    request.on('response', (response) => {
      console.log('连接测试成功:', response.statusCode);
      resolve({ success: true, statusCode: response.statusCode });
    });

    request.on('error', (error) => {
      console.error('连接测试失败:', error);
      resolve({ success: false, error: error.message });
    });

    request.on('timeout', () => {
      console.error('连接测试超时');
      resolve({ success: false, error: '连接超时' });
    });

    request.end();
  });
}

// 获取屏幕尺寸并计算合适的窗口大小
function getOptimalWindowSize() {
  const primaryDisplay = screen.getPrimaryDisplay();

  // 使用主显示器的工作区域
  const { width: screenWidth, height: screenHeight } =
    primaryDisplay.workAreaSize;

  // 使用100%的可视区域大小
  let scaleFactor = 1.0; // 占满整个可视区域

  // 计算窗口大小 - 占满整个可视区域
  const optimalWidth = Math.floor(screenWidth * scaleFactor);
  const optimalHeight = Math.floor(screenHeight * scaleFactor);

  // 确保不小于最小尺寸
  const finalWidth = Math.max(optimalWidth, 800);
  const finalHeight = Math.max(optimalHeight, 600);

  // 计算窗口位置 - 占满整个可视区域时从左上角开始
  const x = 0;
  const y = 0;

  return {
    width: finalWidth,
    height: finalHeight,
    x: Math.max(0, x), // 确保不超出屏幕边界
    y: Math.max(0, y),
  };
}

// 防抖保存窗口状态
function debouncedSaveWindowState() {
  if (saveStateTimer) {
    clearTimeout(saveStateTimer);
  }
  saveStateTimer = setTimeout(() => {
    saveWindowState();
  }, 500); // 500ms 防抖
}

function createWindow() {
  // 获取最优窗口尺寸
  const optimalSize = getOptimalWindowSize();

  // 确定是否使用保存的窗口状态
  const hasSavedState =
    windowState.width !== undefined && windowState.height !== undefined;

  // 调试信息（开发时启用）
  if (config.isDev) {
    console.log('屏幕信息:', screen.getPrimaryDisplay().workAreaSize);
    console.log('计算的最优窗口尺寸:', optimalSize);
    console.log('当前窗口状态:', windowState);
    console.log('是否有保存的状态:', hasSavedState);
  }

  // 验证窗口位置是否在屏幕范围内
  function validateWindowBounds(bounds, screenBounds) {
    const { width, height, x, y } = bounds;
    const { width: screenWidth, height: screenHeight } = screenBounds;

    // 确保窗口不超出屏幕边界
    const validX = Math.max(0, Math.min(x, screenWidth - width));
    const validY = Math.max(0, Math.min(y, screenHeight - height));

    return {
      width: Math.min(width, screenWidth),
      height: Math.min(height, screenHeight),
      x: validX,
      y: validY,
    };
  }

  // 获取当前屏幕边界
  const currentScreen = screen.getDisplayNearestPoint(
    windowState.x !== undefined
      ? { x: windowState.x, y: windowState.y }
      : optimalSize
  );
  const screenBounds = currentScreen.workAreaSize;

  // 验证窗口边界
  const validatedBounds = validateWindowBounds(
    {
      width: hasSavedState ? windowState.width : optimalSize.width,
      height: hasSavedState ? windowState.height : optimalSize.height,
      x: hasSavedState ? windowState.x : optimalSize.x,
      y: hasSavedState ? windowState.y : optimalSize.y,
    },
    screenBounds
  );

  // 调试信息（开发时启用）
  if (config.isDev) {
    console.log('验证后的窗口边界:', validatedBounds);
  }

  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: validatedBounds.width,
    height: validatedBounds.height,
    x: validatedBounds.x,
    y: validatedBounds.y,
    minWidth: 800,
    minHeight: 600,
    maxWidth: screenBounds.width,
    maxHeight: screenBounds.height,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: true,
      sandbox: false, // 暂时禁用沙盒模式以解决网络连接问题
      preload: path.join(__dirname, 'preload.js'), // 添加预加载脚本
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      // 性能优化
      backgroundThrottling: false, // 防止页面在后台时被节流
      offscreen: false, // 禁用离屏渲染
      // 网络相关配置
      partition: 'persist:main', // 使用持久化分区
    },
    icon: path.join(__dirname, '../public/icons/icon.icns'),
    titleBarStyle: 'default',
    show: false, // 先不显示，等加载完成后再显示
    center: !hasSavedState, // 如果没有保存的位置，则居中显示
    fullscreenable: true, // 允许全屏
    fullscreen: false, // 默认不全屏
  });

  // 添加网络事件监听
  mainWindow.webContents.on(
    'did-fail-load',
    (event, errorCode, errorDescription, validatedURL) => {
      console.error('页面加载失败:', {
        errorCode,
        errorDescription,
        validatedURL,
        serverUrl: SERVER_URL,
      });

      // 显示详细的错误页面
      const errorHtml = `
      <html>
        <head>
          <title>MoonTV - 连接错误</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; text-align: center; }
            .error-container { max-width: 600px; margin: 0 auto; }
            .error-code { color: #e74c3c; font-size: 24px; margin-bottom: 20px; }
            .error-details { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: left; }
            .retry-btn { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; }
            .retry-btn:hover { background: #0056b3; }
          </style>
        </head>
        <body>
          <div class="error-container">
            <h1>🌙 MoonTV 连接失败</h1>
            <div class="error-code">错误代码: ${errorCode}</div>
            <div class="error-details">
              <p><strong>错误描述:</strong> ${errorDescription}</p>
              <p><strong>目标地址:</strong> ${validatedURL}</p>
              <p><strong>配置地址:</strong> ${SERVER_URL}</p>
              <p><strong>可能原因:</strong></p>
              <ul>
                <li>网络连接问题</li>
                <li>服务器暂时不可用</li>
                <li>防火墙或代理设置</li>
                <li>DNS 解析问题</li>
              </ul>
            </div>
            <button class="retry-btn" onclick="window.location.reload()">🔄 重试连接</button>
            <p style="margin-top: 20px; color: #666;">
              如果问题持续存在，请检查网络连接或联系技术支持
            </p>
          </div>
        </body>
      </html>
    `;

      mainWindow.loadURL(`data:text/html,${encodeURIComponent(errorHtml)}`);
    }
  );

  // 添加网络状态监听
  mainWindow.webContents.on('did-start-loading', () => {
    console.log('开始加载页面:', SERVER_URL);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('页面加载完成');
  });

  // 先测试网络连接，然后加载页面
  async function loadServer() {
    console.log('正在连接到服务器:', SERVER_URL);

    // 运行详细的网络诊断
    const debugResult = await debugNetwork(SERVER_URL);

    // 测试网络连接
    const connectionTest = await testConnection(SERVER_URL);

    if (connectionTest.success) {
      console.log('网络连接正常，开始加载页面');
      mainWindow.loadURL(SERVER_URL).catch((error) => {
        console.error('Failed to load URL:', error);
      });
    } else {
      console.error('网络连接失败:', connectionTest.error);
      console.log('详细诊断结果:', debugResult);

      // 显示详细的网络连接错误页面
      const networkErrorHtml = `
        <html>
          <head>
            <title>MoonTV - 网络连接错误</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; text-align: center; }
              .error-container { max-width: 800px; margin: 0 auto; }
              .error-icon { font-size: 64px; margin-bottom: 20px; }
              .error-title { color: #e74c3c; font-size: 28px; margin-bottom: 20px; }
              .error-details { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: left; }
              .debug-info { background: #fff3cd; padding: 15px; border-radius: 6px; margin: 20px 0; text-align: left; font-family: monospace; font-size: 12px; }
              .retry-btn { background: #007bff; color: white; padding: 12px 24px; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; margin: 10px; }
              .retry-btn:hover { background: #0056b3; }
              .tips { background: #e3f2fd; padding: 15px; border-radius: 6px; margin: 20px 0; text-align: left; }
            </style>
          </head>
          <body>
            <div class="error-container">
              <div class="error-icon">🌐❌</div>
              <h1 class="error-title">网络连接失败</h1>
              <div class="error-details">
                <p><strong>目标服务器:</strong> ${SERVER_URL}</p>
                <p><strong>错误信息:</strong> ${connectionTest.error}</p>
                <p><strong>错误代码:</strong> ${
                  connectionTest.code || 'N/A'
                }</p>
                <p><strong>响应时间:</strong> ${
                  connectionTest.responseTime || 'N/A'
                }ms</p>
                <p><strong>测试时间:</strong> ${new Date().toLocaleString()}</p>
              </div>
              <div class="debug-info">
                <strong>🔍 诊断信息:</strong><br>
                ${JSON.stringify(debugResult, null, 2)}
              </div>
              <div class="tips">
                <h3>💡 解决建议:</h3>
                <ul>
                  <li>检查网络连接是否正常</li>
                  <li>确认服务器地址是否正确</li>
                  <li>检查防火墙或代理设置</li>
                  <li>尝试在浏览器中访问该地址</li>
                  <li>检查DNS解析是否正常</li>
                  <li>确认SSL证书是否有效</li>
                </ul>
              </div>
              <button class="retry-btn" onclick="window.location.reload()">🔄 重新测试连接</button>
              <button class="retry-btn" onclick="window.open('${SERVER_URL}', '_blank')">🌐 在浏览器中打开</button>
            </div>
          </body>
        </html>
      `;

      mainWindow.loadURL(
        `data:text/html,${encodeURIComponent(networkErrorHtml)}`
      );
    }
  }

  // 延迟一点时间再测试连接，确保窗口完全初始化
  setTimeout(loadServer, 1000);

  // 窗口加载完成后显示
  mainWindow.once('ready-to-show', () => {
    // 确保窗口大小正确
    if (!hasSavedState) {
      mainWindow.setBounds(validatedBounds);
    }

    // 如果之前是最大化状态，则恢复最大化
    if (windowState.isMaximized) {
      mainWindow.maximize();
    }

    mainWindow.show();

    // 开发环境下打开开发者工具
    if (config.isDev) {
      mainWindow.webContents.openDevTools();
    }
  });

  // 监听窗口大小和位置变化（使用防抖）
  mainWindow.on('resize', () => {
    debouncedSaveWindowState();
  });

  mainWindow.on('move', () => {
    debouncedSaveWindowState();
  });

  mainWindow.on('maximize', () => {
    saveWindowState(); // 最大化/取消最大化立即保存
  });

  mainWindow.on('unmaximize', () => {
    saveWindowState(); // 最大化/取消最大化立即保存
  });

  // 当窗口被关闭时触发
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 内存管理 - 定期清理
  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.session.clearCache();
    }
  }, 300000); // 每5分钟清理一次缓存

  // 处理外部链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 创建应用菜单
  createMenu();
}

function createMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '新建窗口',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            createWindow();
          },
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          },
        },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectall', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'close', label: '关闭' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 MoonTV',
          click: () => {
            // 可以添加关于对话框
            // console.log('MoonTV - 影视聚合应用');
          },
        },
      ],
    },
  ];

  // macOS 特殊处理
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about', label: '关于 MoonTV' },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 MoonTV' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '显示全部' },
        { type: 'separator' },
        { role: 'quit', label: '退出 MoonTV' },
      ],
    });

    // 窗口菜单
    template[4].submenu = [
      { role: 'close', label: '关闭' },
      { role: 'minimize', label: '最小化' },
      { role: 'zoom', label: '缩放' },
      { type: 'separator' },
      { role: 'front', label: '前置全部窗口' },
    ];
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// 当 Electron 完成初始化并准备创建浏览器窗口时调用此方法
app.whenReady().then(() => {
  // 输出服务器配置信息
  console.log('🚀 MoonTV Electron 启动中...');
  console.log('📡 服务器地址:', SERVER_URL);
  console.log('🌍 环境:', config.name);
  console.log('🔧 开发模式:', config.isDev);

  // 加载窗口状态
  loadWindowState();
  createWindow();
});

// 当所有窗口都被关闭时退出应用
app.on('window-all-closed', () => {
  // 保存窗口状态
  saveWindowState();

  // 在 macOS 上，应用和菜单栏通常会保持活跃状态，直到用户使用 Cmd + Q 明确退出
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 应用即将退出时保存窗口状态
app.on('before-quit', () => {
  saveWindowState();
});

app.on('activate', () => {
  // 在 macOS 上，当单击 dock 图标并且没有其他窗口打开时，通常会在应用中重新创建窗口
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 安全设置：防止新窗口创建
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    // 阻止默认行为
    event.preventDefault();
    // 在默认浏览器中打开链接
    shell.openExternal(navigationUrl);
  });
});

// 处理协议（可选）
app.setAsDefaultProtocolClient('moontv');

// 全局错误处理
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // 在生产环境中，可能需要重启应用或显示错误对话框
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// IPC处理程序 - 窗口控制
ipcMain.handle('window:minimize', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.handle('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('window:close', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.handle('window:isMaximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// IPC处理程序 - 全屏控制
ipcMain.handle('window:setFullScreen', (event, fullscreen) => {
  if (mainWindow) {
    mainWindow.setFullScreen(fullscreen);
    return true;
  }
  return false;
});

ipcMain.handle('window:isFullScreen', () => {
  return mainWindow ? mainWindow.isFullScreen() : false;
});

ipcMain.handle('window:toggleFullScreen', () => {
  if (mainWindow) {
    const isFullScreen = mainWindow.isFullScreen();
    mainWindow.setFullScreen(!isFullScreen);
    return !isFullScreen;
  }
  return false;
});

// IPC处理程序 - 应用信息
ipcMain.handle('app:getName', () => {
  return app.getName();
});

ipcMain.handle('app:getVersion', () => {
  return app.getVersion();
});

// IPC处理程序 - 系统信息
ipcMain.handle('system:getMemoryUsage', () => {
  return process.memoryUsage();
});

ipcMain.handle('system:getCPUUsage', async () => {
  const cpuUsage = await process.cpuUsage();
  return cpuUsage;
});

// 监听渲染进程准备就绪事件
ipcMain.on('renderer:ready', () => {
  console.log('渲染进程已准备就绪');
});

// 导出窗口实例（用于其他模块访问）
module.exports = { mainWindow };
