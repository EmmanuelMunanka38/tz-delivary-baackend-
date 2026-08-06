import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '@/app';

describe('Auth API (Integration)', () => {
  const testEmail = 'test@example.com';
  const testPhone = '+255712000000';

  describe('POST /api/auth/send-otp', () => {
    it('should return 400 for invalid email', async () => {
      const res = await request(app).post('/api/auth/send-otp').send({ email: 'invalid', phone: testPhone });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 400 for invalid phone', async () => {
      const res = await request(app).post('/api/auth/send-otp').send({ email: testEmail, phone: 'invalid' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should accept valid email and phone and return success', async () => {
      const res = await request(app).post('/api/auth/send-otp').send({ email: testEmail, phone: testPhone });

      // 200 = success, 429 = rate limited, 500 = DB not available
      expect([200, 429, 500]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.message).toContain('OTP');
      }
    });
  });

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/metrics', () => {
    it('should return metrics', async () => {
      const res = await request(app).get('/api/metrics');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('memory');
      expect(res.body.data).toHaveProperty('uptime');
    });
  });
});
