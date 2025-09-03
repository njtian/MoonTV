/* eslint-disable no-console */
import { hgetallDirect, hsetDirect, scanKeysDirect } from '@/lib/remote/redis';
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
    const checkType = searchParams.get('checkType') || 'player';

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

    // 检查会话是否存在 - 需要先找到会话的owner
    // 由于我们不知道owner，需要通过scanKeys来查找
    const sessionKeys = await scanKeysDirect(`u:*:rc:${sid}`);

    if (sessionKeys.length === 0) {
      return json({ code: 404, message: 'session not found' }, { status: 404 });
    }

    const sessionKey = sessionKeys[0];
    const session = await hgetallDirect(sessionKey);
    if (!session || !session.ownerUserId) {
      return json({ code: 404, message: 'session not found' }, { status: 404 });
    }

    // 使用服务器时间检查不同端的状态
    const serverTime = Date.now();
    let hasSubscribers = false;

    // 根据请求来源更新对应的lastActive时间戳
    if (checkType === 'controller') {
      // 播放器请求检查遥控器状态：更新playerLastActive，表示播放器在线
      await hsetDirect(sessionKey, { playerLastActive: serverTime });
      // 检查遥控器端是否活跃
      hasSubscribers = !!(
        session.controllerLastActive &&
        serverTime - parseInt(session.controllerLastActive) < 10000
      );
    } else {
      // 遥控器请求检查播放器状态：更新controllerLastActive，表示遥控器在线
      await hsetDirect(sessionKey, { controllerLastActive: serverTime });
      // 检查播放器端是否活跃（默认）
      hasSubscribers = !!(
        session.playerLastActive &&
        serverTime - parseInt(session.playerLastActive) < 10000
      );
    }

    return json({
      code: 0,
      message: 'ok',
      data: {
        hasSubscribers,
        serverTime, // 返回服务器时间供客户端参考
        session: {
          ownerUserId: session.ownerUserId,
          createdAt: session.createdAt,
          lastActive: session.lastActive,
          playerLastActive: session.playerLastActive,
          controllerLastActive: session.controllerLastActive,
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

export async function POST(request: Request) {
  try {
    if (!isRemoteEnabled()) {
      return json({ code: 400, message: 'Remote disabled' }, { status: 400 });
    }

    const body = await request.json();
    const {
      sid,
      token,
      checkType = 'player',
      updateControllerStatus = false,
    } = body;

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

    // 检查会话是否存在 - 需要先找到会话的owner
    const sessionKeys = await scanKeysDirect(`u:*:rc:${sid}`);

    if (sessionKeys.length === 0) {
      return json({ code: 404, message: 'session not found' }, { status: 404 });
    }

    const sessionKey = sessionKeys[0];
    const session = await hgetallDirect(sessionKey);
    if (!session || !session.ownerUserId) {
      return json({ code: 404, message: 'session not found' }, { status: 404 });
    }

    // 如果需要更新控制器状态，先更新
    if (updateControllerStatus) {
      await hsetDirect(sessionKey, { controllerLastActive: Date.now() });
    }

    // 使用服务器时间检查不同端的状态
    const serverTime = Date.now();
    let hasSubscribers = false;
    if (checkType === 'controller') {
      // 检查遥控器端是否活跃
      hasSubscribers = !!(
        session.controllerLastActive &&
        serverTime - parseInt(session.controllerLastActive) < 10000
      );
    } else {
      // 检查播放器端是否活跃（默认）
      hasSubscribers = !!(
        session.playerLastActive &&
        serverTime - parseInt(session.playerLastActive) < 10000
      );
    }

    return json({
      code: 0,
      message: 'ok',
      data: {
        hasSubscribers,
        serverTime, // 返回服务器时间供客户端参考
        session: {
          ownerUserId: session.ownerUserId,
          createdAt: session.createdAt,
          lastActive: session.lastActive,
          playerLastActive: session.playerLastActive,
          controllerLastActive: session.controllerLastActive,
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
