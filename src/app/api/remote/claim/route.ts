/* eslint-disable no-console */
import { del, get, hgetall, hset, setex, setnxex } from '@/lib/remote/redis';
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

    const lockKey = `lock:${sid}`;
    const lockTtl = 30; // 锁TTL为30秒

    // Heartbeat: extend existing lock
    if (heartbeat && controllerId) {
      const current = await get(lockKey);
      if (current === controllerId) {
        // 验证session中的controllerId是否一致
        if (s.controllerId === controllerId) {
          await setex(lockKey, controllerId, lockTtl);
          return json({
            code: 0,
            message: 'ok',
            data: { controllerId, sid, heartbeat: true },
          });
        } else {
          // Session中的controllerId不一致，清理并重新claim
          console.log(`心跳时发现controllerId不一致，清理lock: ${lockKey}`);
          await del(lockKey);
          await hset(`s:${sid}`, { controllerId: '' });
          return json(
            { code: 409, message: 'session mismatch, need reconnection' },
            { status: 409 }
          );
        }
      }
      return json({ code: 409, message: 'not lock owner' }, { status: 409 });
    }

    // Claim: acquire lock
    const newControllerId = controllerId || generateControllerId();

    // 尝试获取lock
    const acquired = await setnxex(lockKey, newControllerId, lockTtl);
    if (!acquired) {
      // Lock已被占用，检查占用者
      const current = await get(lockKey);

      // 如果是同一个控制器，延长TTL
      if (current === newControllerId) {
        await setex(lockKey, newControllerId, lockTtl);
        return json({
          code: 0,
          message: 'ok',
          data: { controllerId: newControllerId, sid },
        });
      }

      // 检查是否是过期lock的残留
      if (current && s.controllerId && s.controllerId !== current) {
        // 当前lock与session中的controllerId不匹配，说明是过期lock
        console.log(
          `检测到过期lock: ${lockKey}, 当前: ${current}, session中: ${s.controllerId}`
        );

        // 清理过期lock
        await del(lockKey);
        await hset(`s:${sid}`, { controllerId: '' });

        // 重新尝试获取lock
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

      // Lock仍然被有效占用，拒绝连接
      return json({ code: 423, message: 'locked' }, { status: 423 });
    }

    // 成功获取lock，保存controllerId到session
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
