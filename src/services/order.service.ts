import prisma from '../db/prisma';
import crypto from 'crypto';

export const generateOrderNumber = (): string => {
  const suffix = crypto.randomInt(100000, 999999).toString();
  return `PIKI-${suffix}`;
};

export const calculateFees = (subtotal: number, deliveryFee: number) => {
  const serviceFee = Math.round(subtotal * 0.03 * 100) / 100;
  const total = Math.round((subtotal + deliveryFee + serviceFee) * 100) / 100;
  return { serviceFee, total };
};

const ORDER_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ['restaurant_accepted', 'cancelled'],
  restaurant_accepted: ['preparing', 'driver_assigned', 'cancelled'],
  preparing: ['ready_for_pickup', 'cancelled'],
  ready_for_pickup: ['driver_assigned'],
  driver_assigned: ['picked_up', 'cancelled'],
  picked_up: ['on_the_way'],
  on_the_way: ['arrived'],
  arrived: ['delivered'],
  delivered: [],
  cancelled: [],
};

export const isValidTransition = (from: string, to: string): boolean => {
  return ORDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
};

export const getStatusSteps = (currentStatus: string) => {
  const allSteps = [
    { key: 'pending', label: 'Order Placed' },
    { key: 'restaurant_accepted', label: 'Restaurant Accepted' },
    { key: 'preparing', label: 'Preparing' },
    { key: 'ready_for_pickup', label: 'Ready for Pickup' },
    { key: 'driver_assigned', label: 'Driver Assigned' },
    { key: 'picked_up', label: 'Picked Up' },
    { key: 'on_the_way', label: 'On the Way' },
    { key: 'arrived', label: 'Arrived' },
    { key: 'delivered', label: 'Delivered' },
  ];

  const statusOrder = ['pending', 'restaurant_accepted', 'preparing', 'ready_for_pickup', 'driver_assigned', 'picked_up', 'on_the_way', 'arrived', 'delivered'];
  const currentIdx = statusOrder.indexOf(currentStatus);

  return allSteps.map((step, i) => ({
    ...step,
    completed: i < currentIdx || currentStatus === 'delivered',
    active: i === currentIdx,
  }));
};
