import { WhatsAppSessionState } from '@/types/whatsapp.types';
import { WhatsAppConversationState } from '@prisma/client';
import { handleStart, handleMainMenu } from './start.handler';
import { handleBrowseRestaurants, handleRestaurantSelection } from './restaurants.handler';
import { handleMenuItemSelection, handleQuantitySelection } from './menu.handler';
import { handleViewCart, handleClearCart } from './cart.handler';
import { handleProceedToCheckout, handleDeliveryAddress, handlePaymentPhone, handleMyOrders } from './order.handler';
import { sendTextMessage } from '../whatsapp.service';

type UpdateStateFn = (state: WhatsAppConversationState, data?: WhatsAppSessionState) => Promise<void>;

export async function routeMessage(
  phoneNumber: string,
  sessionId: string,
  userId: string,
  currentState: WhatsAppConversationState,
  stateData: WhatsAppSessionState,
  messageId: string,
  messageText: string,
  updateState: UpdateStateFn,
  interactiveReplyId?: string,
): Promise<void> {
  const lowerText = messageText.toLowerCase().trim();

  if (lowerText === 'hi' || lowerText === 'hello' || lowerText === 'start' || lowerText === 'menu') {
    await handleStart(phoneNumber, sessionId, userId, updateState);
    return;
  }

  if (interactiveReplyId) {
    await handleInteractiveReply(
      phoneNumber,
      sessionId,
      userId,
      currentState,
      stateData,
      interactiveReplyId,
      updateState,
    );
    return;
  }

  await handleTextCommand(phoneNumber, sessionId, userId, currentState, stateData, messageText, updateState);
}

async function handleInteractiveReply(
  phoneNumber: string,
  sessionId: string,
  userId: string,
  currentState: WhatsAppConversationState,
  stateData: WhatsAppSessionState,
  replyId: string,
  updateState: UpdateStateFn,
): Promise<void> {
  if (replyId === 'browse_restaurants') {
    await handleBrowseRestaurants(phoneNumber, sessionId, userId, updateState);
    return;
  }

  if (replyId === 'view_cart') {
    await handleViewCart(phoneNumber, sessionId, userId, updateState);
    return;
  }

  if (replyId === 'my_orders') {
    await handleMyOrders(phoneNumber, sessionId, userId, updateState);
    return;
  }

  if (replyId === 'clear_cart') {
    await handleClearCart(phoneNumber, sessionId, userId, updateState);
    return;
  }

  if (replyId === 'proceed_checkout') {
    await handleProceedToCheckout(phoneNumber, sessionId, userId, updateState);
    return;
  }

  if (replyId === 'continue_browsing') {
    await handleBrowseRestaurants(phoneNumber, sessionId, userId, updateState);
    return;
  }

  if (replyId.startsWith('restaurant_')) {
    const restaurantId = replyId.replace('restaurant_', '');
    await handleRestaurantSelection(phoneNumber, sessionId, userId, restaurantId, updateState);
    return;
  }

  if (replyId.startsWith('menu_')) {
    const menuItemId = replyId.replace('menu_', '');
    await handleMenuItemSelection(phoneNumber, sessionId, userId, menuItemId, updateState);
    return;
  }

  if (replyId.startsWith('qty_')) {
    const parts = replyId.split('_');
    const quantity = parseInt(parts[1]);
    const menuItemId = parts[2];
    await handleQuantitySelection(phoneNumber, sessionId, userId, quantity, menuItemId, stateData, updateState);
    return;
  }

  await sendTextMessage(phoneNumber, 'Sorry, I did not understand that. Please try again.');
}

async function handleTextCommand(
  phoneNumber: string,
  sessionId: string,
  userId: string,
  currentState: WhatsAppConversationState,
  stateData: WhatsAppSessionState,
  text: string,
  updateState: UpdateStateFn,
): Promise<void> {
  if (currentState === 'CHECKOUT_ADDRESS') {
    await handleDeliveryAddress(phoneNumber, sessionId, userId, text, stateData, updateState);
    return;
  }

  if (currentState === 'CHECKOUT_PAYMENT') {
    await handlePaymentPhone(phoneNumber, sessionId, userId, text, stateData, updateState);
    return;
  }

  await handleMainMenu(phoneNumber, sessionId, userId, updateState);
}
