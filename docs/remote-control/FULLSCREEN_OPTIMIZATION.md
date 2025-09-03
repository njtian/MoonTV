# 遥控器全屏功能优化

## 🎯 优化目标

优化遥控器全屏功能，实现智能全屏切换：

1. 统一全屏按钮，不再区分原生全屏和网页全屏
2. 智能全屏逻辑：先尝试原生全屏，遇到浏览器权限限制时自动回退到网页全屏
3. 智能退出全屏：根据当前实际状态选择正确的退出方式

## 🔧 主要变更

### 1. 遥控器端优化 (`src/app/controller/page.tsx`)

**变更前：**

- 两个独立按钮：`网页全屏` 和 `退出全屏`
- 发送 `enterWebFullscreen` 和 `exitWebFullscreen` 指令

**变更后：**

- 两个按钮：`全屏` 和 `退出全屏`
- 发送 `toggleFullscreen` 和 `exitFullscreen` 指令

### 2. 播放器端优化 (`src/app/play/page.tsx`)

#### 智能全屏逻辑 (`toggleFullscreen`)

```typescript
if (action === 'toggleFullscreen') {
  if (!artPlayerRef.current.fullscreen && !artPlayerRef.current.fullscreenWeb) {
    // 检查是否支持原生全屏
    const isFullscreenSupported =
      document.fullscreenEnabled ||
      (document as any).webkitFullscreenEnabled ||
      (document as any).mozFullScreenEnabled ||
      (document as any).msFullscreenEnabled;

    if (isFullscreenSupported) {
      // 尝试原生全屏
      try {
        artPlayerRef.current.fullscreen = true;
        // 使用setTimeout检查全屏是否成功
        setTimeout(() => {
          if (!artPlayerRef.current?.fullscreen) {
            // 原生全屏失败，回退到网页全屏
            artPlayerRef.current.fullscreenWeb = true;
            showRemoteHint('⛶ 网页全屏');
          } else {
            showRemoteHint('🖥 全屏');
          }
        }, 100);
      } catch (nativeError) {
        // 回退到网页全屏
        artPlayerRef.current.fullscreenWeb = true;
        showRemoteHint('⛶ 网页全屏');
      }
    } else {
      // 不支持原生全屏，直接使用网页全屏
      artPlayerRef.current.fullscreenWeb = true;
      showRemoteHint('⛶ 网页全屏');
    }
  } else {
    // 退出当前全屏状态
    if (artPlayerRef.current.fullscreen) {
      artPlayerRef.current.fullscreen = false;
    } else if (artPlayerRef.current.fullscreenWeb) {
      artPlayerRef.current.fullscreenWeb = false;
    }
  }
}
```

#### 智能退出全屏逻辑 (`exitFullscreen`)

```typescript
if (action === 'exitFullscreen') {
  // 根据当前状态选择退出方式
  if (artPlayerRef.current.fullscreen) {
    artPlayerRef.current.fullscreen = false;
    showRemoteHint('🗗 退出全屏');
  } else if (artPlayerRef.current.fullscreenWeb) {
    artPlayerRef.current.fullscreenWeb = false;
    showRemoteHint('🗗 退出网页全屏');
  }
}
```

## 🧪 测试指南

### 测试环境

1. **桌面浏览器**（支持原生全屏）

   - Chrome/Edge: 应该使用原生全屏
   - Firefox: 应该使用原生全屏
   - Safari: 应该使用原生全屏

2. **移动浏览器**（可能不支持原生全屏）

   - iOS Safari: 可能回退到网页全屏
   - Android Chrome: 可能回退到网页全屏

3. **受限环境**
   - 无用户交互的 iframe: 应该回退到网页全屏
   - 某些企业环境: 可能回退到网页全屏

### 测试步骤

1. **基础功能测试**

   ```
   1. 打开播放页面
   2. 使用遥控器点击"全屏"按钮
   3. 验证是否进入全屏模式
   4. 点击"退出全屏"按钮
   5. 验证是否退出全屏模式
   ```

2. **智能回退测试**

   ```
   1. 在受限环境中测试（如iframe）
   2. 点击"全屏"按钮
   3. 验证是否自动回退到网页全屏
   4. 检查提示信息是否正确显示
   ```

3. **状态切换测试**
   ```
   1. 进入全屏模式
   2. 再次点击"全屏"按钮
   3. 验证是否退出全屏（toggle功能）
   4. 使用"退出全屏"按钮
   5. 验证是否正确退出
   ```

### 预期行为

- **桌面环境**: 优先使用原生全屏，提供最佳体验
- **移动环境**: 自动回退到网页全屏，确保功能可用
- **受限环境**: 智能回退，避免功能失效
- **用户提示**: 清晰显示当前使用的全屏模式

## 🔍 技术细节

### 全屏 API 优先级

1. **原生全屏** (`artPlayerRef.current.fullscreen`)

   - 使用浏览器原生 Fullscreen API
   - 需要用户交互触发
   - 可能被浏览器安全策略阻止

2. **网页全屏** (`artPlayerRef.current.fullscreenWeb`)
   - 使用 CSS 全屏样式
   - 不依赖浏览器 API
   - 兼容性更好，但体验略差

### 错误处理

- **权限检查**: 预先检查浏览器是否支持原生全屏
- **异步检测**: 使用 `setTimeout` 检测全屏是否真正成功
- **多重回退**: 捕获异常并自动回退到网页全屏
- **兜底机制**: 在最外层 catch 中提供网页全屏作为最终备选方案

- **日志记录**: 记录警告日志便于调试
- **用户反馈**: 显示用户友好的提示信息

#### 权限检查机制

```typescript
// 检查浏览器是否支持原生全屏
const isFullscreenSupported =
  document.fullscreenEnabled ||
  (document as any).webkitFullscreenEnabled ||
  (document as any).mozFullScreenEnabled ||
  (document as any).msFullscreenEnabled;
```

#### 异步状态检测

```typescript
// 使用setTimeout检查全屏是否成功
setTimeout(() => {
  if (!artPlayerRef.current?.fullscreen) {
    // 原生全屏失败，回退到网页全屏
    console.warn('原生全屏失败，回退到网页全屏');
    // 清除可能出现的错误提示
    clearGlobalError();
    artPlayerRef.current.fullscreenWeb = true;
    showRemoteHint('⛶ 网页全屏');
  } else {
    showRemoteHint('🖥 全屏');
  }
}, 100);
```

## 📝 注意事项

1. **权限限制**: 某些浏览器环境可能完全阻止全屏功能
2. **用户体验**: 原生全屏提供更好的沉浸式体验
3. **兼容性**: 网页全屏确保在各种环境下都能工作
4. **状态管理**: 正确跟踪当前全屏状态，避免状态混乱
