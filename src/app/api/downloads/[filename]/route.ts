import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

export async function GET(
  request: NextRequest,
  { params }: { params: { filename: string } }
) {
  try {
    const filename = params.filename;

    // 安全检查：只允许下载 .tar.gz 文件
    if (!filename.endsWith('.tar.gz')) {
      return NextResponse.json(
        {
          error: '无效的文件类型',
        },
        { status: 400 }
      );
    }

    const filePath = path.join(process.cwd(), 'dist-electron', filename);

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        {
          error: '文件不存在',
        },
        { status: 404 }
      );
    }

    // 获取文件信息
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;

    // 设置响应头
    const headers = new Headers();
    headers.set('Content-Type', 'application/gzip');
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);
    headers.set('Content-Length', fileSize.toString());
    headers.set('Cache-Control', 'public, max-age=3600'); // 缓存1小时

    // 创建文件流
    const fileStream = fs.createReadStream(filePath);

    const webStream = new ReadableStream({
      start(controller) {
        fileStream.on('data', (chunk) => controller.enqueue(chunk));
        fileStream.on('end', () => controller.close());
        fileStream.on('error', (err) => controller.error(err));
      },
    });

    return new NextResponse(webStream, {
      status: 200,
      headers,
    });
  } catch (error) {
    // 记录错误但不输出到控制台
    // console.error('文件下载失败:', error);
    return NextResponse.json(
      {
        error: '服务器内部错误',
        message: '无法下载文件',
      },
      { status: 500 }
    );
  }
}
