import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import * as authService from '@/services/auth.service';

vi.mock('@/db/prisma', () => {
  return {
    default: {
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
      },
    },
  };
});

vi.mock('jsonwebtoken', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jsonwebtoken')>();
  const anyActual = actual as any;
  return {
    ...anyActual,
    default: { ...anyActual.default, verify: vi.fn() },
    verify: vi.fn(),
  };
});

describe('Auth Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateOtp', () => {
    it('should generate a 4-digit OTP', () => {
      const otp = authService.generateOtp();
      expect(otp).toMatch(/^\d{4}$/);
    });

    it('should generate different OTPs each time', () => {
      const otp1 = authService.generateOtp();
      const otp2 = authService.generateOtp();
      expect(otp1).not.toBe(otp2);
    });
  });

  describe('hashOtp', () => {
    it('should hash an OTP', async () => {
      const otp = '1234';
      const hash = await authService.hashOtp(otp);
      expect(hash).toBeDefined();
      expect(hash).not.toBe(otp);
    });

    it('should produce different hashes for same OTP', async () => {
      const otp = '1234';
      const hash1 = await authService.hashOtp(otp);
      const hash2 = await authService.hashOtp(otp);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('generateTokens', () => {
    it('should generate access and refresh tokens', async () => {
      const prisma = (await import('@/db/prisma')).default;
      (prisma.user.update as any).mockResolvedValue({});

      const tokens = await authService.generateTokens('test-user-id', 'customer');
      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();

      const decoded = jwt.decode(tokens.accessToken) as any;
      expect(decoded.userId).toBe('test-user-id');
      expect(decoded.role).toBe('customer');
    });

    it('should generate different token pairs for different calls', async () => {
      const prisma = (await import('@/db/prisma')).default;
      (prisma.user.update as any).mockResolvedValue({});

      const tokens1 = await authService.generateTokens('user-1', 'customer');
      const tokens2 = await authService.generateTokens('user-2', 'restaurant_owner');
      expect(tokens1.accessToken).not.toBe(tokens2.accessToken);
      expect(tokens1.refreshToken).not.toBe(tokens2.refreshToken);
    });
  });

  describe('sanitizeUser', () => {
    it('should remove sensitive fields from user object', () => {
      const user = {
        id: '123',
        phone: '+255712345678',
        otpCode: 'hashed-otp',
        otpExpiresAt: new Date(),
        refreshToken: 'some-token',
        name: 'Test User',
        role: 'customer',
      };

      const sanitized = authService.sanitizeUser(user);

      expect(sanitized).not.toHaveProperty('otpCode');
      expect(sanitized).not.toHaveProperty('otpExpiresAt');
      expect(sanitized).not.toHaveProperty('refreshToken');
      expect(sanitized).toHaveProperty('id', '123');
      expect(sanitized).toHaveProperty('phone', '+255712345678');
      expect(sanitized).toHaveProperty('name', 'Test User');
    });
  });

  describe('socialLogin', () => {
    const mockVerifyToken = (payload: any) => {
      (jwt.verify as any).mockImplementation(
        (token: string, _key: unknown, _opts: unknown, cb: (err: any, decoded?: any) => void) =>
          cb(null, payload),
      );
    };

    it('should throw when the Auth0 token payload has no email', async () => {
      mockVerifyToken({ sub: 'google-oauth2|123', email_verified: true });

      await expect(authService.socialLogin('some-id-token')).rejects.toThrow(
        'has no email address',
      );
    });

    it('should throw when the provider email is not verified', async () => {
      mockVerifyToken({
        sub: 'google-oauth2|123',
        email: 'user@example.com',
        email_verified: false,
      });

      await expect(authService.socialLogin('some-id-token')).rejects.toThrow(
        'not verified',
      );
    });

    it('should create a new customer user and issue tokens', async () => {
      const prisma = (await import('@/db/prisma')).default;
      mockVerifyToken({
        sub: 'google-oauth2|123',
        email: 'newuser@example.com',
        email_verified: true,
        name: 'New User',
        picture: 'https://example.com/avatar.png',
      });
      (prisma.user.findUnique as any).mockResolvedValueOnce(null);
      (prisma.user.create as any).mockResolvedValueOnce({
        id: 'social-user-1',
        email: 'newuser@example.com',
        name: 'New User',
        avatar: 'https://example.com/avatar.png',
        role: 'customer',
        phone: null,
      });
      (prisma.user.update as any).mockResolvedValue({});

      const result = await authService.socialLogin('some-id-token');

      expect(result.isNewUser).toBe(true);
      expect(result.user.role).toBe('customer');
      expect(result.user.id).toBe('social-user-1');
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('should log in an existing user without changing role', async () => {
      const prisma = (await import('@/db/prisma')).default;
      mockVerifyToken({
        sub: 'google-oauth2|123',
        email: 'existing@example.com',
        email_verified: true,
        name: 'Existing User',
      });
      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: 'social-user-2',
        email: 'existing@example.com',
        name: 'Existing User',
        role: 'customer',
        phone: null,
      });
      (prisma.user.update as any).mockResolvedValue({});

      const result = await authService.socialLogin('some-id-token');

      expect(result.isNewUser).toBe(false);
      expect(result.user.role).toBe('customer');
    });
  });
});
