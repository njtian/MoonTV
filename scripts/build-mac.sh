#!/bin/bash

# MoonTV Mac 版本构建脚本
set -e

echo "🍎 开始构建 MoonTV Mac 版本..."
echo "================================"

# 检查依赖
if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm 未安装，请先安装 pnpm"
    exit 1
fi

# 清理之前的构建
echo "🧹 清理之前的构建..."
rm -rf dist-electron/mac
rm -rf dist-electron/MoonTV-mac-*.tar.gz
rm -rf dist-electron/MoonTV-mac-*.dmg

# 安装依赖
echo "📦 安装依赖..."
pnpm install

# 构建 Next.js 应用
echo "🏗️  构建 Next.js 应用..."
pnpm build

# 构建 Mac 版本
echo "🍎 构建 Mac 版本..."
pnpm electron:pack:mac

# 检查构建结果
if [ ! -d "dist-electron/mac/MoonTV.app" ]; then
    echo "❌ Mac 应用构建失败"
    exit 1
fi

echo "✅ Mac 应用构建成功"

# 获取版本信息
VERSION=$(node -p "require('./package.json').version")
BUILD_DATE=$(date +"%Y%m%d_%H%M%S")

# 创建压缩包
echo "📦 创建压缩包..."
cd dist-electron
tar -czf "MoonTV-mac-v${VERSION}-${BUILD_DATE}.tar.gz" mac/
cd ..

# 获取文件信息
FILE_SIZE=$(du -h "dist-electron/MoonTV-mac-v${VERSION}-${BUILD_DATE}.tar.gz" | cut -f1)
FILE_PATH="dist-electron/MoonTV-mac-v${VERSION}-${BUILD_DATE}.tar.gz"

echo ""
echo "🎉 构建完成！"
echo "================================"
echo "📁 文件位置: $FILE_PATH"
echo "📏 文件大小: $FILE_SIZE"
echo "🏷️  版本: v$VERSION"
echo "📅 构建时间: $(date)"
echo ""

# 创建下载信息文件
cat > "dist-electron/download-info.json" << EOF
{
  "version": "$VERSION",
  "buildDate": "$(date -Iseconds)",
  "fileName": "MoonTV-mac-v${VERSION}-${BUILD_DATE}.tar.gz",
  "fileSize": "$FILE_SIZE",
  "platform": "macOS",
  "architectures": ["x64", "arm64"],
  "description": "MoonTV Desktop Application for macOS"
}
EOF

echo "📋 下载信息已保存到: dist-electron/download-info.json"
echo ""
echo "🌐 现在可以通过以下方式提供下载："
echo "1. 将 dist-electron/ 目录设置为静态文件服务"
echo "2. 访问 http://your-domain/downloads/ 查看下载页面"
echo "3. 用户可以直接下载 MoonTV-mac-v${VERSION}-${BUILD_DATE}.tar.gz"
