/* eslint-disable no-console */
import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { hgetallDirect, hsetDirect } from '@/lib/remote/redis';
import { isAllowedOrigin, isRemoteEnabled } from '@/lib/remote/security';
import { signPairingToken } from '@/lib/remote/token';

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

    const authInfo = getAuthInfoFromCookie(request as NextRequest);
    const username = authInfo?.username;
    if (!username) {
      return json({ code: 401, message: 'Unauthorized' }, { status: 401 });
    }

    const { sid } = (await request.json()) as { sid?: string };
    if (!sid) {
      return json({ code: 400, message: 'sid required' }, { status: 400 });
    }

    // 检查会话是否存在且属于当前用户
    const sessionKey = `u:${username}:rc:${sid}`;
    const session = await hgetallDirect(sessionKey);
    if (!session || !session.ownerUserId) {
      return json({ code: 404, message: 'Session not found' }, { status: 404 });
    }

    if (session.ownerUserId !== username) {
      return json({ code: 403, message: 'Access denied' }, { status: 403 });
    }

    // 生成新的token
    const token = await signPairingToken({
      sid,
      owner: username,
      scope: 'control',
    });

    // 更新会话的token（简化：直接存储token）
    await hsetDirect(sessionKey, {
      pairingTokenHash: token,
    });

    // 构建控制器URL
    const u = new URL(request.url);
    const xfHost = request.headers.get('x-forwarded-host');
    const xfProto =
      request.headers.get('x-forwarded-proto') || u.protocol.replace(':', '');
    let origin = u.origin;
    if (xfHost) {
      origin = `${xfProto || 'http'}://${xfHost}`;
    } else if (u.hostname === '0.0.0.0') {
      origin = `${u.protocol}//localhost${u.port ? `:${u.port}` : ''}`;
    }
    const controllerUrl = new URL('/controller', origin);
    controllerUrl.searchParams.set('sid', sid);
    controllerUrl.searchParams.set('t', token);

    return json({
      code: 0,
      message: 'ok',
      data: {
        sid,
        token,
        controllerUrl: controllerUrl.toString(),
      },
    });
  } catch (err) {
    console.error('Regenerate token error', err);
    return json(
      { code: 500, message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
