import Redis from 'ioredis';
import { Redis as UpstashRedis } from '@upstash/redis';
import config from '../config';

/**
 * ioredis client — used by BullMQ and Socket.IO adapter.
 * Connects to Upstash Redis via TLS in production, or a local Redis in dev.
 */
export const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  tls: config.redis.url.startsWith('rediss://') ? {} : undefined,
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
