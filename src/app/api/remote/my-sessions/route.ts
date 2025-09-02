/* eslint-disable no-console */
import { getAuthInfoFromCookie } from '@/lib/auth';
import { hgetall, scanKeys } from '@/lib/remote/redis';
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

    const authInfo = getAuthInfoFromCookie(
      request as Request & { headers: Headers }
    );
    const username = authInfo?.username;
    if (!username) {
      return json({ code: 401, message: 'Unauthorized' }, { status: 401 });
    }

    // 扫描所有会话键
    const sessionKeys = await scanKeys('s:*');

    const userSessions: Array<{
      sid: string;
      createdAt: number;
      lastActive?: number;
      status: string;
      controllerId?: string;
    }> = [];

    // 检查每个会话是否属于当前用户
    for (const key of sessionKeys) {
      try {
        const session = await hgetall(key);
        if (session.ownerUserId === username) {
          const sid = key.replace('s:', ''); // 移除前缀
          userSessions.push({
            sid,
            createdAt: parseInt(session.createdAt || '0'),
            lastActive: session.lastActive
              ? parseInt(session.lastActive)
              : undefined,
            status: session.status || 'active',
            controllerId: session.controllerId || undefined,
          });
        }
      } catch (error) {
        console.warn(`Failed to read session ${key}:`, error);
        // 继续处理其他会话
      }
    }

    // 按创建时间降序排序（最新的在前）
    userSessions.sort((a, b) => b.createdAt - a.createdAt);

    return json({
      code: 0,
      message: 'ok',
      data: {
        sessions: userSessions,
        total: userSessions.length,
      },
    });
  } catch (err) {
    console.error('Get user sessions error', err);
    return json(
      { code: 500, message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
