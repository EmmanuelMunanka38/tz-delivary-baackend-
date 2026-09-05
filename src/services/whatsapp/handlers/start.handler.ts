import { WhatsAppSessionState } from '@/types/whatsapp.types';
import { WhatsAppConversationState } from '@prisma/client';
import { sendButtonsMessage, sendTextMessage } from '../whatsapp.service';

export async function handleStart(
  phoneNumber: string,
  sessionId: string,
  userId: string,
  updateState: (state: WhatsAppConversationState, data?: WhatsAppSessionState) => Promise<void>,
): Promise<void> {
  await sendButtonsMessage(
    phoneNumber,
    'Welcome to Piki Food! 🍽️\n\nWhat would you like to do?',
    [
      { id: 'browse_restaurants', title: '🍽️ Browse Restaurants' },
      { id: 'view_cart', title: '🛒 View Cart' },
      { id: 'my_orders', title: '📦 My Orders' },
    ],
    'Piki Food',
    'Order food easily via WhatsApp',
  );

  await updateState('MAIN_MENU');
}

export async function handleMainMenu(
  phoneNumber: string,
  sessionId: string,
  userId: string,
  updateState: (state: WhatsAppConversationState, data?: WhatsAppSessionState) => Promise<void>,
): Promise<void> {
  await sendButtonsMessage(
    phoneNumber,
    'What would you like to do?',
    [
      { id: 'browse_restaurants', title: '🍽️ Browse Restaurants' },
      { id: 'view_cart', title: '🛒 View Cart' },
      { id: 'my_orders', title: '📦 My Orders' },
    ],
    'Main Menu',
  );

  await updateState('MAIN_MENU');
}
