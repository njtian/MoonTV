/* eslint-disable no-console */
import { get, hgetall } from '@/lib/remote/redis';
import { isAllowedOrigin, isRemoteEnabled } from '@/lib/remote/security';

export const runtime = 'nodejs';

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
    const { sid } = (await request.json()) as { sid?: string };
    if (!sid)
      return json({ code: 400, message: 'sid required' }, { status: 400 });
    const s = await hgetall(`s:${sid}`);
    if (!s || !s.ownerUserId)
      return json({ code: 404, message: 'not found' }, { status: 404 });
    const current = await get(`lock:${sid}`);
    return json({
      code: 0,
      message: 'ok',
      data: {
        sid,
        controllerId: s.controllerId || '',
        lockedBy: current || '',
      },
    });
  } catch (err) {
    console.error('Resume error', err);
    return json(
      { code: 500, message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
