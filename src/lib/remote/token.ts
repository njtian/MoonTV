/* eslint-disable no-console */
export type PairingTokenPayload = {
  sid: string;
  owner: string; // username or userId
  scope?: string; // e.g. 'control'
};

export async function signPairingToken(
  payload: PairingTokenPayload
): Promise<string> {
  // 简化token：直接使用base64编码的payload
  const token = base64UrlEncode(JSON.stringify(payload));
  return token;
}

export async function verifyPairingToken(
  token: string
): Promise<PairingTokenPayload | null> {
  try {
    // 检查是否是旧格式的token（包含.分隔符）
    if (token.includes('.')) {
      // 旧格式：提取payload部分
      const [encoded] = token.split('.');
      const json = base64UrlDecode(encoded);
      const payload = JSON.parse(json) as PairingTokenPayload;
      return payload;
    } else {
      // 新格式：直接解码base64
      const json = base64UrlDecode(token);
      const payload = JSON.parse(json) as PairingTokenPayload;
      return payload;
    }
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

// hash函数已移除，不再需要密码验证

function base64UrlEncode(input: string): string {
  // 使用Buffer进行base64编码，兼容Node.js环境
  const b64 = Buffer.from(input, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input: string): string {
  // 使用Buffer进行base64解码，兼容Node.js环境
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? 4 - (b64.length % 4) : 0;
  const padded = b64 + '='.repeat(pad);
  return Buffer.from(padded, 'base64').toString('utf8');
}

// HMAC相关函数已移除，不再需要密码验证
