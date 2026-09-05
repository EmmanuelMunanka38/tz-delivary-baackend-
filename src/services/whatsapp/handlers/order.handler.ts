import prisma from '@/db/prisma';
import { WhatsAppSessionState } from '@/types/whatsapp.types';
import { WhatsAppConversationState } from '@prisma/client';
import { sendButtonsMessage, sendTextMessage } from '../whatsapp.service';
import { generateOrderNumber, calculateFees } from '@/services/order.service';
import { initiateUSSDPush } from '@/services/payment.service';

export async function handleProceedToCheckout(
  phoneNumber: string,
  sessionId: string,
  userId: string,
  updateState: (state: WhatsAppConversationState, data?: WhatsAppSessionState) => Promise<void>,
): Promise<void> {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: { items: true },
  }); 

  if (!cart || cart.items.length === 0) {
    await sendTextMessage(phoneNumber, 'Your cart is empty. Please add items first.');
    return;
  }

  await sendTextMessage(phoneNumber, 'Please send your delivery address (e.g., "Mikocheni, Dar es Salaam"):');

  await updateState('CHECKOUT_ADDRESS');
}

export async function handleDeliveryAddress(
  phoneNumber: string,
  sessionId: string,
  userId: string,
  address: string,
  stateData: WhatsAppSessionState,
  updateState: (state: WhatsAppConversationState, data?: WhatsAppSessionState) => Promise<void>,
): Promise<void> {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: {
      items: true,
    },
  });

  if (!cart || cart.items.length === 0 || !cart.restaurantId) {
    await sendTextMessage(phoneNumber, 'Your cart is empty. Please add items first.');
    return;
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: cart.restaurantId },
  });

  if (!restaurant) {
    await sendTextMessage(phoneNumber, 'Restaurant not found. Please start over.');
    return;
  }

  const subtotal = cart.items.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);
  const { serviceFee, total } = calculateFees(subtotal, restaurant.deliveryFee);

  let summaryText = `*Order Summary*\n\n`;
  summaryText += `*${restaurant.name}*\n\n`;

  cart.items.forEach((item: any) => {
    summaryText += `• ${item.quantity}x ${item.name}\n`;
    summaryText += `  TZS ${(item.price * item.quantity).toLocaleString()}\n\n`;
  });

  summaryText += `---\n`;
  summaryText += `Subtotal: TZS ${subtotal.toLocaleString()}\n`;
  summaryText += `Delivery: TZS ${restaurant.deliveryFee.toLocaleString()}\n`;
  summaryText += `Service Fee: TZS ${serviceFee.toLocaleString()}\n`;
  summaryText += `*Total: TZS ${total.toLocaleString()}*\n\n`;
  summaryText += `📍 Delivery to: ${address}\n\n`;
  summaryText += `Please send your phone number for payment (e.g., 255712345678):`;

  await sendTextMessage(phoneNumber, summaryText);

  await updateState('CHECKOUT_PAYMENT', {
    ...stateData,
    deliveryAddress: address,
  });
}

export async function handlePaymentPhone(
  phoneNumber: string,
  sessionId: string,
  userId: string,
  paymentPhone: string,
  stateData: WhatsAppSessionState,
  updateState: (state: WhatsAppConversationState, data?: WhatsAppSessionState) => Promise<void>,
): Promise<void> {
  const cleanPhone = paymentPhone.replace(/\s+/g, '');

  if (!/^255\d{9}$/.test(cleanPhone)) {
    await sendTextMessage(phoneNumber, 'Invalid phone number. Please use format: 255712345678');
    return;
  }

  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: { items: true },
  });

  if (!cart || cart.items.length === 0 || !cart.restaurantId) {
    await sendTextMessage(phoneNumber, 'Your cart is empty. Please add items first.');
    return;
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: cart.restaurantId },
  });

  if (!restaurant) {
    await sendTextMessage(phoneNumber, 'Restaurant not found. Please start over.');
    return;
  }

  const subtotal = cart.items.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);
  const { serviceFee, total } = calculateFees(subtotal, restaurant.deliveryFee);

  const orderNumber = generateOrderNumber();

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
      deliveryAddress: { address: stateData.deliveryAddress },
      estimatedDelivery: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  await prisma.orderItem.createMany({
    data: cart.items.map((item: any) => ({
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
      phoneNumber: cleanPhone,
      currency: 'TZS',
    });

    await prisma.transaction.create({
      data: {
        orderReference,
        orderId: order.id,
        amount: total,
        phoneNumber: cleanPhone,
        status: 'PENDING',
      },
    });

    await prisma.order.update({
      where: { id: order.id },
      data: { paymentIntentId: orderReference },
    });

    await sendTextMessage(
      phoneNumber,
      `✅ Order placed successfully!\n\nOrder Number: ${orderNumber}\nTotal: TZS ${total.toLocaleString()}\n\nYou will receive a USSD push on ${cleanPhone} to complete payment.\n\nPlease enter your mobile money PIN to confirm.`,
    );

    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });

    await updateState('ORDER_CONFIRMATION', { orderId: order.id });
  } catch (error: any) {
    console.error('Payment initiation error:', error);
    await sendTextMessage(
      phoneNumber,
      `❌ Failed to initiate payment. Please try again or contact support.\n\nOrder ${orderNumber} has been saved but payment is pending.`,
    );
  }
}

export async function handleMyOrders(
  phoneNumber: string,
  sessionId: string,
  userId: string,
  updateState: (state: WhatsAppConversationState, data?: WhatsAppSessionState) => Promise<void>,
): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: {
      restaurant: true,
    },
  });

  if (orders.length === 0) {
    await sendButtonsMessage(
      phoneNumber,
      'You have no orders yet. Would you like to browse restaurants?',
      [{ id: 'browse_restaurants', title: '🍽️ Browse Restaurants' }],
      '📦 No Orders',
    );
    await updateState('MAIN_MENU');
    return;
  }

  let ordersText = '*Your Recent Orders*\n\n';

  orders.forEach((order: any, index: number) => {
    const statusEmoji = getStatusEmoji(order.status);
    ordersText += `${index + 1}. ${statusEmoji} ${order.orderNumber}\n`;
    ordersText += `   ${order.restaurant.name}\n`;
    ordersText += `   TZS ${order.total.toLocaleString()} • ${formatStatus(order.status)}\n\n`;
  });

  await sendTextMessage(phoneNumber, ordersText);
  await updateState('MAIN_MENU');
}

function getStatusEmoji(status: string): string {
  const emojis: Record<string, string> = {
    pending: '⏳',
    restaurant_accepted: '✅',
    preparing: '👨‍🍳',
    ready_for_pickup: '📦',
    driver_assigned: '🚗',
    picked_up: '🛵',
    on_the_way: '🏍️',
    arrived: '📍',
    delivered: '✅',
    cancelled: '❌',
  };
  return emojis[status] || '📦';
}

function formatStatus(status: string): string {
  return status
    .split('_')
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
