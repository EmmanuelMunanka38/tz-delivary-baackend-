import prisma from '@/db/prisma';
import { WhatsAppSessionState } from '@/types/whatsapp.types';
import { WhatsAppConversationState } from '@prisma/client';
import { sendListMessage, sendButtonsMessage, sendTextMessage } from '../whatsapp.service';

export async function handleBrowseRestaurants(
  phoneNumber: string,
  sessionId: string,
  userId: string,
  updateState: (state: WhatsAppConversationState, data?: WhatsAppSessionState) => Promise<void>,
): Promise<void> {
  const restaurants = await prisma.restaurant.findMany({
    where: {
      isOpen: true,
      isApproved: true,
    },
    take: 10,
    orderBy: { rating: 'desc' },
    select: {
      id: true,
      name: true,
      cuisine: true,
      rating: true,
      deliveryFee: true,
      deliveryTime: true,
    },
  });

  if (restaurants.length === 0) {
    await sendTextMessage(phoneNumber, 'Sorry, no restaurants are currently open. Please try again later.');
    return;
  }

  const sections = [
    {
      title: 'Available Restaurants',
      rows: restaurants.map((r) => ({
        id: `restaurant_${r.id}`,
        title: r.name.substring(0, 24),
        description: `${r.cuisine} • ⭐${r.rating.toFixed(1)} • ${r.deliveryTime}`,
      })),
    },
  ];

  await sendListMessage(
    phoneNumber,
    'Choose a restaurant to view their menu:',
    'View Restaurants',
    sections,
    '🍽️ Restaurants',
    'Tap the button to browse',
  );

  await updateState('BROWSE_RESTAURANTS');
}

export async function handleRestaurantSelection(
  phoneNumber: string,
  sessionId: string,
  userId: string,
  restaurantId: string,
  updateState: (state: WhatsAppConversationState, data?: WhatsAppSessionState) => Promise<void>,
): Promise<void> {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
  });

  if (!restaurant) {
    await sendTextMessage(phoneNumber, 'Restaurant not found. Please try again.');
    return;
  }

  const menuItems = await prisma.menuItem.findMany({
    where: {
      restaurantId,
      isAvailable: true,
    },
  });

  if (menuItems.length === 0) {
    await sendTextMessage(phoneNumber, 'This restaurant has no available menu items right now.');
    return;
  }

  const categoryMap = new Map<string, any[]>();
  menuItems.forEach((item) => {
    const catName = item.category;
    if (!categoryMap.has(catName)) {
      categoryMap.set(catName, []);
    }
    categoryMap.get(catName)!.push(item);
  });

  const sections = Array.from(categoryMap.entries()).map(([categoryName, items]) => ({
    title: categoryName.substring(0, 24),
    rows: items.slice(0, 10).map((item) => ({
      id: `menu_${item.id}`,
      title: item.name.substring(0, 24),
      description: `TZS ${item.price.toLocaleString()}`,
    })),
  }));

  await sendListMessage(
    phoneNumber,
    `*${restaurant.name}*\n${restaurant.cuisine} cuisine\n\nSelect an item to add to cart:`,
    'View Menu',
    sections,
    '📋 Menu',
    `Delivery: TZS ${restaurant.deliveryFee.toLocaleString()} • ${restaurant.deliveryTime}`,
  );

  await updateState('VIEW_MENU', { restaurantId });
}
