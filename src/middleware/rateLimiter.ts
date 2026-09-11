import rateLimit from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { Request } from 'express';
import { redis } from '../db/redis';

const extractCleanIp = (req: Request): string => {
  const raw = req.ip || 'unknown-ip';

  if (raw.includes(':') && !raw.includes('[')) {
    const parts = raw.split(':');
    if (parts.length === 2 && parts[0].split('.').length === 4) {
      return parts[0];
    }
  }

  if (raw.startsWith('[')) {
    const closingBracket = raw.indexOf(']');
    if (closingBracket !== -1) {
      return raw.slice(1, closingBracket);
    }
  }

  return raw;
};

/**
 * Composite key (IP + Email) prevents an attacker from locking out real users,
 * while ensuring an attacker can't brute-force an account from a single IP.
 */
const emailKeyGenerator = (req: Request): string => {
  const clientIp = extractCleanIp(req);
  const rawEmail = req.body?.email;

  if (typeof rawEmail === 'string' && rawEmail.trim().length > 0) {
    const normalizedEmail = rawEmail.trim().toLowerCase();
    return `${clientIp}_email_${normalizedEmail}`;
  }

  return `ip_${clientIp}`;
};

const createStore = (prefix: string) =>
  new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) =>
      redis.call(command, ...args) as Promise<RedisReply>,
  });

const baseConfig = {
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => req.method === 'OPTIONS',
};

/**
 * 1. Global Limiter: Uses Memory store (or increased limit) to prevent Redis delays 
 * from blocking legitimate overall traffic spikes.
 */
export const globalLimiter = rateLimit({
  ...baseConfig,
  windowMs: 1 * 1000,
  max: 10000, // Increased threshold
  keyGenerator: () => 'global',
  statusCode: 429,
  message: { success: false, message: 'Server is experiencing high traffic. Please retry shortly.' },
});

/**
 * 2. Public API Limiter: Window increased to 300 req / min to prevent standard 
 * frontend asset loading or fast navigation from triggering false 429s.
 */
export const publicLimiter = rateLimit({
  ...baseConfig,
  store: createStore('public'),
  windowMs: 1 * 60 * 1000,
  max: 300, // Raised from 100 to prevent SPA false positives
  skipSuccessfulRequests: false,
  keyGenerator: (req) => extractCleanIp(req),
  statusCode: 429,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

/**
 * 3. Auth Limiter: Dedicated store for standard login/signup attempts.
 */
export const authLimiter = rateLimit({
  ...baseConfig,
  store: createStore('auth'),
  windowMs: 1 * 60 * 1000,
  max: 10, // Raised to 10 attempts/min
  skipSuccessfulRequests: true,
  keyGenerator: emailKeyGenerator,
  statusCode: 429,
  message: { success: false, message: 'Too many auth attempts, please try again later.' },
});

/**
 * 4. OTP Limiter: Separate Redis bucket ('otp') so hitting the login limit 
 * does NOT block a user from requesting/verifying an OTP code.
 */
export const otpLimiter = rateLimit({
  ...baseConfig,
  store: createStore('otp'), // Distinct store from auth
  windowMs: 1 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: false, // Prevents automated rapid re-use on valid OTPs
  keyGenerator: emailKeyGenerator,
  statusCode: 429,
  message: { success: false, message: 'Too many OTP attempts, please try again later.' },
});