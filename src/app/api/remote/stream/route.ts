/* eslint-disable no-console */

import { subscribeChannel } from '@/lib/remote/redis';
import { isRemoteEnabled } from '@/lib/remote/security';

export const runtime = 'nodejs';

function sseEvent(data: string): string {
  return `data: ${data}\n\n`;
}

type StreamController = ReadableStreamDefaultController<Uint8Array> & {
  _unsubscribe?: () => Promise<void>;
};

export async function GET(request: Request) {
  try {
    if (!isRemoteEnabled()) {
      return new Response('remote disabled', { status: 400 });
    }
    const { searchParams } = new URL(request.url);
    const sid = searchParams.get('sid');
    if (!sid) return new Response('sid required', { status: 400 });

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const controllerWithCleanup = controller as StreamController;
        controller.enqueue(
          encoder.encode(sseEvent(JSON.stringify({ ready: true })))
        );

        try {
          const unsubscribe = await subscribeChannel(`ch:${sid}`, (msg) => {
            controller.enqueue(encoder.encode(sseEvent(msg)));
          });

          // 当传输关闭时，取消订阅
          controllerWithCleanup._unsubscribe = unsubscribe;
        } catch (err) {
          console.error('SSE subscribe error', err);
          controller.enqueue(
            encoder.encode(
              sseEvent(JSON.stringify({ error: 'subscribe failed' }))
            )
          );
        }
      },
      async cancel() {
        try {
          const controllerWithCleanup = this as StreamController;
          const fn = controllerWithCleanup._unsubscribe;
          if (fn) await fn();
        } catch {
          // ignore
        }
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    });
  } catch (err) {
    console.error('SSE error', err);
    return new Response('internal error', { status: 500 });
  }
}
