/* eslint-disable no-console */
import { get, hgetall, publish } from '@/lib/remote/redis';
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
    if (!sid || !token || !message) {
      return json(
        { code: 400, message: 'sid, token, message required' },
        { status: 400 }
      );
    }

    // Verify token belongs to sid
    const payload = await verifyPairingToken(token);
    if (!payload || payload.sid !== sid) {
      return json({ code: 401, message: 'invalid token' }, { status: 401 });
    }

    // Only owner may publish status
    const s = await hgetall(`s:${sid}`);
    const owner = s?.ownerUserId;
    const username = getUsernameFromCookie(request);
    if (!owner || !username || owner !== username) {
      return json({ code: 403, message: 'owner required' }, { status: 403 });
    }

    await publish(`ch:${sid}`, JSON.stringify({ ts: Date.now(), message }));
    return json({ code: 0, message: 'ok' });
  } catch (err) {
    console.error('Status publish error', err);
    return json(
      { code: 500, message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// 新增：GET方法用于检查会话状态
export async function GET(request: Request) {
  try {
    if (!isRemoteEnabled()) {
      return json({ code: 400, message: 'Remote disabled' }, { status: 400 });
    }

    const url = new URL(request.url);
    const sid = url.searchParams.get('sid');
    const token = url.searchParams.get('t');

    if (!sid || !token) {
      return json(
        { code: 400, message: 'sid and token required' },
        { status: 400 }
      );
    }

    // Verify token belongs to sid
    const payload = await verifyPairingToken(token);
    if (!payload || payload.sid !== sid) {
      return json({ code: 401, message: 'invalid token' }, { status: 401 });
    }

    // Get session info
    const s = await hgetall(`s:${sid}`);
    if (!s || !s.ownerUserId) {
      return json({ code: 404, message: 'session not found' }, { status: 404 });
    }

    // Check if session is locked
    const lockKey = `lock:${sid}`;
    const currentLock = await get(lockKey);

    return json({
      code: 0,
      message: 'ok',
      data: {
        sid,
        owner: s.ownerUserId,
        status: s.status,
        controllerId: s.controllerId,
        isLocked: !!currentLock,
        lockOwner: currentLock,
        createdAt: s.createdAt,
      },
    });
  } catch (err) {
    console.error('Session status check error', err);
    return json(
      { code: 500, message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

function getUsernameFromCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map((c) => {
      const i = c.indexOf('=');
      if (i === -1) return [c.trim(), ''];
      const k = c.slice(0, i).trim();
      const v = c.slice(i + 1).trim();
      return [k, v];
    })
  );
  const authCookie = cookies['auth'];
  if (!authCookie) return null;
  try {
    let decoded = decodeURIComponent(authCookie);
    if (decoded.includes('%')) decoded = decodeURIComponent(decoded);
    const data = JSON.parse(decoded);
    return typeof data.username === 'string' ? data.username : null;
  } catch {
    return null;
  }
}
