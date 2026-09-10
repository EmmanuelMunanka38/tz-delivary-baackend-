import rateLimit from 'express-rate-limit';
import { Request } from 'express';

/**
 * Generates a unique key based on normalized email, falling back to IP.
 * Isolates buckets so one user missing an email doesn't block everyone else.
 */
const emailKeyGenerator = (req: Request): string => {
  const clientIp = req.ip || 'unknown-ip';
  const rawEmail = req.body?.email;

  if (typeof rawEmail === 'string' && rawEmail.trim().length > 0) {
    const normalizedEmail = rawEmail.trim().toLowerCase();
    return `email_${normalizedEmail}`;
  }

  return `ip_${clientIp}`;
};

// Base configuration shared across limiters
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
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => req.ip || 'unknown-ip',
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
