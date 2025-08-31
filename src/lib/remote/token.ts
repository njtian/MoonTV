/* eslint-disable no-console */
export type PairingTokenPayload = {
  sid: string;
  owner: string; // username or userId
  scope?: string; // e.g. 'control'
};

export async function signPairingToken(
  payload: PairingTokenPayload
): Promise<string> {
  const secret = process.env.PASSWORD || '';
  if (!secret) throw new Error('PASSWORD must be set to sign tokens');
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const mac = await hmacHex(encoded, secret);
  return `${encoded}.${mac}`;
}

export async function verifyPairingToken(
  token: string
): Promise<PairingTokenPayload | null> {
  try {
    const [encoded, mac] = token.split('.');
    const secret = process.env.PASSWORD || '';
    if (!secret || !encoded || !mac) return null;
    const expected = await hmacHex(encoded, secret);
    if (!timingSafeEqual(mac, expected)) return null;
    const json = base64UrlDecode(encoded);
    return JSON.parse(json) as PairingTokenPayload;
  } catch {
    return null;
  }
}

export function generateControllerId(): string {
  // globalThis.crypto.randomUUID is available in modern runtimes
  return globalThis.crypto && 'randomUUID' in globalThis.crypto
    ? (globalThis.crypto as Crypto).randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function base64UrlEncode(input: string): string {
  const enc = new TextEncoder().encode(input);
  let str = '';
  for (let i = 0; i < enc.length; i++) str += String.fromCharCode(enc[i]);
  // btoa produces base64; convert to base64url
  const b64 =
    typeof btoa !== 'undefined'
      ? btoa(str)
      : Buffer.from(str, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? 4 - (b64.length % 4) : 0;
  const padded = b64 + '='.repeat(pad);
  const bin =
    typeof atob !== 'undefined'
      ? atob(padded)
      : Buffer.from(padded, 'base64').toString('binary');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message)
  );
  const arr = new Uint8Array(sig);
  const hex: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    hex.push(arr[i].toString(16).padStart(2, '0'));
  }
  return hex.join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
