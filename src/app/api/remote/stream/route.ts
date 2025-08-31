/* eslint-disable no-console */
// Placeholder stream; will be replaced with Redis subscription later

export const runtime = 'nodejs';

function textEvent(data: string) {
  return `data: ${data}\n\n`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sid = searchParams.get('sid');
  if (!sid) return new Response('sid required', { status: 400 });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(textEvent(JSON.stringify({ hello: true })))
      );
    },
  });

  // NOTE: 为了最小化实现，先返回占位 SSE。下一步将改为 Redis 订阅转发。
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
