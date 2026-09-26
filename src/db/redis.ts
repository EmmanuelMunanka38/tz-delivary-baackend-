import Redis from 'ioredis';
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
 * Connects to the configured Redis service (Railway in production, local Redis in dev).
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
 * Gracefully close all Redis connections (called during server shutdown).
 */
export const closeRedis = async (): Promise<void> => {
  if (redis.status === 'end') return;
  let timeout: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      redis.quit(),
      new Promise<never>((_, reject) =>
        (timeout = setTimeout(
          () => reject(new Error('Redis shutdown timed out')),
          2_000,
        )),
      ),
    ]);
  } catch (error) {
    console.warn(
      '[Redis] Graceful shutdown failed; closing the connection:',
      error instanceof Error ? error.message : error,
    );
    redis.disconnect();
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};
