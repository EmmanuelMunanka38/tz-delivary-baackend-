import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import config from '../config';

const CONTACT_RECIPIENT = config.email.from || 'noreply@pikifood.co.tz';

// Hardcoded verified sender — must match the domain verified on Resend.
// Prevents misconfigured EMAIL_FROM env vars from causing 403 errors.
const RESEND_FROM = 'Piki Food <noreply@pikifood.co.tz>';

let resendClient: Resend | null = null;
const getResend = (): Resend => {
  if (!resendClient) {
    resendClient = new Resend(config.email.resendApiKey);
  }
  return resendClient;
};

// ─── Transport ───────────────────────────────────────────────────────────────

async function sendViaResend(to: string, subject: string, html: string, replyTo?: string): Promise<void> {
  const { data, error } = await getResend().emails.send({
    from: RESEND_FROM,
    to,
    subject,
    html,
    ...(replyTo ? { replyTo } : {}),
  });
  if (error) {
    throw new Error(`Resend API error: ${error.message}`);
  }
  console.log(`[EMAIL] Sent to ${to} via Resend (id: ${data?.id})`);
}

async function createSmtpTransporter() {
  if (config.email.mode === 'self-hosted') {
    return nodemailer.createTransport({
      host: 'localhost',
      port: config.email.selfHostedPort,
      ignoreTLS: true,
    });
  }

  if (config.email.user && config.email.pass) {
    return nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465,
      auth: { user: config.email.user, pass: config.email.pass },
    });
  }

  if (config.nodeEnv === 'production') {
    throw new Error('RESEND_API_KEY or EMAIL_USER/EMAIL_PASS must be configured in production');
  }

  const testAccount = await nodemailer.createTestAccount();
  console.log(`[EMAIL] Dev mode: using Ethereal test account: ${testAccount.user}`);
  return nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: { user: testAccount.user, pass: testAccount.pass },
  });
}

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  replyTo?: string,
): Promise<void> {
  if (config.email.mode === 'resend' && config.email.resendApiKey) {
    try {
      await sendViaResend(to, subject, html, replyTo);
      return;
    } catch (err: any) {
      console.error('[EMAIL] Resend send failed:', err.message);
      const canFallback = config.isDev || Boolean(config.email.user && config.email.pass);
      if (canFallback) {
        console.warn('[EMAIL] Falling back to SMTP transport');
      } else {
        throw err;
      }
    }
  }

  const transporter = await createSmtpTransporter();
  const info = await transporter.sendMail({
    from: `"Piki Food" <${config.email.from}>`,
    to,
    subject,
    html,
    ...(replyTo ? { replyTo } : {}),
  });
  console.log(`[EMAIL] Sent to ${to} via SMTP (messageId: ${info.messageId})`);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export type ContactPayload = {
  name: string;
  email: string;
  subject: string;
  message: string;
};

export const sendOtpEmail = async (to: string, otp: string): Promise<void> => {
  await sendEmail(to, 'Your Piki Food verification code', buildOtpHtml(otp));
};

export const sendContactEmail = async (payload: ContactPayload): Promise<void> => {
  await sendEmail(
    CONTACT_RECIPIENT,
    `[Contact] ${payload.subject}`,
    buildContactHtml(payload),
    payload.email,
  );
};

export type OrderConfirmationData = {
  to: string;
  customerName: string;
  orderNumber: string;
  restaurantName: string;
  items: Array<{ name: string; quantity: number; price: number }>;
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  total: number;
  paymentMethod: string;
  estimatedDelivery: Date;
};

export const sendOrderConfirmationEmail = async (data: OrderConfirmationData): Promise<void> => {
  await sendEmail(data.to, `Order #${data.orderNumber} confirmed — Piki Food`, buildOrderConfirmationHtml(data));
};

export type SubscriptionConfirmationData = {
  to: string;
  customerName: string;
  planName: string;
  amount: number;
  billingInterval: string;
  subscriptionRef: string;
  currentPeriodEnd: Date;
};

export const sendSubscriptionConfirmationEmail = async (data: SubscriptionConfirmationData): Promise<void> => {
  await sendEmail(data.to, `Subscription activated — ${data.planName}`, buildSubscriptionConfirmationHtml(data));
};

export type OrderCancellationData = {
  to: string;
  customerName: string;
  orderNumber: string;
  restaurantName: string;
  total: number;
  cancelledBy: 'customer' | 'restaurant' | 'system';
};

export const sendOrderCancellationEmail = async (data: OrderCancellationData): Promise<void> => {
  await sendEmail(data.to, `Order #${data.orderNumber} cancelled — Piki Food`, buildOrderCancellationHtml(data));
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTzs(amount: number): string {
  return `TZS ${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatPaymentMethod(method: string): string {
  const map: Record<string, string> = {
    mpesa: 'M-Pesa',
    tigo_pesa: 'Tigo Pesa',
    airtel_money: 'Airtel Money',
    mixx_by_yas: 'Mixx by Yas',
    halopesa: 'HaloPesa',
    card: 'Card',
    cash: 'Cash on Delivery',
  };
  return map[method] || method;
}

const BRAND = {
  green: '#006d36',
  greenLight: '#16A34A',
  border: '#e2e2e2',
  bg: '#f9fafb',
  text: '#333333',
  muted: '#777777',
  light: '#999999',
};

function emailShell(content: string): string {
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 40px 20px; background-color: #ffffff;">
  <div style="margin-bottom: 40px; padding-bottom: 20px; border-bottom: 1px solid ${BRAND.border};">
    <span style="font-size: 24px; font-weight: 700; color: ${BRAND.green}; letter-spacing: -0.5px;">Piki Food</span>
  </div>
  ${content}
  <hr style="border: none; border-top: 1px solid ${BRAND.border}; margin: 0 0 24px 0;" />
  <div style="font-size: 12px; line-height: 18px; color: ${BRAND.light};">
    <p style="margin: 0 0 12px 0;">This is an automated notification from Piki Food.</p>
    <p style="margin: 0;">&copy; ${new Date().getFullYear()} Piki Food Inc. All rights reserved.</p>
  </div>
</div>`;
}

// ─── Templates ───────────────────────────────────────────────────────────────

function buildOtpHtml(otp: string): string {
  return emailShell(`
  <h1 style="font-size: 24px; font-weight: 500; color: #000000; margin: 0 0 24px 0; line-height: 1.2; letter-spacing: -0.3px;">
    Here is your verification code
  </h1>
  <p style="font-size: 16px; line-height: 24px; color: ${BRAND.text}; margin: 0 0 32px 0;">
    Use the following 4-digit verification code to complete your request. This security code is strictly private and expires in 5 minutes.
  </p>
  <div style="background-color: #f3f3f3; padding: 24px; border-left: 4px solid ${BRAND.green}; margin: 0 0 32px 0;">
    <div style="font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px; color: #555555; margin-bottom: 8px;">
      Verification Code
    </div>
    <div style="font-size: 38px; font-weight: 700; color: #000000; letter-spacing: 4px; line-height: 1;">
      ${otp}
    </div>
  </div>
  <p style="font-size: 14px; line-height: 20px; color: ${BRAND.muted}; margin: 0 0 40px 0;">
    If you did not initiate this request, someone else may have typed your information by mistake. You can safely ignore this communication.
  </p>`);
}

function buildContactHtml({ name, email, subject, message }: ContactPayload): string {
  return emailShell(`
  <h1 style="font-size: 22px; font-weight: 700; color: #000000; margin: 0 0 24px 0; line-height: 1.2;">
    New contact message
  </h1>
  <div style="background-color: ${BRAND.bg}; border-left: 4px solid ${BRAND.greenLight}; padding: 20px 24px; margin: 0 0 28px 0;">
    <p style="margin: 0 0 6px 0; font-size: 14px; color: #555555;"><strong>Name:</strong> ${escapeHtml(name)}</p>
    <p style="margin: 0 0 6px 0; font-size: 14px; color: #555555;"><strong>Email:</strong> ${escapeHtml(email)}</p>
    <p style="margin: 0; font-size: 14px; color: #555555;"><strong>Subject:</strong> ${escapeHtml(subject)}</p>
  </div>
  <p style="font-size: 16px; line-height: 24px; color: ${BRAND.text}; margin: 0 0 32px 0; white-space: pre-wrap;">${escapeHtml(message)}</p>
  <p style="font-size: 12px; line-height: 18px; color: ${BRAND.light}; margin: 0;">Sent from the Piki Food contact page.</p>`);
}

function buildOrderConfirmationHtml(data: OrderConfirmationData): string {
  const itemRows = data.items
    .map(
      (item) => `
    <tr>
      <td style="padding: 8px 0; font-size: 14px; color: ${BRAND.text};">${escapeHtml(item.name)} &times; ${item.quantity}</td>
      <td style="padding: 8px 0; font-size: 14px; color: ${BRAND.text}; text-align: right;">${formatTzs(item.price * item.quantity)}</td>
    </tr>`,
    )
    .join('');

  const eta = data.estimatedDelivery.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return emailShell(`
  <h1 style="font-size: 24px; font-weight: 500; color: #000000; margin: 0 0 8px 0; line-height: 1.2;">
    Order confirmed!
  </h1>
  <p style="font-size: 16px; line-height: 24px; color: ${BRAND.text}; margin: 0 0 32px 0;">
    Hi ${escapeHtml(data.customerName)}, your order has been placed successfully.
  </p>

  <div style="background-color: #f3f3f3; padding: 24px; border-left: 4px solid ${BRAND.green}; margin: 0 0 28px 0;">
    <div style="font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px; color: #555555; margin-bottom: 8px;">
      Order Number
    </div>
    <div style="font-size: 28px; font-weight: 700; color: #000000; letter-spacing: 1px; line-height: 1;">
      ${escapeHtml(data.orderNumber)}
    </div>
  </div>

  <div style="background-color: ${BRAND.bg}; padding: 20px 24px; margin: 0 0 28px 0;">
    <p style="margin: 0 0 6px 0; font-size: 14px; color: #555555;"><strong>Restaurant:</strong> ${escapeHtml(data.restaurantName)}</p>
    <p style="margin: 0 0 6px 0; font-size: 14px; color: #555555;"><strong>Payment:</strong> ${formatPaymentMethod(data.paymentMethod)}</p>
    <p style="margin: 0; font-size: 14px; color: #555555;"><strong>Estimated delivery:</strong> ${eta}</p>
  </div>

  <table style="width: 100%; border-collapse: collapse; margin: 0 0 16px 0;">
    ${itemRows}
  </table>

  <div style="border-top: 1px solid ${BRAND.border}; padding-top: 12px; margin: 0 0 32px 0;">
    <div style="display: flex; justify-content: space-between; font-size: 14px; color: ${BRAND.muted}; margin-bottom: 4px;">
      <span>Subtotal</span><span>${formatTzs(data.subtotal)}</span>
    </div>
    <div style="display: flex; justify-content: space-between; font-size: 14px; color: ${BRAND.muted}; margin-bottom: 4px;">
      <span>Delivery fee</span><span>${formatTzs(data.deliveryFee)}</span>
    </div>
    <div style="display: flex; justify-content: space-between; font-size: 14px; color: ${BRAND.muted}; margin-bottom: 8px;">
      <span>Service fee</span><span>${formatTzs(data.serviceFee)}</span>
    </div>
    <div style="display: flex; justify-content: space-between; font-size: 18px; font-weight: 700; color: #000000; padding-top: 8px; border-top: 1px solid ${BRAND.border};">
      <span>Total</span><span>${formatTzs(data.total)}</span>
    </div>
  </div>

  <p style="font-size: 14px; line-height: 20px; color: ${BRAND.muted}; margin: 0 0 0 0;">
    You can track your order status in the app. We&apos;ll notify you as it progresses.
  </p>`);
}

function buildSubscriptionConfirmationHtml(data: SubscriptionConfirmationData): string {
  const periodEnd = data.currentPeriodEnd.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const intervalLabel = data.billingInterval === 'year' ? 'yearly' : 'monthly';

  return emailShell(`
  <h1 style="font-size: 24px; font-weight: 500; color: #000000; margin: 0 0 8px 0; line-height: 1.2;">
    Subscription activated
  </h1>
  <p style="font-size: 16px; line-height: 24px; color: ${BRAND.text}; margin: 0 0 32px 0;">
    Hi ${escapeHtml(data.customerName)}, your subscription is now active. Welcome to Piki Food for restaurants!
  </p>

  <div style="background-color: #f3f3f3; padding: 24px; border-left: 4px solid ${BRAND.green}; margin: 0 0 28px 0;">
    <div style="font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px; color: #555555; margin-bottom: 8px;">
      Plan
    </div>
    <div style="font-size: 28px; font-weight: 700; color: #000000; letter-spacing: 0.5px; line-height: 1;">
      ${escapeHtml(data.planName)}
    </div>
  </div>

  <div style="background-color: ${BRAND.bg}; padding: 20px 24px; margin: 0 0 32px 0;">
    <p style="margin: 0 0 6px 0; font-size: 14px; color: #555555;"><strong>Amount:</strong> ${formatTzs(data.amount)} / ${intervalLabel}</p>
    <p style="margin: 0 0 6px 0; font-size: 14px; color: #555555;"><strong>Reference:</strong> ${escapeHtml(data.subscriptionRef)}</p>
    <p style="margin: 0; font-size: 14px; color: #555555;"><strong>Renews on:</strong> ${periodEnd}</p>
  </div>

  <p style="font-size: 14px; line-height: 20px; color: ${BRAND.muted}; margin: 0 0 0 0;">
    You now have access to all plan features. If you have any questions, reach out through the contact page in your dashboard.
  </p>`);
}

function buildOrderCancellationHtml(data: OrderCancellationData): string {
  const reasonMap: Record<string, string> = {
    customer: 'You cancelled this order.',
    restaurant: 'The restaurant cancelled this order.',
    system: 'This order was cancelled due to a system issue.',
  };
  const reason = reasonMap[data.cancelledBy] || reasonMap.system;

  return emailShell(`
  <h1 style="font-size: 24px; font-weight: 500; color: #000000; margin: 0 0 8px 0; line-height: 1.2;">
    Order cancelled
  </h1>
  <p style="font-size: 16px; line-height: 24px; color: ${BRAND.text}; margin: 0 0 32px 0;">
    Hi ${escapeHtml(data.customerName)}, your order from ${escapeHtml(data.restaurantName)} has been cancelled.
  </p>

  <div style="background-color: #fff3f3; padding: 24px; border-left: 4px solid #dc2626; margin: 0 0 28px 0;">
    <div style="font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px; color: #555555; margin-bottom: 8px;">
      Order Number
    </div>
    <div style="font-size: 28px; font-weight: 700; color: #000000; letter-spacing: 1px; line-height: 1;">
      ${escapeHtml(data.orderNumber)}
    </div>
  </div>

  <div style="background-color: ${BRAND.bg}; padding: 20px 24px; margin: 0 0 28px 0;">
    <p style="margin: 0 0 6px 0; font-size: 14px; color: #555555;"><strong>Total:</strong> ${formatTzs(data.total)}</p>
    <p style="margin: 0; font-size: 14px; color: #555555;"><strong>Reason:</strong> ${reason}</p>
  </div>

  <p style="font-size: 14px; line-height: 20px; color: ${BRAND.muted}; margin: 0 0 0 0;">
    If a payment was made, a refund will be processed within 3–5 business days. If you have questions, reach out through the contact page.
  </p>`);
}
