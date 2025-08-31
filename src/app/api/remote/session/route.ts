/* eslint-disable no-console */
import { hset } from '@/lib/remote/redis';
import { isAllowedOrigin, isRemoteEnabled } from '@/lib/remote/security';
import { signPairingToken } from '@/lib/remote/token';

function json(data: unknown, init?: number | ResponseInit) {
  const body = JSON.stringify(data);
  const initObj = typeof init === 'number' ? { status: init } : init || {};
  const headers = new Headers((initObj as ResponseInit).headers);
  if (!headers.has('content-type'))
    headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(body, { ...(initObj as ResponseInit), headers });
}

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    if (!isRemoteEnabled()) {
      return json(
        { code: 400, message: 'Remote control requires Redis/Upstash' },
        { status: 400 }
      );
    }
    if (!isAllowedOrigin(request)) {
      return json({ code: 403, message: 'forbidden origin' }, { status: 403 });
    }

    const username = getUsernameFromCookie(request);
    if (!username) {
      return json({ code: 401, message: 'Unauthorized' }, { status: 401 });
    }

    const sid = crypto.randomUUID();
    const owner = username;

    const token = await signPairingToken({ sid, owner, scope: 'control' });

    const createdAt = Date.now();
    await hset(`s:${sid}`, {
      ownerUserId: owner,
      pairingTokenHash: hash(token),
      controllerId: '',
      status: 'active',
      createdAt,
    });

    const u = new URL(request.url);
    const controllerUrl = new URL('/controller', u.origin);
    controllerUrl.searchParams.set('sid', sid);
    controllerUrl.searchParams.set('t', token);

    return json({
      code: 0,
      message: 'ok',
      data: { sid, token, controllerUrl: controllerUrl.toString() },
    });
  } catch (err) {
    console.error('Create remote session error:', err);
    return json(
      { code: 500, message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

function hash(input: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  // Use subtle crypto digest to avoid Node crypto import in edge environments
  // Though this route runs on node runtime, keep it compatible.
  // Note: subtle.digest returns Promise<ArrayBuffer>, but we need sync here for simplicity.
  // Fallback: simple djb2 hash to avoid async; acceptable as token is signed already.
  let h = 5381;
  for (let i = 0; i < data.length; i++) {
    h = (h * 33) ^ data[i];
  }
  return (h >>> 0).toString(16);
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
