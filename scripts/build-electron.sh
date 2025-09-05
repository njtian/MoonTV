#!/bin/bash

# MoonTV Electron 构建脚本
# 优化版本 - 大幅减少应用大小

set -e

echo "🚀 开始构建 MoonTV Electron 客户端..."

# 检查是否在项目根目录
if [ ! -f "package.json" ]; then
    echo "❌ 请在项目根目录运行此脚本"
    exit 1
fi

# 1. 构建 Web 应用
echo "📦 构建 Web 应用..."
pnpm gen:runtime && pnpm gen:manifest && pnpm build

# 2. 进入 Electron 目录
cd electron

# 3. 安装 Electron 依赖
echo "📦 安装 Electron 依赖..."
pnpm install

# 4. 构建 Electron 应用
echo "🔨 构建 Electron 应用..."
if [ "$1" = "mac" ]; then
    NODE_ENV=production pnpm build --mac
else
    NODE_ENV=production pnpm build
fi

echo "✅ Electron 应用构建完成！"
echo "📁 输出目录: ../dist-electron"

# 显示应用大小
if [ -d "../dist-electron/mac/MoonTV.app" ]; then
    echo "📊 应用大小:"
    du -sh ../dist-electron/mac/MoonTV.app
fi
