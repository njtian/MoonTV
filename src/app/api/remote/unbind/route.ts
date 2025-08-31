/* eslint-disable no-console */
import { del, get, hset, publish } from '@/lib/remote/redis';
import { isAllowedOrigin, isRemoteEnabled } from '@/lib/remote/security';
import { verifyPairingToken } from '@/lib/remote/token';

export const runtime = 'nodejs';

type Body = { sid?: string; token?: string; controllerId?: string };

function json(data: unknown, init?: number | ResponseInit) {
  const body = JSON.stringify(data);
  const initObj = typeof init === 'number' ? { status: init } : init || {};
  const headers = new Headers((initObj as ResponseInit).headers);
  if (!headers.has('content-type'))
    headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(body, { ...(initObj as ResponseInit), headers });
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
    const { sid, token, controllerId } = (await request.json()) as Body;
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

    const current = await get(`lock:${sid}`);
    if (current !== controllerId) {
      return json({ code: 409, message: 'not lock owner' }, { status: 409 });
    }

    await del(`lock:${sid}`);
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
    console.error('Unbind error', err);
    return json(
      { code: 500, message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
