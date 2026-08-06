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
  standardHeaders: true,
  legacyHeaders: false,
  // Skip CORS preflight requests so mobile apps aren't double-counted
  skip: (req: Request) => req.method === 'OPTIONS',
};

/**
 * General API limiter. Applied to every /api/* request.
 * Kept generous so routine data fetching is never blocked during normal use,
 * and successful responses are not counted against the bucket.
 */
export const generalLimiter = rateLimit({
  ...baseConfig,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => req.ip || 'unknown-ip',
  message: { success: false, message: 'Too many requests, please try again later.' },
});

/**
 * Auth attempt limiter (used on OTP verification).
 * Keyed by email so one user's failures don't block others.
 * Successful verifications are not counted against the bucket.
 */
export const authLimiter = rateLimit({
  ...baseConfig,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  skipSuccessfulRequests: true,
  keyGenerator: emailKeyGenerator,
  message: { success: false, message: 'Too many auth attempts, please try again later.' },
});

/**
 * OTP sending limiter. Generous enough to allow a resend.
 */
export const otpLimiter = rateLimit({
  ...baseConfig,
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  keyGenerator: emailKeyGenerator,
  message: { success: false, message: 'Too many OTP requests. Please wait before trying again.' },
});
