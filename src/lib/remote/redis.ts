/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import { Redis } from '@upstash/redis';
import { createClient } from 'redis';

let upstashClient: any | null = null;
let nodeRedisClient: any | null = null;

export type PubSubClient = {
  publish: (channel: string, message: string) => Promise<number> | number;
  subscribe?: (
    channel: string,
    onMessage: (message: string) => void
  ) => Promise<() => Promise<void>>;
};

export function getKey(key: string): string {
  return `rc:${key}`;
}

export function getRedis(): {
  kv: any;
  type: 'upstash' | 'node';
} {
  const upstashUrl = process.env.UPSTASH_URL;
  const upstashToken = process.env.UPSTASH_TOKEN;
  const redisUrl = process.env.REDIS_URL;

  if (upstashUrl && upstashToken) {
    if (!upstashClient) {
      upstashClient = new (Redis as any)({
        url: upstashUrl,
        token: upstashToken,
      });
    }
    return { kv: upstashClient, type: 'upstash' };
  }

  if (redisUrl) {
    if (!nodeRedisClient) {
      nodeRedisClient = createClient({ url: redisUrl });
      nodeRedisClient.on('error', (err: unknown) =>
        console.error('Redis error', err)
      );
      // Lazy connect; connect when first used
    }
    return { kv: nodeRedisClient, type: 'node' };
  }

  throw new Error(
    'No Redis configured. Set UPSTASH_URL/UPSTASH_TOKEN or REDIS_URL'
  );
}

export async function ensureConnected(): Promise<void> {
  const { kv, type } = getRedis();
  if (type === 'node') {
    const client = kv as any;
    if (!client.isOpen) {
      await client.connect();
    }
  }
}

export async function hset(
  key: string,
  value: Record<string, string | number | null | undefined>
): Promise<void> {
  const { kv, type } = getRedis();
  const k = getKey(key);
  if (type === 'upstash') {
    await (kv as any).hset(k, value as Record<string, string | number>);
  } else {
    await ensureConnected();
    await (kv as any).hSet(k, value as Record<string, string | number>);
  }
}

export async function hgetall(key: string): Promise<Record<string, string>> {
  const { kv, type } = getRedis();
  const k = getKey(key);
  if (type === 'upstash') {
    const res = await (kv as any).hgetall(k);
    return res || {};
  } else {
    await ensureConnected();
    const res = await (kv as any).hGetAll(k);
    return res as Record<string, string>;
  }
}

export async function del(key: string): Promise<void> {
  const { kv, type } = getRedis();
  const k = getKey(key);
  if (type === 'upstash') {
    await (kv as any).del(k);
  } else {
    await ensureConnected();
    await (kv as any).del(k);
  }
}

export async function setnxex(
  key: string,
  value: string,
  ttlSeconds: number
): Promise<boolean> {
  const { kv, type } = getRedis();
  const k = getKey(key);
  if (type === 'upstash') {
    const res = await (kv as any).set(k, value, { nx: true, ex: ttlSeconds });
    return res === 'OK';
  } else {
    await ensureConnected();
    const res = await (kv as any).set(k, value, { NX: true, EX: ttlSeconds });
    return res === 'OK';
  }
}

export async function setex(
  key: string,
  value: string,
  ttlSeconds: number
): Promise<void> {
  const { kv, type } = getRedis();
  const k = getKey(key);
  if (type === 'upstash') {
    await (kv as any).set(k, value, { ex: ttlSeconds });
  } else {
    await ensureConnected();
    await (kv as any).setEx(k, ttlSeconds, value);
  }
}

export async function publish(channel: string, message: string): Promise<void> {
  const { kv, type } = getRedis();
  const ch = getKey(channel);
  if (type === 'upstash') {
    await (kv as any).publish(ch, message);
  } else {
    await ensureConnected();
    await (kv as any).publish(ch, message);
  }
}

export async function get(key: string): Promise<string | null> {
  const { kv, type } = getRedis();
  const k = getKey(key);
  if (type === 'upstash') {
    const res = await (kv as any).get(k);
    return typeof res === 'string' ? res : res == null ? null : String(res);
  } else {
    await ensureConnected();
    const res = await (kv as any).get(k);
    return res as string | null;
  }
}
