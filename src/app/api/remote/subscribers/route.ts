/* eslint-disable no-console */
import { hgetall } from '@/lib/remote/redis';
import { isAllowedOrigin, isRemoteEnabled } from '@/lib/remote/security';
import { verifyPairingToken } from '@/lib/remote/token';

export const runtime = 'nodejs';

function json(data: unknown, init?: number | ResponseInit) {
  const body = JSON.stringify(data);
  const initObj = typeof init === 'number' ? { status: init } : init || {};
  const headers = new Headers((initObj as ResponseInit).headers);
  if (!headers.has('content-type'))
    headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(body, { ...(initObj as ResponseInit), headers });
}

export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url);
    const sid = searchParams.get('sid');
    const token = searchParams.get('token');

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

    // 检查会话是否存在
    const session = await hgetall(`s:${sid}`);
    if (!session || !session.ownerUserId) {
      return json({ code: 404, message: 'session not found' }, { status: 404 });
    }

    // 检查是否有订阅者（通过检查会话中是否有订阅者信息）
    // 这里我们通过检查会话的lastActive时间来判断是否有活跃的订阅者
    const hasSubscribers =
      session.lastActive && Date.now() - parseInt(session.lastActive) < 10000; // 10秒内有活动

    return json({
      code: 0,
      message: 'ok',
      data: {
        hasSubscribers,
        session: {
          ownerUserId: session.ownerUserId,
          createdAt: session.createdAt,
          lastActive: session.lastActive,
        },
      },
    });
  } catch (err) {
    console.error('Subscribers check error', err);
    return json(
      { code: 500, message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
