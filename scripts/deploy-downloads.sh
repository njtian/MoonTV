#!/bin/bash

# MoonTV 下载系统部署脚本
set -e

echo "🚀 部署 MoonTV 下载系统..."
echo "================================"

# 构建 Mac 版本
echo "🍎 构建 Mac 版本..."
./scripts/build-mac.sh

# 检查构建结果
if [ ! -f "dist-electron/download-info.json" ]; then
    echo "❌ 构建失败，无法部署下载系统"
    exit 1
fi

# 创建下载目录
echo "📁 设置下载目录..."
mkdir -p public/downloads

# 复制下载文件到 public 目录（可选，用于直接访问）
echo "📋 设置下载文件..."
cp dist-electron/download-info.json public/downloads/

# 创建下载页面链接
echo "🔗 创建下载链接..."
cat > public/downloads/README.md << EOF
# MoonTV 下载

## 桌面应用下载

- **macOS**: [下载页面](/downloads/)
- **API**: [/api/downloads/info](/api/downloads/info)

## 安装说明

1. 下载对应平台的压缩包
2. 解压到本地目录
3. 按照平台说明安装应用

## 技术支持

如有问题，请访问 [MoonTV 主页](/) 或查看文档。
EOF

echo ""
echo "✅ 下载系统部署完成！"
echo "================================"
echo "🌐 访问地址："
echo "   - 下载页面: http://localhost:3000/downloads/"
echo "   - API 接口: http://localhost:3000/api/downloads/info"
echo ""
echo "📋 文件位置："
echo "   - 应用文件: dist-electron/"
echo "   - 下载页面: public/downloads/"
echo "   - API 路由: src/app/api/downloads/"
echo ""
echo "🔄 更新流程："
echo "   1. 运行: ./scripts/build-mac.sh"
echo "   2. 运行: ./scripts/deploy-downloads.sh"
echo "   3. 重启服务器: pnpm dev"
