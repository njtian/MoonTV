/* eslint-disable no-console */
import { get, hgetall, hset, setex, setnxex } from '@/lib/remote/redis';
import { isAllowedOrigin, isRemoteEnabled } from '@/lib/remote/security';
import { generateControllerId, verifyPairingToken } from '@/lib/remote/token';

export const runtime = 'nodejs';

type Body = {
  sid?: string;
  token?: string;
  controllerId?: string;
  heartbeat?: boolean;
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
    const { sid, token, controllerId, heartbeat } =
      (await request.json()) as Body;
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

    const s = await hgetall(`s:${sid}`);
    if (!s || !s.ownerUserId) {
      return json({ code: 404, message: 'session not found' }, { status: 404 });
    }

    // Optional: verify token hash matches stored pairingTokenHash
    // We accept signed token without hashing check to allow rotation without immediate update.

    const lockKey = `lock:${sid}`;
    const lockTtl = 20; // 减少锁TTL到20秒，提高响应性

    // Heartbeat: extend existing lock
    if (heartbeat && controllerId) {
      const current = await get(lockKey);
      if (current === controllerId) {
        await setex(lockKey, controllerId, lockTtl);
        return json({
          code: 0,
          message: 'ok',
          data: { controllerId, sid, heartbeat: true },
        });
      }
      return json({ code: 409, message: 'not lock owner' }, { status: 409 });
    }

    // Claim: acquire lock if free or same owner
    const newControllerId = controllerId || generateControllerId();
    const acquired = await setnxex(lockKey, newControllerId, lockTtl);
    if (!acquired) {
      // If already owned by same controller, extend TTL
      const current = await get(lockKey);
      if (current === newControllerId) {
        await setex(lockKey, newControllerId, lockTtl);
        return json({
          code: 0,
          message: 'ok',
          data: { controllerId: newControllerId, sid },
        });
      }

      // Check if the lock has expired but session still has controllerId
      // This can happen when heartbeat fails but session data persists
      if (!current && s.controllerId) {
        // Lock expired, allow new controller to take over
        // Clear the old controllerId from session
        await hset(`s:${sid}`, { controllerId: '' });
        // Try to acquire lock again
        const retryAcquired = await setnxex(lockKey, newControllerId, lockTtl);
        if (retryAcquired) {
          await hset(`s:${sid}`, { controllerId: newControllerId });
          return json({
            code: 0,
            message: 'ok',
            data: { controllerId: newControllerId, sid },
          });
        }
      }

      return json({ code: 423, message: 'locked' }, { status: 423 });
    }

    // Persist controllerId on session for visibility
    await hset(`s:${sid}`, { controllerId: newControllerId });

    return json({
      code: 0,
      message: 'ok',
      data: { controllerId: newControllerId, sid },
    });
  } catch (err) {
    console.error('Claim error', err);
    return json(
      { code: 500, message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
