#!/usr/bin/env node

/**
 * 清理 standalone 输出中的 .cache 目录
 * 这个脚本在构建后运行，确保 .cache 不会被包含在 Docker 镜像中
 */

/* eslint-disable @typescript-eslint/no-var-requires, no-console */
const fs = require('fs');
const path = require('path');

const cachePath = path.join(__dirname, '..', '.next', 'standalone', '.cache');

if (fs.existsSync(cachePath)) {
  try {
    fs.rmSync(cachePath, { recursive: true, force: true });
    console.log('✅ Removed .cache from standalone output');
  } catch (error) {
    console.error('❌ Failed to remove .cache:', error.message);
    process.exit(1);
  }
} else {
  console.log(
    'ℹ️  .cache directory not found in standalone output (already clean)'
  );
}
