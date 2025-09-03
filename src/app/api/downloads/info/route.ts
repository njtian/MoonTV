import fs from 'fs';
import { NextResponse } from 'next/server';
import path from 'path';

export async function GET() {
  try {
    const downloadInfoPath = path.join(
      process.cwd(),
      'dist-electron',
      'download-info.json'
    );

    // 检查下载信息文件是否存在
    if (!fs.existsSync(downloadInfoPath)) {
      return NextResponse.json(
        {
          error: '暂无可用的下载版本',
          message: '请等待管理员构建新版本',
        },
        { status: 404 }
      );
    }

    // 读取下载信息
    const downloadInfo = JSON.parse(fs.readFileSync(downloadInfoPath, 'utf8'));

    // 检查文件是否存在
    const filePath = path.join(
      process.cwd(),
      'dist-electron',
      downloadInfo.fileName
    );
    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        {
          error: '下载文件不存在',
          message: '文件可能已被删除或移动',
        },
        { status: 404 }
      );
    }

    // 获取文件统计信息
    const stats = fs.statSync(filePath);
    const fileSize = (stats.size / (1024 * 1024)).toFixed(1) + ' MB';

    return NextResponse.json({
      ...downloadInfo,
      fileSize,
      lastModified: stats.mtime.toISOString(),
      available: true,
    });
  } catch (error) {
    // 记录错误但不输出到控制台
    // console.error('获取下载信息失败:', error);
    return NextResponse.json(
      {
        error: '服务器内部错误',
        message: '无法获取下载信息',
      },
      { status: 500 }
    );
  }
}
