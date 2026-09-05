export interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppEntry[];
}

export interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[];
}

export interface WhatsAppChange {
  value: WhatsAppChangeValue;
  field: string;
}

export interface WhatsAppChangeValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppStatus[];
}

export interface WhatsAppContact {
  profile: {
    name: string;
  };
  wa_id: string;
}

export interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'interactive' | 'button' | 'location' | 'image' | 'audio' | 'video' | 'document';
  text?: {
    body: string;
  };
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: {
      id: string;
      title: string;
    };
    list_reply?: {
      id: string;
      title: string;
      description?: string;
    };
  };
  button?: {
    text: string;
    payload: string;
  };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
}

export interface WhatsAppStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  conversation?: {
    id: string;
    origin: {
      type: string;
    };
  };
  pricing?: {
    billable: boolean;
    pricing_model: string;
    category: string;
  };
  errors?: Array<{
    code: number;
    title: string;
  }>;
}

export interface WhatsAppSendMessage {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'text' | 'interactive' | 'template' | 'image' | 'location';
  text?: {
    body: string;
    preview_url?: boolean;
  };
  interactive?: WhatsAppInteractiveMessage;
  template?: WhatsAppTemplateMessage;
  image?: {
    link: string;
    caption?: string;
  };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
}

export interface WhatsAppInteractiveMessage {
  type: 'button' | 'list';
  header?: {
    type: 'text';
    text: string;
  };
  body: {
    text: string;
  };
  footer?: {
    text: string;
  };
  action: {
    buttons?: Array<{
      type: 'reply';
      reply: {
        id: string;
        title: string;
      };
    }>;
    button?: string;
    sections?: Array<{
      title: string;
      rows: Array<{
        id: string;
        title: string;
        description?: string;
      }>;
    }>;
  };
}

export interface WhatsAppTemplateMessage {
  name: string;
  language: {
    code: string;
  };
  components?: Array<{
    type: 'header' | 'body' | 'button';
    parameters?: Array<{
      type: 'text' | 'currency' | 'date_time';
      text?: string;
      currency?: {
        fallback_value: string;
        code: string;
        amount_1000: number;
      };
      date_time?: {
        fallback_value: string;
      };
    }>;
  }>;
}

export interface WhatsAppSessionState {
  restaurantId?: string;
  menuItemId?: string;
  quantity?: number;
  deliveryAddress?: string;
  paymentPhone?: string;
  orderId?: string;
  reservationData?: {
    restaurantId?: string;
    date?: string;
    time?: string;
    guests?: number;
  };
}


