import rateLimit, { type Options } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { Request } from 'express';
import { redis } from '../db/redis';

/**
 * Safely fetches the real client IP parsed by Express.
 * trust proxy is set to 1 so req.ip reflects X-Forwarded-For.
 */
const getClientIp = (req: Request): string =>
  req.ip || req.socket.remoteAddress || 'unknown';

/**
 * Composite key (IP + Email) prevents brute-forcing while avoiding total IP lockout.
 */
const getAuthKey = (req: Request): string => {
  const ip = getClientIp(req);
  const email =
    typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return email ? `ip:${ip}:email:${email}` : `ip:${ip}`;
};

/**
 * Shared Redis store factory with fail-open error handling.
 * If Redis is unreachable, returns responses that let requests pass through
 * rather than crashing the server or blocking all traffic.
 */
const makeStore = (prefix: string) =>
  new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: async (
      command: string,
      ...args: string[]
    ): Promise<RedisReply> => {
      try {
        return (await redis.call(command, ...args)) as RedisReply;
      } catch (err) {
        console.error(`[RateLimiter] Redis error (${command}):`, err);
        // rate-limit-redis v6 EVAL scripts expect [totalHits, pttl].
        // Returning [0, 60000] = 0 hits → fail-open (allow request).
        if (command === 'EVALSHA' || command === 'EVAL') {
          return [0, 60_000] as unknown as RedisReply;
        }
        // SCRIPT LOAD expects a SHA string; other commands expect a number.
        return 0 as unknown as RedisReply;
      }
    },
  });

const baseConfig: Partial<Options> = {
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => req.method === 'OPTIONS',
  statusCode: 429,
};

/**
 * 1. Global Per-IP Guard: Caps high-frequency bursts (e.g., 100 req/sec) per IP.
 * Uses Redis so counts sync across all Render app instances.
 */
export const globalLimiter = rateLimit({
  ...baseConfig,
  store: makeStore('global'),
  windowMs: 1_000,
  max: 100,
  keyGenerator: getClientIp,
  message: {
    success: false,
    message: 'Too many requests from this IP. Please slow down.',
  },
});

/**
 * 2. Public API Limiter: Standard limit for general API consumption.
 * Counts ALL requests (no skipSuccessfulRequests so scrapers can't abuse 200 OK).
 */
export const publicLimiter = rateLimit({
  ...baseConfig,
  store: makeStore('public'),
  windowMs: 60 * 1_000,
  max: 300,
  keyGenerator: getClientIp,
  message: {
    success: false,
    message: 'Rate limit exceeded. Try again shortly.',
  },
});

/**
 * 3. Open Read Endpoints: Selective tight limit for heavy read operations.
 */
export const openEndpointLimiter = rateLimit({
  ...baseConfig,
  store: makeStore('open'),
  windowMs: 60 * 1_000,
  max: 60,
  keyGenerator: getClientIp,
  message: {
    success: false,
    message: 'Too many requests for this resource.',
  },
});

/**
 * 4. Auth Limiter: Protects login/signup against credential stuffing.
 * 15-minute sliding window with 10 total attempts per IP+Email pair.
 */
export const authLimiter = rateLimit({
  ...baseConfig,
  store: makeStore('auth'),
  windowMs: 15 * 60 * 1_000,
  max: 10,
  keyGenerator: getAuthKey,
  message: {
    success: false,
    message: 'Too many login attempts. Please wait 15 minutes.',
  },
});

/**
 * 5. OTP Limiter: Strict short-window cap on SMS/Email verification codes.
 */
export const otpLimiter = rateLimit({
  ...baseConfig,
  store: makeStore('otp'),
  windowMs: 5 * 60 * 1_000,
  max: 5,
  keyGenerator: getAuthKey,
  message: {
    success: false,
    message: 'Too many OTP requests. Please wait a few minutes.',
  },
});
