# MoonTV Electron 桌面应用

MoonTV 现在支持作为桌面应用运行，同时保持原有的 PWA 功能。

## 架构说明

- **后端服务**：统一的 Next.js 服务器（包含所有 API 路由）
- **前端选择**：
  - 浏览器访问（PWA 模式）
  - Electron 客户端访问
- **数据一致性**：无论使用哪种前端，都访问同一个后端，账号和数据完全一致

## 功能特性

- 🖥️ 原生桌面应用体验
- 🔄 与 PWA 版本完全兼容，数据同步
- 🎨 原生菜单和快捷键支持
- 🔒 安全的渲染进程隔离
- 📱 跨平台支持 (Windows, macOS, Linux)
- 🌐 统一的后端服务，支持多客户端

## 开发环境

### 安装依赖

```bash
pnpm install
```

### 启动开发模式

```bash
# 启动Next.js开发服务器和Electron应用
pnpm electron:dev
```

这将同时启动：

- Next.js 开发服务器 (http://localhost:3000)
- Electron 桌面应用

## 构建和打包

### 构建应用

```bash
# 构建Electron客户端
pnpm electron:build

# 打包为可执行文件（不安装）
pnpm electron:pack

# 构建安装包
pnpm electron:dist
```

构建产物将输出到 `dist-electron/` 目录。

## 项目结构

```
MoonTV/
├── electron/              # Electron相关文件
│   ├── main.js           # 主进程
│   └── preload.js        # 预加载脚本
├── src/                  # Next.js应用源码（包含API路由）
├── dist-electron/        # Electron打包产物
└── public/               # 静态资源（包含应用图标）
```

## 技术实现

### 双模式架构

- **PWA 模式**: 使用现有的 Next.js + next-pwa 配置
- **Electron 模式**: Electron 客户端连接到 Next.js 服务器

### 部署流程

1. **Web 部署**: 部署 Next.js 服务器到云端
2. **Electron 部署**: 打包 Electron 客户端，连接到服务器
3. **数据同步**: 两种客户端访问同一个后端服务

### 安全特性

- 禁用 Node.js 集成
- 启用上下文隔离
- 使用预加载脚本安全暴露 API
- 阻止新窗口创建，外部链接在默认浏览器打开

## 自定义配置

### 应用图标

图标文件位于 `public/icons/` 目录，支持多种尺寸：

- 192x192.png
- 256x256.png
- 384x384.png
- 512x512.png

### 窗口设置

在 `electron/main.js` 中修改窗口配置：

```javascript
mainWindow = new BrowserWindow({
  width: 1200, // 窗口宽度
  height: 800, // 窗口高度
  minWidth: 800, // 最小宽度
  minHeight: 600, // 最小高度
  // ... 其他配置
});
```

### 菜单自定义

在 `createMenu()` 函数中修改应用菜单。

## 部署说明

### Web 部署

部署 Next.js 服务器到云端：

```bash
pnpm build
pnpm start
```

### Electron 部署

```bash
# 构建安装包
pnpm electron:dist

# 分发 dist-electron/ 目录中的安装包
# 客户端会自动连接到配置的服务器地址
```

### 配置服务器地址

在 Electron 客户端中，可以通过环境变量配置服务器地址：

```bash
# 开发环境
SERVER_URL=http://localhost:3000 electron electron/main.js

# 生产环境
SERVER_URL=https://your-domain.com electron electron/main.js
```

## 故障排除

### 开发环境问题

1. 确保端口 3000 未被占用
2. 检查 Node.js 版本兼容性
3. 清除缓存：`rm -rf .next out dist-electron`

### 构建问题

1. 确保所有依赖已安装
2. 检查图标文件是否存在
3. 查看构建日志中的错误信息

### 运行时问题

1. 检查控制台错误信息
2. 确认静态文件路径正确
3. 验证 Electron 版本兼容性

## 贡献指南

1. 修改 Electron 相关代码时，请确保不影响 PWA 功能
2. 新增功能时，考虑在两种模式下都能正常工作
3. 测试时请同时验证 PWA 和 Electron 模式
