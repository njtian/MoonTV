/* eslint-disable no-console */
import { del, get, hset, publish } from '@/lib/remote/redis';
import { isAllowedOrigin, isRemoteEnabled } from '@/lib/remote/security';

export const runtime = 'nodejs';

type Body = { sid?: string };

function json(data: unknown, init?: number | ResponseInit) {
  const body = JSON.stringify(data);
  const initObj = typeof init === 'number' ? { status: init } : init || {};
  const headers = new Headers((initObj as ResponseInit).headers);
  if (!headers.has('content-type'))
    headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(body, { ...(initObj as ResponseInit), headers });
}

// 被控端调用：踢出当前控制器
export async function POST(request: Request) {
  try {
    if (!isRemoteEnabled()) {
      return json({ code: 400, message: 'Remote disabled' }, { status: 400 });
    }
    if (!isAllowedOrigin(request)) {
      return json({ code: 403, message: 'forbidden origin' }, { status: 403 });
    }
    const { sid } = (await request.json()) as Body;
    if (!sid)
      return json({ code: 400, message: 'sid required' }, { status: 400 });
    const current = await get(`lock:${sid}`);
    if (current) {
      await del(`lock:${sid}`);
    }
    await hset(`s:${sid}`, { controllerId: '' });
    await publish(
      `ch:${sid}`,
      JSON.stringify({
        type: 'system',
        payload: { action: 'end' },
        ts: Date.now(),
      })
    );
    return json({ code: 0, message: 'ok' });
  } catch (err) {
    console.error('Kick error', err);
    return json(
      { code: 500, message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
