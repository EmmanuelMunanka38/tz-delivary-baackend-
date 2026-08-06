import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../db/prisma';
import auth, { AuthRequest } from '../middleware/auth';
import role from '../middleware/role';
import validate from '../middleware/validate';
import * as orderService from '../services/order.service';
import { sendPushNotification } from '../services/notification.service';
import { emitOrderUpdate, emitToUser, emitToRole } from '../socket';

const router = Router();

const createOrderSchema = z.object({
  restaurantId: z.string().uuid(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        quantity: z.number().int().min(1),
        specialInstructions: z.string().optional(),
      })
    )
    .min(1),
  paymentMethod: z.enum(['mpesa', 'tigo_pesa', 'airtel_money', 'mixx_by_yas', 'halopesa', 'card', 'cash']),
  deliveryAddress: z.object({
    label: z.string().min(1),
    street: z.string().min(1),
    area: z.string().min(1),
    city: z.string().min(1),
    isDefault: z.boolean().optional(),
  }),
});

const updateStatusSchema = z.object({
  status: z.enum(['restaurant_accepted', 'preparing', 'ready_for_pickup', 'picked_up', 'on_the_way', 'arrived', 'delivered']),
});

router.post('/', auth, role('customer'), validate(createOrderSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { restaurantId, items, paymentMethod, deliveryAddress } = req.body;

    const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
    if (!restaurant) {
      res.status(404).json({ success: false, message: 'Restaurant not found' });
      return;
    }

    const menuItemIds = items.map((i: { menuItemId: string }) => i.menuItemId);
    const menuItems = await prisma.menuItem.findMany({
      where: { id: { in: menuItemIds } },
    });

    if (menuItems.length !== items.length) {
      res.status(400).json({ success: false, message: 'One or more menu items not found' });
      return;
    }

    const menuItemMap = new Map(menuItems.map((mi) => [mi.id, mi]));

    let subtotal = 0;
    const orderItemsData = items.map((item: { menuItemId: string; quantity: number; specialInstructions?: string }) => {
      const menuItem = menuItemMap.get(item.menuItemId)!;
      const lineTotal = menuItem.price * item.quantity;
      subtotal += lineTotal;
      return {
        menuItemId: menuItem.id,
        name: menuItem.name,
        price: menuItem.price,
        quantity: item.quantity,
        image: menuItem.image || null,
        specialInstructions: item.specialInstructions || null,
      };
    });

    const deliveryFee = restaurant.deliveryFee;
    const { serviceFee, total } = orderService.calculateFees(subtotal, deliveryFee);

    let orderNumber = orderService.generateOrderNumber();
    let existingOrder = await prisma.order.findUnique({ where: { orderNumber } });
    while (existingOrder) {
      orderNumber = orderService.generateOrderNumber();
      existingOrder = await prisma.order.findUnique({ where: { orderNumber } });
    }

    const estimatedDelivery = new Date(Date.now() + 35 * 60 * 1000);

    const order = await prisma.order.create({
      data: {
        orderNumber,
        userId: req.userId!,
        restaurantId,
        items: { create: orderItemsData },
        subtotal: Math.round(subtotal * 100) / 100,
        deliveryFee,
        serviceFee,
        total,
        paymentMethod,
        deliveryAddress: deliveryAddress as any,
        estimatedDelivery,
      },
      include: { items: true, restaurant: true },
    });

    try {
      const owner = await prisma.user.findUnique({ where: { id: restaurant.ownerId } });
      if (owner) {
        await sendPushNotification(owner.id, 'New Order!', `New order #${orderNumber} received`);
        emitToUser(owner.id, 'order:new', { orderId: order.id, orderNumber });
      }
    } catch { /* non-critical */ }

    res.status(201).json({ success: true, data: order });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ success: false, message: 'Failed to create order' });
  }
});

router.get('/', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    let where: any = {};

    if (req.userRole === 'customer') {
      where.userId = req.userId;
    } else if (req.userRole === 'restaurant_owner') {
      const restaurants = await prisma.restaurant.findMany({
        where: { ownerId: req.userId },
        select: { id: true },
      });
      where.restaurantId = { in: restaurants.map((r: any) => r.id) };
    } else if (req.userRole === 'driver') {
      where.riderId = req.userId;
    }

    const orders = await prisma.order.findMany({
      where,
      include: { items: true, restaurant: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: orders });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

async function deleteOrdersByIds(orderIds: string[]): Promise<void> {
  if (orderIds.length === 0) return;
  await prisma.deliveryRequest.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.transaction.updateMany({
    where: { orderId: { in: orderIds } },
    data: { orderId: null },
  });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
}

router.delete('/', auth, role('customer'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.userId },
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);

    await deleteOrdersByIds(orderIds);

    res.json({ success: true, message: 'All orders deleted', data: { deleted: orderIds.length } });
  } catch (error) {
    console.error('Delete all orders error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete orders' });
  }
});

router.delete('/:id', auth, role('customer'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id as string } });
    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }
    if (order.userId !== req.userId) {
      res.status(403).json({ success: false, message: 'You can only delete your own orders' });
      return;
    }

    await deleteOrdersByIds([order.id]);

    res.json({ success: true, message: 'Order deleted' });
  } catch (error) {
    console.error('Delete order error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete order' });
  }
});

router.get('/:id', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id as string },
      include: { items: true, restaurant: true },
    });

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    res.json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch order' });
  }
});

router.get('/:id/track', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id as string },
      include: {
        items: true,
      },
    });

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    let riderInfo = null;
    if (order.riderId) {
      const rider = await prisma.user.findUnique({
        where: { id: order.riderId },
        select: { id: true, name: true, phone: true, avatar: true },
      });
      riderInfo = rider;
    }

    const now = new Date();
    const estimatedMs = order.estimatedDelivery.getTime() - now.getTime();
    const estimatedMinutes = Math.max(0, Math.floor(estimatedMs / 60000));

    res.json({
      success: true,
      data: {
        status: order.status,
        estimatedMinutes,
        estimatedArrival: order.estimatedDelivery,
        rider: riderInfo,
        steps: orderService.getStatusSteps(order.status),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to track order' });
  }
});

router.put('/:id/status', auth, role('restaurant_owner', 'driver'), validate(updateStatusSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status } = req.body;
    const order = await prisma.order.findUnique({ where: { id: req.params.id as string } });

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    if (!orderService.isValidTransition(order.status, status)) {
      res.status(400).json({
        success: false,
        message: `Cannot transition from ${order.status} to ${status}`,
      });
      return;
    }

    if (req.userRole === 'restaurant_owner') {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: order.restaurantId },
    }) as any;
      if (!restaurant || restaurant.ownerId !== req.userId) {
        res.status(403).json({ success: false, message: 'You can only update orders for your own restaurant' });
        return;
      }
      if (!['restaurant_accepted', 'preparing', 'ready_for_pickup'].includes(status)) {
        res.status(403).json({ success: false, message: 'Restaurant owners can only accept, prepare, or mark orders ready for pickup' });
        return;
      }
    }

    if (req.userRole === 'driver') {
      if (order.riderId !== req.userId) {
        res.status(403).json({ success: false, message: 'You are not assigned to this order' });
        return;
      }
      if (!['picked_up', 'on_the_way', 'arrived', 'delivered'].includes(status)) {
        res.status(403).json({ success: false, message: 'Drivers can only update delivery status' });
        return;
      }
    }

    const updateData: any = { status };
    if (status === 'delivered') {
      updateData.actualDelivery = new Date();
    }

    // When restaurant marks ready_for_pickup, create delivery request + notify drivers
    if (status === 'ready_for_pickup' && req.userRole === 'restaurant_owner') {
      const restaurant = await prisma.restaurant.findUnique({
        where: { id: order.restaurantId },
        include: { owner: { select: { phone: true, name: true } } },
      });
      const orderWithItems = await prisma.order.findUnique({
        where: { id: order.id },
        include: { items: true, user: { select: { name: true, phone: true } } },
      });
      if (restaurant && orderWithItems) {
        const deliveryAddress = order.deliveryAddress as any;

        const existingRequest = await prisma.deliveryRequest.findUnique({ where: { orderId: order.id } });
        if (!existingRequest) {
          await prisma.deliveryRequest.create({
            data: {
              orderId: order.id,
              restaurant: {
                name: restaurant.name,
                address: restaurant.address,
                image: restaurant.image,
                phone: restaurant.owner.phone || null,
                location: restaurant.latitude && restaurant.longitude
                  ? { latitude: restaurant.latitude, longitude: restaurant.longitude }
                  : null,
              },
              customer: {
                name: orderWithItems.user.name || 'Customer',
                phone: orderWithItems.user.phone || null,
                address: `${deliveryAddress?.street || ''}, ${deliveryAddress?.area || ''}, ${deliveryAddress?.city || ''}`,
              },
              pickup: restaurant.address,
              dropoff: `${deliveryAddress?.street || ''}, ${deliveryAddress?.area || ''}, ${deliveryAddress?.city || ''}`,
              distance: parseFloat(restaurant.distance.replace(/[^0-9.]/g, '')) || 0,
              deliveryFee: order.deliveryFee,
              items: orderWithItems.items.map((i: any) => `${i.quantity}x ${i.name}`),
              timeLeft: 35,
              status: 'available',
            },
          });
        } else {
          await prisma.deliveryRequest.update({
            where: { orderId: order.id },
            data: { status: 'available' },
          });
        }

        // Notify all drivers
        emitToRole('driver', 'delivery:available', {
          orderId: order.id,
          orderNumber: order.orderNumber,
        });

        // Also notify the restaurant owner that it's been broadcast
        emitToUser(restaurant.ownerId, 'order:broadcast', {
          orderId: order.id,
          message: 'Order broadcasted to drivers',
        });
      }
    }

    const updated = await prisma.order.update({
      where: { id: req.params.id as string },
      data: updateData,
      include: { items: true, restaurant: true },
    });

    // Emit real-time update
    emitOrderUpdate(order.id, 'order:status', { status, orderId: order.id });

    try {
      await sendPushNotification(order.userId, 'Order Update', `Your order #${order.orderNumber} is now ${status.replace(/_/g, ' ')}`);
    } catch { /* non-critical */ }

    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update order status' });
  }
});

router.put('/:id/assign-driver', auth, role('restaurant_owner'), validate(z.object({ driverId: z.string().uuid() })), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { driverId } = req.body;
    const order = await prisma.order.findUnique({ where: { id: req.params.id as string } });

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    const restaurant = await prisma.restaurant.findUnique({ where: { id: order.restaurantId } });
    if (!restaurant || restaurant.ownerId !== req.userId) {
      res.status(403).json({ success: false, message: 'You can only assign drivers to your own orders' });
      return;
    }

    if (order.status !== 'restaurant_accepted' && order.status !== 'ready_for_pickup') {
      res.status(400).json({ success: false, message: 'Order must be accepted before assigning a driver' });
      return;
    }

    const owner = await prisma.user.findUnique({ where: { id: restaurant.ownerId }, select: { phone: true } });
    const driver = await prisma.user.findUnique({ where: { id: driverId } });
    if (!driver || driver.role !== 'driver') {
      res.status(400).json({ success: false, message: 'Invalid driver' });
      return;
    }

    const orderWithItems = await prisma.order.findUnique({
      where: { id: order.id },
      include: { items: true, user: { select: { name: true, phone: true } } },
    });

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { riderId: driverId, status: 'driver_assigned' },
    });

    const deliveryAddress = order.deliveryAddress as any;
    const deliveryRequest = await prisma.deliveryRequest.upsert({
      where: { orderId: order.id },
      update: { driverId, status: 'accepted' },
      create: {
        orderId: order.id,
        driverId,
        status: 'accepted',
        restaurant: {
          name: restaurant.name,
          address: restaurant.address,
          image: restaurant.image,
          phone: owner?.phone || null,
          location: restaurant.latitude && restaurant.longitude
            ? { latitude: restaurant.latitude, longitude: restaurant.longitude }
            : null,
        },
        customer: {
          name: orderWithItems?.user.name || 'Customer',
          phone: orderWithItems?.user.phone || null,
          address: `${deliveryAddress?.street || ''}, ${deliveryAddress?.area || ''}, ${deliveryAddress?.city || ''}`,
        },
        pickup: restaurant.address,
        dropoff: `${deliveryAddress?.street || ''}, ${deliveryAddress?.area || ''}, ${deliveryAddress?.city || ''}`,
        distance: parseFloat(restaurant.distance.replace(/[^0-9.]/g, '')) || 0,
        deliveryFee: order.deliveryFee,
        items: orderWithItems?.items.map((i: any) => `${i.quantity}x ${i.name}`) || [],
        timeLeft: 35,
      },
    });

    emitToUser(driverId, 'delivery:assigned', deliveryRequest);

    emitOrderUpdate(order.id, 'order:status', { status: 'driver_assigned', orderId: order.id });

    try {
      await sendPushNotification(driverId, 'New Delivery Assignment', `You have been assigned to order #${order.orderNumber}`);
      await sendPushNotification(order.userId, 'Driver Assigned', 'A driver has been assigned to your order');
    } catch { /* non-critical */ }

    emitToUser(restaurant.ownerId, 'order:driver_assigned', {
      orderId: order.id,
      driverId,
      message: 'Driver assigned successfully',
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Assign driver error:', error);
    res.status(500).json({ success: false, message: 'Failed to assign driver' });
  }
});

router.post('/:id/cancel', auth, role('customer'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id as string } });

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    if (order.userId !== req.userId) {
      res.status(403).json({ success: false, message: 'You can only cancel your own orders' });
      return;
    }

    if (!['pending', 'restaurant_accepted'].includes(order.status)) {
      res.status(400).json({
        success: false,
        message: 'Orders can only be cancelled when pending or accepted by restaurant',
      });
      return;
    }

    await prisma.order.update({
      where: { id: req.params.id as string },
      data: { status: 'cancelled' },
    });

    await prisma.deliveryRequest.updateMany({
      where: { orderId: order.id },
      data: { status: 'cancelled' },
    });

    emitOrderUpdate(order.id, 'order:cancelled', { orderId: order.id });

    res.json({ success: true, message: 'Order cancelled' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to cancel order' });
  }
});

router.post('/:id/reorder', auth, role('customer'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existingOrder = await prisma.order.findUnique({
      where: { id: req.params.id as string },
      include: { items: true, restaurant: true },
    });

    if (!existingOrder) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    if (existingOrder.userId !== req.userId) {
      res.status(403).json({ success: false, message: 'You can only reorder your own orders' });
      return;
    }

    const restaurant = await prisma.restaurant.findUnique({ where: { id: existingOrder.restaurantId } });
    if (!restaurant) {
      res.status(404).json({ success: false, message: 'Restaurant not found' });
      return;
    }

    const menuItemIds = existingOrder.items.map((i: any) => i.menuItemId);
    const menuItems = await prisma.menuItem.findMany({
      where: { id: { in: menuItemIds } },
    });
    const menuItemMap = new Map(menuItems.map((mi: any) => [mi.id, mi]));

    let subtotal = 0;
    const orderItemsData = existingOrder.items.map((item: any) => {
      const menuItem = menuItemMap.get(item.menuItemId);
      const price = menuItem ? menuItem.price : item.price;
      subtotal += price * item.quantity;
      return {
        menuItemId: item.menuItemId,
        name: menuItem?.name || item.name,
        price,
        quantity: item.quantity,
        image: menuItem?.image || item.image || null,
        specialInstructions: item.specialInstructions || null,
      };
    });

    const deliveryFee = restaurant.deliveryFee;
    const { serviceFee, total } = orderService.calculateFees(subtotal, deliveryFee);

    let orderNumber = orderService.generateOrderNumber();
    let orderNumberExists = await prisma.order.findUnique({ where: { orderNumber } });
    while (orderNumberExists) {
      orderNumber = orderService.generateOrderNumber();
      orderNumberExists = await prisma.order.findUnique({ where: { orderNumber } });
    }

    const estimatedDelivery = new Date(Date.now() + 35 * 60 * 1000);
    const deliveryAddress = existingOrder.deliveryAddress as any;

    const order = await prisma.order.create({
      data: {
        orderNumber,
        userId: req.userId!,
        restaurantId: restaurant.id,
        items: { create: orderItemsData },
        subtotal: Math.round(subtotal * 100) / 100,
        deliveryFee,
        serviceFee,
        total,
        paymentMethod: existingOrder.paymentMethod,
        deliveryAddress: deliveryAddress,
        estimatedDelivery,
      },
      include: { items: true, restaurant: true },
    });

    res.status(201).json({ success: true, data: order });
  } catch (error) {
    console.error('Reorder error:', error);
    res.status(500).json({ success: false, message: 'Failed to reorder' });
  }
});

export default router;
