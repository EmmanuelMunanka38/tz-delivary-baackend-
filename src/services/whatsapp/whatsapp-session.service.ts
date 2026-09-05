import prisma from '@/db/prisma';
import { WhatsAppSessionState } from '@/types/whatsapp.types';
import { WhatsAppConversationState } from '@prisma/client';

export async function getOrCreateSession(
  phoneNumber: string,
  userName?: string,
): Promise<{ sessionId: string; userId: string; state: WhatsAppConversationState; stateData: WhatsAppSessionState }> {
  let session = await prisma.whatsAppSession.findUnique({
    where: { phoneNumber },
    include: { user: true },
  });

  if (!session) {
    let user = await prisma.user.findUnique({
      where: { whatsappPhoneNumber: phoneNumber },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          whatsappPhoneNumber: phoneNumber,
          phone: phoneNumber,
          name: userName || '',
          role: 'customer',
          whatsappOptIn: true,
        },
      });
      console.log(`[WhatsApp] Auto-registered user ${user.id} for phone ${phoneNumber}`);
    } else if (!user.whatsappOptIn) {
      await prisma.user.update({
        where: { id: user.id },
        data: { whatsappOptIn: true },
      });
    }

    session = await prisma.whatsAppSession.create({
      data: {
        userId: user.id,
        phoneNumber,
        conversationState: 'MAIN_MENU',
        stateData: {},
      },
      include: { user: true },
    });
  } else {
    session = await prisma.whatsAppSession.update({
      where: { id: session.id },
      data: { lastMessageAt: new Date() },
      include: { user: true },
    });
  }

  return {
    sessionId: session.id,
    userId: session.userId,
    state: session.conversationState,
    stateData: (session.stateData ?? {}) as WhatsAppSessionState,
  };
}

export async function updateSessionState(
  sessionId: string,
  state: WhatsAppConversationState,
  data?: WhatsAppSessionState,
): Promise<void> {
  await prisma.whatsAppSession.update({
    where: { id: sessionId },
    data: {
      conversationState: state,
      stateData: data ? (data as any) : {},
      lastMessageAt: new Date(),
    },
  });
}

export async function clearSession(sessionId: string): Promise<void> {
  await prisma.whatsAppSession.update({
    where: { id: sessionId },
    data: {
      conversationState: 'MAIN_MENU',
      stateData: {},
      lastMessageAt: new Date(),
    },
  });
}

export async function logMessage(
  sessionId: string,
  whatsappMessageId: string,
  direction: 'incoming' | 'outgoing',
  messageType: string,
  content: any,
): Promise<void> {
  try {
    await prisma.whatsAppMessage.create({
      data: {
        sessionId,
        whatsappMessageId,
        direction,
        messageType,
        content,
      },
    });
  } catch (error) {
    console.error('Failed to log WhatsApp message:', error);
  }
}

export async function updateMessageStatus(whatsappMessageId: string, status: string): Promise<void> {
  try {
    await prisma.whatsAppMessage.update({
      where: { whatsappMessageId },
      data: { status, statusTimestamp: new Date() },
    });
  } catch (error) {
    console.error('Failed to update message status:', error);
  }
}
