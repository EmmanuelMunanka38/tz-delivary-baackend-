import axios from 'axios';
import config from '@/config';
import { WhatsAppSendMessage, WhatsAppInteractiveMessage, WhatsAppTemplateMessage } from '@/types/whatsapp.types';

const WHATSAPP_API_URL = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;

export async function sendWhatsAppMessage(message: WhatsAppSendMessage): Promise<any> {
  try {
    const response = await axios.post(WHATSAPP_API_URL, message, {
      headers: {
        Authorization: `Bearer ${config.whatsapp.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  } catch (error: any) {
    console.error('WhatsApp API error:', error.response?.data || error.message);
    throw error;
  }
}

export async function sendTextMessage(to: string, text: string): Promise<any> {
  return sendWhatsAppMessage({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  });
}

export async function sendInteractiveMessage(to: string, interactive: WhatsAppInteractiveMessage): Promise<any> {
  return sendWhatsAppMessage({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  });
}

export async function sendButtonsMessage(
  to: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>,
  headerText?: string,
  footerText?: string,
): Promise<any> {
  const interactive: WhatsAppInteractiveMessage = {
    type: 'button',
    body: { text: bodyText },
    action: {
      buttons: buttons.map((btn) => ({
        type: 'reply',
        reply: { id: btn.id, title: btn.title },
      })),
    },
  };

  if (headerText) {
    interactive.header = { type: 'text', text: headerText };
  }
  if (footerText) {
    interactive.footer = { text: footerText };
  }

  return sendInteractiveMessage(to, interactive);
}

export async function sendListMessage(
  to: string,
  bodyText: string,
  buttonText: string,
  sections: Array<{
    title: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>,
  headerText?: string,
  footerText?: string,
): Promise<any> {
  const interactive: WhatsAppInteractiveMessage = {
    type: 'list',
    body: { text: bodyText },
    action: {
      button: buttonText,
      sections,
    },
  };

  if (headerText) {
    interactive.header = { type: 'text', text: headerText };
  }
  if (footerText) {
    interactive.footer = { text: footerText };
  }

  return sendInteractiveMessage(to, interactive);
}

export async function sendTemplateMessage(to: string, template: WhatsAppTemplateMessage): Promise<any> {
  return sendWhatsAppMessage({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template,
  });
}

export async function sendImageMessage(to: string, imageUrl: string, caption?: string): Promise<any> {
  return sendWhatsAppMessage({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'image',
    image: { link: imageUrl, caption },
  });
}

export async function markMessageAsRead(messageId: string): Promise<void> {
  try {
    await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      },
      {
        headers: {
          Authorization: `Bearer ${config.whatsapp.accessToken}`,
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (error: any) {
    console.error('Failed to mark message as read:', error.response?.data || error.message);
  }
}
