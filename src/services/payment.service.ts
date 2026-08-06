import crypto from 'crypto';
import axios from 'axios';
import config from '@/config';

function canonicalize(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(canonicalize);
  return Object.keys(obj)
    .sort()
    .reduce(
      (acc, key) => {
        acc[key] = canonicalize(obj[key]);
        return acc;
      },
      {} as Record<string, any>,
    );
}

export function createPayloadChecksum(payload: Record<string, any>): string {
  const canonicalPayload = canonicalize(payload);
  const payloadString = JSON.stringify(canonicalPayload);
  const hmac = crypto.createHmac('sha256', config.clickPesa.checksumKey);
  hmac.update(payloadString);
  return hmac.digest('hex');
}
//! changing the validation logic for handling payemnts
export function validateWebhookChecksum(payload: Record<string, any>, receivedChecksum: string): boolean {
  if (!receivedChecksum) return false;

  const payloadForValidation: Record<string, any> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key !== 'checksum' && key !== 'checksumMethod') {
      payloadForValidation[key] = value;
    }
  }

  const computedChecksum = createPayloadChecksum(payloadForValidation);
  return computedChecksum === receivedChecksum;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getClickPesaToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const response = await axios.post(
    `${config.clickPesa.baseUrl}/generate-token`, // session token based authentication
    {},
    {
      headers: {
        'client-id': config.clickPesa.clientId,
        'api-key': config.clickPesa.apiKey,
      },
    },
  );

  const token: string = response.data.token;
  const expiresAt = Date.now() + 50 * 60 * 1000; // 50 min buffer (token valid 1hr)

  cachedToken = { token, expiresAt };
  return token;
}

export interface USSDPushPayload {
  amount: number;
  orderReference: string;
  phoneNumber: string;
  currency?: string;
}

export async function initiateUSSDPush(payload: USSDPushPayload) {
  const token = await getClickPesaToken();
  const currency = payload.currency || 'TZS';

  const requestBody: Record<string, any> = {
    amount: String(payload.amount),
    currency,
    orderReference: payload.orderReference,
    phoneNumber: payload.phoneNumber,
  };

  requestBody.checksum = createPayloadChecksum(requestBody);

  const response = await axios.post(`${config.clickPesa.baseUrl}/payments/initiate-ussd-push-request`, requestBody, {
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
  });

  return response.data;
}
