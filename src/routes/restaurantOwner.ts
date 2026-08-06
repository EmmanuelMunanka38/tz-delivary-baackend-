import { Router, Response } from 'express';
import prisma from '../db/prisma';
import auth, { AuthRequest } from '../middleware/auth';
import role from '../middleware/role';

const router = Router();

router.get('/dashboard', auth, role('restaurant_owner'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const restaurants = await prisma.restaurant.findMany({
      where: { ownerId: req.userId },
      select: { id: true },
    });
    const restaurantIds = restaurants.map((r: any) => r.id);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayOrders = await prisma.order.findMany({
      where: {
        restaurantId: { in: restaurantIds },
        createdAt: { gte: today },
      },
    });

    const dailyRevenue = todayOrders.reduce((sum: number, o: any) => sum + o.total, 0);
    const todayOrderCount = todayOrders.length;

    const activeOrders = await prisma.order.findMany({
      where: {
        restaurantId: { in: restaurantIds },
        status: { in: ['restaurant_accepted', 'preparing', 'ready_for_pickup', 'driver_assigned', 'picked_up', 'on_the_way', 'arrived'] },
      },
    });

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const yesterdayOrders = await prisma.order.findMany({
      where: {
        restaurantId: { in: restaurantIds },
        createdAt: { gte: yesterday, lt: today },
      },
    });

    const yesterdayOrderCount = yesterdayOrders.length;
    const yesterdayRevenue = yesterdayOrders.reduce((sum: number, o: any) => sum + o.total, 0);

    const completedOrders = await prisma.order.findMany({
      where: {
        restaurantId: { in: restaurantIds },
        status: 'delivered',
      },
    });

    const totalRevenue = completedOrders.reduce((sum: number, o: any) => sum + o.total, 0);

    const activeRiderIds = new Set(
      activeOrders.filter((o: any) => o.riderId).map((o: any) => o.riderId!)
    );

    res.json({
      success: true,
      data: {
        todayOrders: todayOrderCount,
        dailyRevenue,
        activeRiders: activeRiderIds.size,
        orderGrowth: yesterdayOrderCount > 0
          ? Math.round(((todayOrderCount - yesterdayOrderCount) / yesterdayOrderCount) * 100)
          : todayOrderCount > 0 ? 100 : 0,
        revenueGrowth: yesterdayRevenue > 0
          ? Math.round(((dailyRevenue - yesterdayRevenue) / yesterdayRevenue) * 100)
          : dailyRevenue > 0 ? 100 : 0,
        totalOrders: completedOrders.length,
        totalRevenue,
      },
    });
  } catch (error) {
    console.error('Restaurant owner dashboard error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard' });
  }
});

export default router;
