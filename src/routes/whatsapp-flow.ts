import { Router, Response } from 'express';
import prisma from '@/db/prisma';
import { initiateUSSDPush } from '@/services/payment.service';
import { generateOrderNumber, calculateFees } from '@/services/order.service';
import {
  whatsappFlowEncryption,
  sendEncryptedResponse,
  WhatsAppFlowRequest,
} from '@/middleware/whatsappFlowEncryption';

const router = Router();

router.post('/', whatsappFlowEncryption, async (req: WhatsAppFlowRequest, res: Response): Promise<void> => {
  try {
    const { action, screen, data, flow_token, version } = req.whatsappFlow!.decryptedBody;

    console.log(`[WhatsApp Flow] action=${action}, screen=${screen}, version=${version}`);

    let response: any;

    switch (action) {
      case 'INIT':
        response = await handleInit(screen, data, flow_token);
        break;
      case 'BACK':
        response = await handleBack(screen, data, flow_token);
        break;
      case 'data_exchange':
        response = await handleDataExchange(screen, data, flow_token);
        break;
      default:
        response = await handleDataExchange(screen, data, flow_token);
        break;
    }

    sendEncryptedResponse(req, res, response);
  } catch (error: any) {
    console.error('[WhatsApp Flow Error]', error.message || error);
    sendEncryptedResponse(req, res, {
      screen: 'MAIN_MENU',
      data: {
        greeting: 'Welcome to Piki Food!',
        user_name: 'Guest',
        error_message: 'Something went wrong. Please try again.',
      },
    });
  }
});

async function handleInit(screen: string, data: any, flowToken: string): Promise<any> {
  if (screen === 'MAIN_MENU' || !screen) {
    return {
      screen: 'MAIN_MENU',
      data: {
        greeting: 'Welcome to Piki Food!',
        user_name: 'Guest',
      },
    };
  }

  return handleDataExchange(screen, data, flowToken);
}

async function handleBack(screen: string, data: any, flowToken: string): Promise<any> {
  return handleDataExchange(screen, data, flowToken);
}

async function handleDataExchange(screen: string, data: any, flowToken: string): Promise<any> {
  const action = data?.action || data?.trigger || '';

  if (data?.action === 'browse_restaurants' || screen === 'BROWSE_RESTAURANTS') {
    return await getRestaurantsScreen();
  }

  if (data?.restaurant_id || screen === 'RESTAURANT_MENU') {
    const restaurantId = data?.restaurant_id || data?.selected_restaurant;
    if (restaurantId) {
      return await getMenuScreen(restaurantId);
    }
  }

  if (data?.selected_items || data?.action === 'add_to_cart') {
    const selectedItems = data?.selected_items;
    if (selectedItems && Array.isArray(selectedItems)) {
      for (const itemId of selectedItems) {
        await addToCart(flowToken, itemId, 1);
      }
    }
    return await getCartScreen(flowToken);
  }

  if (data?.cart_action === 'checkout' || screen === 'DELIVERY_DETAILS') {
    return await getDeliveryDetailsScreen(flowToken);
  }

  if (data?.cart_action === 'continue_shopping') {
    return await getRestaurantsScreen();
  }

  if (data?.delivery_address && data?.delivery_phone && screen !== 'PAYMENT') {
    return await getPaymentScreen(flowToken, data.delivery_address, data.delivery_phone);
  }

  if (data?.delivery_address && data?.delivery_phone && screen === 'PAYMENT') {
    return await processPayment(flowToken, data);
  }

  if (data?.action === 'track_order' || screen === 'ORDER_TRACKING') {
    const orderNumber = data?.order_number;
    if (orderNumber) {
      return await getOrderTrackingScreen(orderNumber);
    }
    return await getLatestOrderTrackingScreen(flowToken);
  }

  if (data?.action === 'my_orders' || screen === 'MY_ORDERS') {
    return await getMyOrdersScreen(flowToken);
  }

  if (data?.action === 'view_cart' || screen === 'CART') {
    return await getCartScreen(flowToken);
  }

  if (data?.order_number && screen === 'ORDER_TRACKING') {
    return await getOrderTrackingScreen(data.order_number);
  }

  return {
    screen: 'MAIN_MENU',
    data: {
      greeting: 'Welcome to Piki Food!',
      user_name: 'Guest',
    },
  };
}

async function getRestaurantsScreen(): Promise<any> {
  const restaurants = await prisma.restaurant.findMany({
    where: { isOpen: true, isApproved: true },
    take: 10,
    orderBy: { rating: 'desc' },
    select: {
      id: true,
      name: true,
      cuisine: true,
      rating: true,
      deliveryTime: true,
      deliveryFee: true,
    },
  });

  return {
    screen: 'BROWSE_RESTAURANTS',
    data: {
      restaurants: restaurants.map((r) => ({
        id: r.id,
        title: r.name,
        description: `${r.cuisine} - ${r.rating} stars - ${r.deliveryTime} - Delivery TZS ${r.deliveryFee}`,
      })),
    },
  };
}

async function getMenuScreen(restaurantId: string): Promise<any> {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { name: true },
  });

  if (!restaurant) {
    return {
      screen: 'BROWSE_RESTAURANTS',
      data: {
        error_message: 'Restaurant not found',
        restaurants: [],
      },
    };
  }

  const menuItems = await prisma.menuItem.findMany({
    where: { restaurantId, isAvailable: true },
    orderBy: { category: 'asc' },
  });

  return {
    screen: 'RESTAURANT_MENU',
    data: {
      restaurant_name: restaurant.name,
      menu_items: menuItems.map((item) => ({
        id: item.id,
        title: item.name,
        description: `${item.description} - TZS ${item.price}`,
      })),
    },
  };
}

async function addToCart(userId: string, itemId: string, quantity: number): Promise<void> {
  const menuItem = await prisma.menuItem.findUnique({ where: { id: itemId } });
  if (!menuItem || !menuItem.isAvailable) return;

  let cart = await prisma.cart.findUnique({
    where: { userId },
    include: { items: true },
  });

  if (!cart) {
    cart = await prisma.cart.create({
      data: { userId, restaurantId: menuItem.restaurantId },
      include: { items: true },
    });
  } else if (cart.restaurantId !== menuItem.restaurantId) {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await prisma.cart.update({
      where: { id: cart.id },
      data: { restaurantId: menuItem.restaurantId },
    });
    cart = await prisma.cart.findUnique({
      where: { id: cart.id },
      include: { items: true },
    });
  }

  if (!cart) return;

  const existingItem = cart.items.find((item) => item.menuItemId === itemId);
  if (existingItem) {
    await prisma.cartItem.update({
      where: { id: existingItem.id },
      data: { quantity: existingItem.quantity + quantity },
    });
  } else {
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        menuItemId: itemId,
        quantity,
        price: menuItem.price,
        name: menuItem.name,
      },
    });
  }
}

async function getCartScreen(userId: string): Promise<any> {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: { items: true },
  });

  if (!cart || cart.items.length === 0) {
    return {
      screen: 'CART',
      data: {
        restaurant_name: '',
        cart_summary: 'Your cart is empty',
        subtotal: 'TZS 0',
        delivery_fee: 'TZS 0',
        service_fee: 'TZS 0',
        total: 'TZS 0',
      },
    };
  }

  const restaurant = cart.restaurantId
    ? await prisma.restaurant.findUnique({
        where: { id: cart.restaurantId },
        select: { name: true, deliveryFee: true },
      })
    : null;

  const subtotal = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const deliveryFee = restaurant?.deliveryFee || 0;
  const serviceFee = Math.round(subtotal * 0.03);
  const total = subtotal + deliveryFee + serviceFee;

  const cartSummary = cart.items
    .map((item) => `${item.quantity}x ${item.name} - TZS ${item.price * item.quantity}`)
    .join('\n');

  return {
    screen: 'CART',
    data: {
      restaurant_name: restaurant?.name || '',
      cart_summary: cartSummary,
      subtotal: `TZS ${subtotal}`,
      delivery_fee: `TZS ${deliveryFee}`,
      service_fee: `TZS ${serviceFee}`,
      total: `TZS ${total}`,
    },
  };
}

async function getDeliveryDetailsScreen(userId: string): Promise<any> {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  return {
    screen: 'DELIVERY_DETAILS',
    data: {
      user_phone: user?.phone || user?.whatsappPhoneNumber || '',
      user_address: '',
    },
  };
}

async function getPaymentScreen(userId: string, deliveryAddress: string, deliveryPhone: string): Promise<any> {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: { items: true },
  });

  if (!cart || cart.items.length === 0 || !cart.restaurantId) {
    return {
      screen: 'CART',
      data: {
        error_message: 'Your cart is empty',
        restaurant_name: '',
        cart_summary: '',
        subtotal: 'TZS 0',
        delivery_fee: 'TZS 0',
        service_fee: 'TZS 0',
        total: 'TZS 0',
      },
    };
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: cart.restaurantId },
  });

  if (!restaurant) {
    return {
      screen: 'CART',
      data: {
        error_message: 'Restaurant not found',
        restaurant_name: '',
        cart_summary: '',
        subtotal: 'TZS 0',
        delivery_fee: 'TZS 0',
        service_fee: 'TZS 0',
        total: 'TZS 0',
      },
    };
  }

  const subtotal = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const { serviceFee, total } = calculateFees(subtotal, restaurant.deliveryFee);
  const orderNumber = generateOrderNumber();

  return {
    screen: 'PAYMENT',
    data: {
      order_number: orderNumber,
      total_amount: `TZS ${total}`,
      delivery_address: deliveryAddress,
      delivery_phone: deliveryPhone,
    },
  };
}

async function processPayment(userId: string, data: any): Promise<any> {
  const { order_number, total_amount, delivery_address, delivery_phone } = data;

  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: { items: true },
  });

  if (!cart || cart.items.length === 0 || !cart.restaurantId) {
    return {
      screen: 'CART',
      data: {
        error_message: 'Your cart is empty',
        restaurant_name: '',
        cart_summary: '',
        subtotal: 'TZS 0',
        delivery_fee: 'TZS 0',
        service_fee: 'TZS 0',
        total: 'TZS 0',
      },
    };
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: cart.restaurantId },
  });

  if (!restaurant) {
    return {
      screen: 'MAIN_MENU',
      data: {
        greeting: 'Restaurant not found. Please try again.',
        user_name: 'Guest',
        error_message: 'Restaurant not found',
      },
    };
  }

  const subtotal = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const { serviceFee, total } = calculateFees(subtotal, restaurant.deliveryFee);
  const orderNumber = order_number || generateOrderNumber();

  const order = await prisma.order.create({
    data: {
      orderNumber,
      userId,
      restaurantId: cart.restaurantId,
      subtotal,
      deliveryFee: restaurant.deliveryFee,
      serviceFee,
      total,
      status: 'pending',
      paymentMethod: 'mpesa',
      deliveryAddress: { address: delivery_address },
      estimatedDelivery: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  await prisma.orderItem.createMany({
    data: cart.items.map((item) => ({
      orderId: order.id,
      menuItemId: item.menuItemId,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
    })),
  });

  const orderReference = `PIKI${orderNumber.replace(/[^A-Za-z0-9]/g, '')}${Date.now().toString().slice(-4)}`;

  try {
    await initiateUSSDPush({
      amount: total,
      orderReference,
      phoneNumber: delivery_phone,
      currency: 'TZS',
    });

    await prisma.transaction.create({
      data: {
        orderReference,
        orderId: order.id,
        amount: total,
        phoneNumber: delivery_phone,
        status: 'PENDING',
      },
    });

    await prisma.order.update({
      where: { id: order.id },
      data: { paymentIntentId: orderReference },
    });

    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });

    return {
      screen: 'SUCCESS',
      data: {
        extension_message_response: {
          params: {
            flow_token: orderNumber,
            order_number: orderNumber,
            total: `TZS ${total}`,
            message: `Order placed! USSD push sent to ${delivery_phone}`,
          },
        },
      },
    };
  } catch (paymentError: any) {
    console.error('[WhatsApp Flow Payment Error]', paymentError.message);
    return {
      screen: 'PAYMENT',
      data: {
        order_number: orderNumber,
        total_amount: `TZS ${total}`,
        delivery_address: delivery_address,
        delivery_phone: delivery_phone,
        error_message: 'Payment failed. Please try again.',
      },
    };
  }
}

async function getOrderTrackingScreen(orderNumber: string): Promise<any> {
  const order = await prisma.order.findUnique({
    where: { orderNumber },
    include: {
      restaurant: { select: { name: true } },
      rider: { select: { name: true, phone: true } },
    },
  });

  if (!order) {
    return {
      screen: 'ORDER_TRACKING',
      data: {
        order_number: orderNumber,
        restaurant_name: 'Unknown',
        estimated_time: 'N/A',
        status_text: 'Order not found',
        current_status: 'Not found',
        driver_info: 'N/A',
      },
    };
  }

  const statusSteps = [
    'Order Placed',
    'Restaurant Accepted',
    'Preparing',
    'Ready for Pickup',
    'Driver Assigned',
    'Picked Up',
    'On the Way',
    'Arrived',
    'Delivered',
  ];

  const statusKeys = [
    'pending',
    'restaurant_accepted',
    'preparing',
    'ready_for_pickup',
    'driver_assigned',
    'picked_up',
    'on_the_way',
    'arrived',
    'delivered',
  ];

  const currentIndex = statusKeys.indexOf(order.status);
  const statusText = statusSteps
    .map((step, i) => {
      if (i < currentIndex || order.status === 'delivered') return `✓ ${step}`;
      if (i === currentIndex) return `● ${step}`;
      return `○ ${step}`;
    })
    .join(' > ');

  const estimatedTime = order.estimatedDelivery
    ? `${Math.max(0, Math.ceil((order.estimatedDelivery.getTime() - Date.now()) / 60000))} min`
    : 'N/A';

  return {
    screen: 'ORDER_TRACKING',
    data: {
      order_number: order.orderNumber,
      restaurant_name: order.restaurant.name,
      estimated_time: estimatedTime,
      status_text: statusText,
      current_status: statusSteps[currentIndex] || order.status,
      driver_info: order.rider ? `Driver: ${order.rider.name} - ${order.rider.phone}` : 'Driver not assigned yet',
    },
  };
}

async function getLatestOrderTrackingScreen(userId: string): Promise<any> {
  const latestOrder = await prisma.order.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  if (!latestOrder) {
    return {
      screen: 'ORDER_TRACKING',
      data: {
        order_number: 'N/A',
        restaurant_name: 'N/A',
        estimated_time: 'N/A',
        status_text: 'No orders found',
        current_status: 'No orders',
        driver_info: 'N/A',
      },
    };
  }

  return getOrderTrackingScreen(latestOrder.orderNumber);
}

async function getMyOrdersScreen(userId: string): Promise<any> {
  const orders = await prisma.order.findMany({
    where: { userId },
    include: { restaurant: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  if (orders.length === 0) {
    return {
      screen: 'MY_ORDERS',
      data: {
        orders: [],
      },
    };
  }

  return {
    screen: 'MY_ORDERS',
    data: {
      orders: orders.map((order) => ({
        id: order.orderNumber,
        title: order.orderNumber,
        description: `${order.restaurant.name} - TZS ${order.total} - ${order.status} - ${order.createdAt.toISOString().replace('T', ' ').substring(0, 16)}`,
      })),
    },
  };
}

router.post('/test', async (req, res) => {
  try {
    const { action, screen, data } = req.body;

    let response: any;

    switch (action) {
      case 'INIT':
        response = await handleInit(screen, data, 'test-token');
        break;
      case 'data_exchange':
        response = await handleDataExchange(screen, data, 'test-token');
        break;
      default:
        response = {
          screen: 'MAIN_MENU',
          data: { greeting: 'Welcome to Piki Food!', user_name: 'Guest' },
        };
    }

    res.json(response);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
