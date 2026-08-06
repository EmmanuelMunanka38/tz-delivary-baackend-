import { Router, Response } from 'express';
import prisma from '../db/prisma';
import auth, { AuthRequest } from '../middleware/auth';
import role from '../middleware/role';
import { emitToUser, emitOrderUpdate } from '../socket';
import { sendPushNotification } from '../services/notification.service';

const router = Router();

router.get('/requests', auth, role('driver'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requests = await prisma.deliveryRequest.findMany({
      where: { status: 'available' },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: requests });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch requests' });  
  }
});

router.post('/requests/:id/accept', auth, role('driver'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const deliveryRequest = await prisma.deliveryRequest.findUnique({
      where: { id: req.params.id as string },
    });

    if (!deliveryRequest) {
      res.status(404).json({ success: false, message: 'Delivery request not found' });
      return;
    }

    if (deliveryRequest.status !== 'available') {
      res.status(400).json({ success: false, message: 'This delivery is no longer available' });
      return;
    }

    const updated = await prisma.deliveryRequest.update({
      where: { id: req.params.id as string },
      data: { status: 'accepted', driverId: req.userId },
    });

    // Update order: set riderId and status to driver_assigned
    const order = await prisma.order.update({
      where: { id: deliveryRequest.orderId },
      data: { riderId: req.userId, status: 'driver_assigned' as any },
    });

    // Notify restaurant that a driver accepted
    const restaurant = await prisma.restaurant.findUnique({ where: { id: order.restaurantId } });
    if (restaurant) {
      emitToUser(restaurant.ownerId, 'order:driver_assigned', {
        orderId: order.id,
        driverId: req.userId,
        message: 'A driver has accepted the delivery',
      });
    }

    // Notify customer that a driver is assigned
    emitOrderUpdate(order.id, 'order:status', {
      status: 'driver_assigned',
      orderId: order.id,
    });

    try {
      await sendPushNotification(order.userId, 'Driver Assigned', 'A driver has been assigned to your order');
    } catch { /* non-critical */ }

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Accept delivery error:', error);
    res.status(500).json({ success: false, message: 'Failed to accept delivery' });
  }
});

router.get('/active', auth, role('driver'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const activeRequest = await prisma.deliveryRequest.findFirst({
      where: { driverId: req.userId, status: 'accepted' },
    });

    res.json({ success: true, data: activeRequest || null });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch active delivery' });
  }
});

router.get('/dashboard', auth, role('driver'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayDeliveries = await prisma.order.findMany({
      where: {
        riderId: req.userId,
        status: 'delivered',
        actualDelivery: { gte: today },
      },
    });

    const todayOrders = todayDeliveries.length;
    const dailyRevenue = todayDeliveries.reduce((sum: number, d: any) => sum + d.deliveryFee, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const yesterdayDeliveries = await prisma.order.findMany({
      where: {
        riderId: req.userId,
        status: 'delivered',
        actualDelivery: { gte: yesterday, lt: today },
      },
    });

    const yesterdayOrders = yesterdayDeliveries.length;
    const yesterdayRevenue = yesterdayDeliveries.reduce((sum: number, d: any) => sum + d.deliveryFee, 0);

    const totalOrders = await prisma.order.count({
      where: { riderId: req.userId, status: 'delivered' },
    });

    const totalRevenueResult = await prisma.order.aggregate({
      where: { riderId: req.userId, status: 'delivered' },
      _sum: { deliveryFee: true },
    });

    res.json({
      success: true,
      data: {
        todayOrders,
        dailyRevenue,
        orderGrowth: yesterdayOrders > 0
          ? Math.round(((todayOrders - yesterdayOrders) / yesterdayOrders) * 100)
          : todayOrders > 0 ? 100 : 0,
        revenueGrowth: yesterdayRevenue > 0
          ? Math.round(((dailyRevenue - yesterdayRevenue) / yesterdayRevenue) * 100)
          : dailyRevenue > 0 ? 100 : 0,
        totalOrders,
        totalRevenue: totalRevenueResult._sum.deliveryFee || 0,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard' });
  }
});

export default router;
