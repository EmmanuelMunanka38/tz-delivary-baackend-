import Redis from 'ioredis';
import { Redis as UpstashRedis } from '@upstash/redis';
import config from '../config';

/**
 * Extracts the hostname from a Redis URL for TLS SNI.
 * e.g. `rediss://default:pass@redis.layerbase.com:6380` → `redis.layerbase.com`
 */
const getTlsOptions = (url: string): Record<string, unknown> | undefined => {
  if (!url.startsWith('rediss://')) return undefined;
  try {
    const hostname = new URL(url).hostname;
    return { servername: hostname };
  } catch {
    return {};
  }
};

/**
 * ioredis client — used by BullMQ, Socket.IO adapter, and rate limiter store.
 * Connects to Upstash/LayerBase Redis via TLS in production, or a local Redis in dev.
 */
export const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  tls: getTlsOptions(config.redis.url),
});

redis.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message);
});

redis.on('connect', () => {
  console.log('[Redis] ioredis connected');
});

/**
 * Upstash REST client — used by rate-limit-redis for distributed rate limiting.
 * Works over HTTP so it doesn't need a persistent TCP connection.
 * Falls back to a no-op when credentials are not configured (local dev).
 */
export const upstashRedis =
  config.upstash.redisRestUrl && config.upstash.redisRestToken
    ? new UpstashRedis({
        url: config.upstash.redisRestUrl,
        token: config.upstash.redisRestToken,
      })
    : null;

/**
 * Gracefully close all Redis connections (called during server shutdown).
 */
export const closeRedis = async (): Promise<void> => {
  await redis.quit();
};
