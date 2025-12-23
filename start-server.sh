#!/bin/bash

# 设置Node.js 18环境
export PATH="/root/.nvm/versions/node/v18.20.8/bin:$PATH"

# 进入项目目录
cd /root/MoonTV

# 启动开发服务器
npx next dev -H 0.0.0.0 -p 3003