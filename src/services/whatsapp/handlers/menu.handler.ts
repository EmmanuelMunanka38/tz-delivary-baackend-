import prisma from '@/db/prisma';
import { WhatsAppSessionState } from '@/types/whatsapp.types';
import { WhatsAppConversationState } from '@prisma/client';
import { sendButtonsMessage, sendTextMessage } from '../whatsapp.service';

export async function handleMenuItemSelection(
  phoneNumber: string,
  sessionId: string,
  userId: string,
  menuItemId: string,
  updateState: (state: WhatsAppConversationState, data?: WhatsAppSessionState) => Promise<void>,
): Promise<void> {
  const menuItem = await prisma.menuItem.findUnique({
    where: { id: menuItemId },
  });

  if (!menuItem || !menuItem.isAvailable) {
    await sendTextMessage(phoneNumber, 'This item is no longer available. Please select another item.');
    return;
  }

  await sendButtonsMessage(
    phoneNumber,
    `*${menuItem.name}*\n\n${menuItem.description}\n\nPrice: TZS ${menuItem.price.toLocaleString()}\n\nHow many would you like to add?`,
    [
      { id: `qty_1_${menuItemId}`, title: '1' },
      { id: `qty_2_${menuItemId}`, title: '2' },
      { id: `qty_3_${menuItemId}`, title: '3' },
    ],
    '🍽️ Add to Cart',
    'Select quantity',
  );

  await updateState('VIEW_MENU', { menuItemId });
}

export async function handleQuantitySelection(
  phoneNumber: string,
  sessionId: string,
  userId: string,
  quantity: number,
  menuItemId: string,
  stateData: WhatsAppSessionState,
  updateState: (state: WhatsAppConversationState, data?: WhatsAppSessionState) => Promise<void>,
): Promise<void> {
  const menuItem = await prisma.menuItem.findUnique({
    where: { id: menuItemId },
  });

  if (!menuItem) {
    await sendTextMessage(phoneNumber, 'Item not found. Please try again.');
    return;
  }

  let cart = await prisma.cart.findUnique({
    where: { userId },
    include: { items: true },
  });

  if (!cart) {
    cart = await prisma.cart.create({
      data: {
        userId,
        restaurantId: menuItem.restaurantId,
      },
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

    if (!cart) {
      await sendTextMessage(phoneNumber, 'Error updating cart. Please try again.');
      return;
    }
  }

  const existingItem = cart.items.find((item) => item.menuItemId === menuItemId);

  if (existingItem) {
    await prisma.cartItem.update({
      where: { id: existingItem.id },
      data: { quantity: existingItem.quantity + quantity },
    });
  } else {
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        menuItemId,
        quantity,
        price: menuItem.price,
        name: menuItem.name,
      },
    });
  }

  await sendButtonsMessage(
    phoneNumber,
    `✅ Added ${quantity}x ${menuItem.name} to your cart!\n\nWhat would you like to do next?`,
    [
      { id: 'view_cart', title: '🛒 View Cart' },
      { id: 'continue_browsing', title: '🍽️ Continue Browsing' },
    ],
    'Added to Cart',
  );

  await updateState('VIEW_MENU', { restaurantId: stateData.restaurantId });
}
