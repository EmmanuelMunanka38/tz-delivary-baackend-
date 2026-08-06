import { describe, it, expect } from 'vitest';
import * as orderService from '@/services/order.service';

describe('Order Service', () => {
  describe('generateOrderNumber', () => {
    it('should generate order number with PIKI- prefix', () => {
      const num = orderService.generateOrderNumber();
      expect(num).toMatch(/^PIKI-\d{6}$/);
    });

    it('should generate different numbers', () => {
      const num1 = orderService.generateOrderNumber();
      const num2 = orderService.generateOrderNumber();
      expect(num1).not.toBe(num2);
    });
  });

  describe('calculateFees', () => {
    it('should calculate service fee as 3% of subtotal', () => {
      const result = orderService.calculateFees(10000, 2000);
      expect(result.serviceFee).toBe(300);
      expect(result.total).toBe(12300);
    });

    it('should handle zero values', () => {
      const result = orderService.calculateFees(0, 0);
      expect(result.serviceFee).toBe(0);
      expect(result.total).toBe(0);
    });

    it('should round to 2 decimal places', () => {
      const result = orderService.calculateFees(99.99, 5.50);
      expect(result.serviceFee).toBe(3.00);
      expect(result.total).toBe(108.49);
    });
  });

  describe('isValidTransition', () => {
    it('should allow pending -> confirmed', () => {
      expect(orderService.isValidTransition('pending', 'confirmed')).toBe(true);
    });

    it('should allow pending -> cancelled', () => {
      expect(orderService.isValidTransition('pending', 'cancelled')).toBe(true);
    });

    it('should allow confirmed -> preparing', () => {
      expect(orderService.isValidTransition('confirmed', 'preparing')).toBe(true);
    });

    it('should allow on_the_way -> arrived', () => {
      expect(orderService.isValidTransition('on_the_way', 'arrived')).toBe(true);
    });

    it('should not allow delivered -> anything', () => {
      expect(orderService.isValidTransition('delivered', 'pending')).toBe(false);
      expect(orderService.isValidTransition('delivered', 'confirmed')).toBe(false);
    });

    it('should not allow cancelled -> anything', () => {
      expect(orderService.isValidTransition('cancelled', 'pending')).toBe(false);
    });

    it('should not allow invalid transitions', () => {
      expect(orderService.isValidTransition('pending', 'delivered')).toBe(false);
      expect(orderService.isValidTransition('confirmed', 'delivered')).toBe(false);
    });
  });

  describe('getStatusSteps', () => {
    it('should return 6 steps for any status', () => {
      const steps = orderService.getStatusSteps('pending');
      expect(steps).toHaveLength(6);
    });

    it('should mark active step correctly', () => {
      const steps = orderService.getStatusSteps('preparing');
      const activeStep = steps.find((s) => s.active);
      expect(activeStep?.key).toBe('preparing');
    });

    it('should mark earlier steps as completed', () => {
      const steps = orderService.getStatusSteps('on_the_way');
      const pending = steps.find((s) => s.key === 'pending');
      const confirmed = steps.find((s) => s.key === 'confirmed');
      const preparing = steps.find((s) => s.key === 'preparing');
      expect(pending?.completed).toBe(true);
      expect(confirmed?.completed).toBe(true);
      expect(preparing?.completed).toBe(true);
    });

    it('should not mark future steps as completed', () => {
      const steps = orderService.getStatusSteps('confirmed');
      const onTheWay = steps.find((s) => s.key === 'on_the_way');
      expect(onTheWay?.completed).toBe(false);
    });

    it('should mark all completed for delivered', () => {
      const steps = orderService.getStatusSteps('delivered');
      expect(steps.every((s) => s.completed)).toBe(true);
    });
  });
});
