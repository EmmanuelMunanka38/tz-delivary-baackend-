import { Request, Response, NextFunction } from 'express';
import { decryptRequest, encryptResponse, validateSignature } from '@/services/whatsapp/whatsapp-crypto';
import config from '@/config';

export interface WhatsAppFlowRequest extends Request {
  whatsappFlow?: {
    decryptedBody: any;
    aesKeyBuffer: Buffer;
    initialVectorBuffer: Buffer;
  };
}

export async function whatsappFlowEncryption(
  req: WhatsAppFlowRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rawBody = JSON.stringify(req.body);

    if (config.whatsapp.appSecret) {
      const signature = req.headers['x-hub-signature-256'] as string;
      if (signature && !validateSignature(rawBody, signature, config.whatsapp.appSecret)) {
        res.status(401).send('Invalid signature');
        return;
      }
    }

    const isEncrypted = req.body.encrypted_aes_key && req.body.encrypted_flow_data;

    if (!isEncrypted) {
      console.log('[WhatsApp Flow] Unencrypted request detected');

      if (req.body.action === 'ping') {
        res.json({ data: { status: 'active' } });
        return;
      }

      if (req.body.action === 'error') {
        console.error('[WhatsApp Flow Error]', req.body.data);
        res.json({ data: { acknowledged: true } });
        return;
      }

      req.whatsappFlow = {
        decryptedBody: req.body,
        aesKeyBuffer: Buffer.alloc(0),
        initialVectorBuffer: Buffer.alloc(0),
      };

      req.body = req.body.data || {};
      next();
      return;
    }

    console.log('[WhatsApp Flow] Encrypted request detected, decrypting...');
    const { decryptedBody, aesKeyBuffer, initialVectorBuffer } = decryptRequest(req.body);

    if (decryptedBody.action === 'ping') {
      const response = { data: { status: 'active' } };
      const encrypted = encryptResponse(response, aesKeyBuffer, initialVectorBuffer);
      res.type('text/plain').send(encrypted);
      return;
    }

    if (decryptedBody.action === 'error') {
      console.error('[WhatsApp Flow Error]', decryptedBody.data);
      const response = { data: { acknowledged: true } };
      const encrypted = encryptResponse(response, aesKeyBuffer, initialVectorBuffer);
      res.type('text/plain').send(encrypted);
      return;
    }

    req.whatsappFlow = {
      decryptedBody,
      aesKeyBuffer,
      initialVectorBuffer,
    };

    req.body = decryptedBody.data || {};

    next();
  } catch (error: any) {
    console.error('[WhatsApp Flow Decryption Error]', error.message);
    res.status(421).send('Decryption failed');
  }
}

export function sendEncryptedResponse(req: WhatsAppFlowRequest, res: Response, responseData: any): void {
  if (!req.whatsappFlow || req.whatsappFlow.aesKeyBuffer.length === 0) {
    res.json(responseData);
    return;
  }

  const { aesKeyBuffer, initialVectorBuffer } = req.whatsappFlow;
  const encrypted = encryptResponse(responseData, aesKeyBuffer, initialVectorBuffer);
  res.type('text/plain').send(encrypted);
}
