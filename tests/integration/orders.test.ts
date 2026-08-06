import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '@/app';

describe('Orders API (Integration)', () => {
  describe('GET /api/orders', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/orders');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/orders', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app)
        .post('/api/orders')
        .send({ restaurantId: 'some-id', items: [], paymentMethod: 'cash', deliveryAddress: {} });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/orders/:id/track', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/orders/123/track');
      expect(res.status).toBe(401);
    });
  });
});
