import prisma from '@/db/prisma';
import { WhatsAppSessionState } from '@/types/whatsapp.types';
import { WhatsAppConversationState } from '@prisma/client';
import { sendButtonsMessage, sendTextMessage } from '../whatsapp.service';

export async function handleViewCart(
  phoneNumber: string,
  sessionId: string,
  userId: string,
  updateState: (state: WhatsAppConversationState, data?: WhatsAppSessionState) => Promise<void>,
): Promise<void> { 
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: { 
      items: true,
    },
  });

  if (!cart || cart.items.length === 0) {
    await sendButtonsMessage(
      phoneNumber,
      'Your cart is empty. Would you like to browse restaurants?',
      [{ id: 'browse_restaurants', title: '🍽️ Browse Restaurants' }],
      '🛒 Empty Cart',
    );
    await updateState('MAIN_MENU');
    return;
  }

  const restaurant = cart.restaurantId
    ? await prisma.restaurant.findUnique({ where: { id: cart.restaurantId } })
    : null;

  const subtotal = cart.items.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);
  const deliveryFee = restaurant?.deliveryFee || 0;
  const serviceFee = Math.round(subtotal * 0.03);
  const total = subtotal + deliveryFee + serviceFee;

  let cartText = `*Your Cart*\n\n`;
  cartText += `*${restaurant?.name || 'Restaurant'}*\n\n`;

  cart.items.forEach((item: any) => {
    cartText += `• ${item.quantity}x ${item.name}\n`;
    cartText += `  TZS ${(item.price * item.quantity).toLocaleString()}\n\n`;
  });

  cartText += `---\n`;
  cartText += `Subtotal: TZS ${subtotal.toLocaleString()}\n`;
  cartText += `Delivery: TZS ${deliveryFee.toLocaleString()}\n`; 
  cartText += `Service Fee: TZS ${serviceFee.toLocaleString()}\n`;
  cartText += `*Total: TZS ${total.toLocaleString()}*\n`;

  await sendButtonsMessage(
    phoneNumber,
    cartText,
    [
      { id: 'proceed_checkout', title: '✅ Checkout' },
      { id: 'clear_cart', title: '🗑️ Clear Cart' },
      { id: 'browse_restaurants', title: '🍽️ Add More' },
    ],
    '🛒 Your Cart',
    'What would you like to do?',
  );

  await updateState('VIEW_CART');
}

export async function handleClearCart(
  phoneNumber: string,
  sessionId: string,
  userId: string,
  updateState: (state: WhatsAppConversationState, data?: WhatsAppSessionState) => Promise<void>,
): Promise<void> {
  const cart = await prisma.cart.findUnique({
    where: { userId },
  });

  if (cart) {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  }

  await sendButtonsMessage(
    phoneNumber,
    'Cart cleared. Would you like to browse restaurants?',
    [{ id: 'browse_restaurants', title: '🍽️ Browse Restaurants' }],
    '🗑️ Cart Cleared',
  );

  await updateState('MAIN_MENU');
}

