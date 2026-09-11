import rateLimit from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { Request } from 'express';
import { redis } from '../db/redis';

/**
 * Strips port suffixes from IP addresses so that `192.0.2.1:12345`
 * and `[::1]:8080` both resolve to clean IPs for consistent bucketing.
 */
const extractCleanIp = (req: Request): string => {
  const raw = req.ip || 'unknown-ip';

  // IPv4 with port — 192.0.2.1:12345 → 192.0.2.1
  if (raw.includes(':') && !raw.includes('[')) {
    const parts = raw.split(':');
    if (parts.length === 2 && parts[0].split('.').length === 4) {
      return parts[0];
    }
  }

  // Bracketed IPv6 — [::1]:8080 → ::1
  if (raw.startsWith('[')) {
    const closingBracket = raw.indexOf(']');
    if (closingBracket !== -1) {
      return raw.slice(1, closingBracket);
    }
  }

  return raw;
};

/**
 * Generates a unique key based on normalized email, falling back to IP.
 * Isolates buckets so one user missing an email doesn't block everyone else.
 */
const emailKeyGenerator = (req: Request): string => {
  const clientIp = extractCleanIp(req);
  const rawEmail = req.body?.email;

  if (typeof rawEmail === 'string' && rawEmail.trim().length > 0) {
    const normalizedEmail = rawEmail.trim().toLowerCase();
    return `email_${normalizedEmail}`;
  }

  return `ip_${clientIp}`;
};

/**
 * Factory — each rate limiter needs its own RedisStore instance with a
 * unique prefix so express-rate-limit v8 doesn't raise ERR_ERL_STORE_REUSE.
 */
const createStore = (prefix: string) =>
  new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) =>
      redis.call(command, ...args) as Promise<RedisReply>,
  });

// Base configuration shared across limiters (store is set per-limiter)
const baseConfig = {
  standardHeaders: true, // RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset
  legacyHeaders: false,
  // Skip CORS preflight requests so mobile apps aren't double-counted
  skip: (req: Request) => req.method === 'OPTIONS',
};

/**
 * Global gateway cap — 5 000 req / sec across ALL clients.
 * Prevents server overload and database exhaustion.
 * Applied before every per-IP limiter in the middleware chain.
 */
export const globalLimiter = rateLimit({
  ...baseConfig,
  store: createStore('global'),
  windowMs: 1 * 1000, // 1 second
  max: 5000,
  keyGenerator: () => 'global', // single shared bucket
  statusCode: 429,
  message: { success: false, message: 'Server is experiencing high traffic. Please retry shortly.' },
});

/**
 * Public API limiter — 100 req / min per IP.
 * Covers general GET requests, public endpoints, and scraper defence.
 * Successful responses are NOT counted so normal browsing isn't penalised.
 */
export const publicLimiter = rateLimit({
  ...baseConfig,
  store: createStore('public'),
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => extractCleanIp(req),
  statusCode: 429,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

/**
 * Auth attempt limiter — 5 req / min.
 * Keyed by email (falls back to IP) for login, signup, OTP send/verify,
 * and password-reset routes. Prevents brute-forcing while isolating
 * one user's failures from another's.
 */
export const authLimiter = rateLimit({
  ...baseConfig,
  store: createStore('auth'),
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5,
  skipSuccessfulRequests: true,
  keyGenerator: emailKeyGenerator,
  statusCode: 429,
  message: { success: false, message: 'Too many auth attempts, please try again later.' },
});

/**
 * @deprecated Use `authLimiter` directly — same config (5 req / min).
 */
export const otpLimiter = authLimiter;
