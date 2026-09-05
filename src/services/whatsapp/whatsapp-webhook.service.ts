import crypto from 'crypto';
import config from '@/config';
import { WhatsAppWebhookPayload, WhatsAppMessage, WhatsAppStatus } from '@/types/whatsapp.types';
import { getOrCreateSession, updateSessionState, logMessage, updateMessageStatus } from './whatsapp-session.service';
import { markMessageAsRead } from './whatsapp.service';
import { routeMessage } from './handlers';

export function verifyWebhookSignature(payload: string, signature: string): boolean {
  if (!config.whatsapp.webhookSecret) {
    console.warn('WhatsApp webhook secret not configured');
    return true;
  }

  const expectedSignature = crypto.createHmac('sha256', config.whatsapp.webhookSecret).update(payload).digest('hex');

  const expectedWithPrefix = `sha256=${expectedSignature}`;

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedWithPrefix));
}

export async function processWebhook(payload: WhatsAppWebhookPayload): Promise<void> {
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field === 'messages') {
        await processMessagesChange(change.value);
      }
    }
  }
}

async function processMessagesChange(value: any): Promise<void> {
  if (value.messages) {
    for (const message of value.messages) {
      await processIncomingMessage(message, value.contacts);
    }
  }

  if (value.statuses) {
    for (const status of value.statuses) {
      await processMessageStatus(status);
    }
  }
}

async function processIncomingMessage(message: WhatsAppMessage, contacts: any[]): Promise<void> {
  try {
    const phoneNumber = message.from;
    const contact = contacts?.find((c: any) => c.wa_id === phoneNumber);
    const userName = contact?.profile?.name;

    const session = await getOrCreateSession(phoneNumber, userName);

    await logMessage(session.sessionId, message.id, 'incoming', message.type, message);

    await markMessageAsRead(message.id);

    let messageText = '';
    let interactiveReplyId: string | undefined;

    if (message.type === 'text' && message.text) {
      messageText = message.text.body;
    } else if (message.type === 'interactive' && message.interactive) {
      if (message.interactive.type === 'button_reply' && message.interactive.button_reply) {
        interactiveReplyId = message.interactive.button_reply.id;
        messageText = message.interactive.button_reply.title;
      } else if (message.interactive.type === 'list_reply' && message.interactive.list_reply) {
        interactiveReplyId = message.interactive.list_reply.id;
        messageText = message.interactive.list_reply.title;
      }
    } else if (message.type === 'button' && message.button) {
      interactiveReplyId = message.button.payload;
      messageText = message.button.text;
    }

    const updateState = async (state: any, data?: any) => {
      await updateSessionState(session.sessionId, state, data);
    };

    await routeMessage(
      phoneNumber,
      session.sessionId,
      session.userId,
      session.state,
      session.stateData,
      message.id,
      messageText,
      updateState,
      interactiveReplyId,
    );
  } catch (error) {
    console.error('Error processing incoming WhatsApp message:', error);
  }
}

async function processMessageStatus(status: WhatsAppStatus): Promise<void> {
  try {
    await updateMessageStatus(status.id, status.status);

    if (status.status === 'failed' && status.errors) {
      console.error('WhatsApp message failed:', status.errors);
    }
  } catch (error) {
    console.error('Error processing message status:', error);
  }
}
