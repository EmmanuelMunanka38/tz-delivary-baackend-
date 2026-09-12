import rateLimit, { type Options } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { Request } from 'express';
import { redis } from '../db/redis';

const ENV_PREFIX = process.env.NODE_ENV || 'production';

/**
 * Safely extracts client IP.
 * Prefers Cloudflare's un-spoofable CF-Connecting-IP header, 
 * falling back to Express's trust-proxy-calculated req.ip.
 */
const getClientIp = (req: Request): string => {
  const cfIp = req.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.trim().length > 0) {
    return cfIp.trim();
  }
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
};

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
 * Shared Redis store factory with robust fail-open error handling.
 */
const makeStore = (prefix: string) =>
  new RedisStore({
    prefix: `${ENV_PREFIX}:rl:${prefix}:`,
    sendCommand: async (
      command: string,
      ...args: string[]
    ): Promise<RedisReply> => {
      const cmd = command.toUpperCase();
      try {
        return (await redis.call(command, ...args)) as RedisReply;
      } catch (err) {
        console.error(`[RateLimiter] Redis error (${cmd}):`, err);
        
        // SCRIPT LOAD expects a 40-char SHA string
        if (cmd === 'SCRIPT') {
          return '0000000000000000000000000000000000000000' as unknown as RedisReply;
        }
        // EVALSHA / EVAL expect [totalHits, timeToExpireMs]
        if (cmd === 'EVALSHA' || cmd === 'EVAL') {
          return [0, 60_000] as unknown as RedisReply;
        }
        return 0 as unknown as RedisReply;
      }
    },
  });

const baseConfig: Partial<Options> = {
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true, // Native express-rate-limit fail-open setting
  skip: (req: Request) => req.method === 'OPTIONS',
  statusCode: 429,
};

/**
 * 1. Global Per-IP Guard: Caps high-frequency bursts per IP.
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