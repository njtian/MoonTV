#!/bin/bash

# MoonTV Electron 开发环境启动脚本
set -e

echo "🚀 启动 MoonTV Electron 开发环境..."
echo "================================"

# 检查依赖
if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm 未安装，请先安装 pnpm"
    exit 1
fi

# 设置开发环境
export NODE_ENV=development
export SERVER_URL=http://localhost:3000

echo "🔧 环境配置:"
echo "  - NODE_ENV: $NODE_ENV"
echo "  - SERVER_URL: $SERVER_URL"
echo ""

# 安装依赖（如果需要）
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖..."
    pnpm install
fi

# 启动开发服务器和 Electron
echo "🏗️  启动开发服务器和 Electron..."
pnpm electron:dev
