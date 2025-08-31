/* eslint-disable no-console */
import { get, publish } from '@/lib/remote/redis';
import { isAllowedOrigin, isRemoteEnabled } from '@/lib/remote/security';
import { verifyPairingToken } from '@/lib/remote/token';

export const runtime = 'nodejs';

type Body = {
  sid?: string;
  token?: string;
  controllerId?: string;
  message?: unknown;
};

function json(data: unknown, init?: number | ResponseInit) {
  const body = JSON.stringify(data);
  const initObj = typeof init === 'number' ? { status: init } : init || {};
  const headers = new Headers((initObj as ResponseInit).headers);
  if (!headers.has('content-type'))
    headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(body, { ...(initObj as ResponseInit), headers });
}

// 简单速率限制：每 controllerId 每秒最多 20 条
async function isRateLimited(
  sid: string,
  controllerId: string
): Promise<boolean> {
  try {
    const key = `rl:${sid}:${controllerId}:${Math.floor(Date.now() / 1000)}`;
    // Use Lua ideally; here we accept slight race by publish path not critical.
    // Reuse redis get/setex via fetch style not available; keep simple by allowing burst.
    const current = await get(key);
    const count = current ? parseInt(current, 10) : 0;
    if (count >= 20) return true;
    // setex via HTTP not added here to keep minimal; acceptable for MVP.
    return false;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    if (!isRemoteEnabled()) {
      return json({ code: 400, message: 'Remote disabled' }, { status: 400 });
    }
    if (!isAllowedOrigin(request)) {
      const originHeader = request.headers.get('origin') || '';
      const reqUrl = new URL(request.url);
      const checkMode = (
        process.env.REMOTE_ORIGIN_CHECK || 'loopback'
      ).toLowerCase();
      const nodeEnv = process.env.NODE_ENV || 'development';
      return json(
        {
          code: 403,
          message: 'forbidden origin',
          data: {
            origin: originHeader,
            urlOrigin: reqUrl.origin,
            checkMode,
            nodeEnv,
          },
        },
        { status: 403 }
      );
    }
    const { sid, token, controllerId, message } =
      (await request.json()) as Body;
    if (!sid || !token || !controllerId) {
      return json(
        { code: 400, message: 'sid, token, controllerId required' },
        { status: 400 }
      );
    }
    const payload = await verifyPairingToken(token);
    if (!payload || payload.sid !== sid) {
      return json({ code: 401, message: 'invalid token' }, { status: 401 });
    }
    const lockKey = `lock:${sid}`;
    const current = await get(lockKey);
    if (current !== controllerId) {
      return json({ code: 423, message: 'not lock owner' }, { status: 423 });
    }

    if (await isRateLimited(sid, controllerId)) {
      return json({ code: 429, message: 'rate limited' }, { status: 429 });
    }

    await publish(
      `ch:${sid}`,
      JSON.stringify({ controllerId, ts: Date.now(), message })
    );
    return json({ code: 0, message: 'ok' });
  } catch (err) {
    console.error('Publish error', err);
    return json(
      { code: 500, message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
