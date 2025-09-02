/* eslint-disable no-console */
import { hsetDirect, publish, scanKeysDirect } from '@/lib/remote/redis';
import { isAllowedOrigin, isRemoteEnabled } from '@/lib/remote/security';
import { verifyPairingToken } from '@/lib/remote/token';

export const runtime = 'nodejs';

type Body = {
  sid?: string;
  token?: string;
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
    const { sid, token, message } = (await request.json()) as Body;
    if (!sid || !token) {
      return json(
        { code: 400, message: 'sid and token required' },
        { status: 400 }
      );
    }
    const payload = await verifyPairingToken(token);
    if (!payload || payload.sid !== sid) {
      return json({ code: 401, message: 'invalid token' }, { status: 401 });
    }

    // 需要先找到会话的owner
    const sessionKeys = await scanKeysDirect(`u:*:rc:${sid}`);

    if (sessionKeys.length === 0) {
      return json({ code: 404, message: 'session not found' }, { status: 404 });
    }

    const sessionKey = sessionKeys[0];
    // 更新会话的playerLastActive时间，表示有播放器端活跃
    await hsetDirect(sessionKey, { playerLastActive: Date.now() });

    // 如果有消息，将其发布到Redis频道，让遥控器端能够接收
    if (message) {
      await publish(`ch:${sid}`, JSON.stringify({ ts: Date.now(), message }));
    }

    return json({ code: 0, message: 'ok' });
  } catch (err) {
    console.error('Status update error', err);
    return json(
      { code: 500, message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
