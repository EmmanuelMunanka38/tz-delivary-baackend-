import crypto from 'crypto';
import fs from 'fs';
import config from '@/config';

let privateKeyData: string | null = null;

function loadPrivateKey(): string {
  if (privateKeyData) return privateKeyData;

  if (config.whatsapp.privateKey) {
    privateKeyData = config.whatsapp.privateKey;
  } else {
    const keyPath = config.whatsapp.privateKeyPath;
    if (!keyPath || !fs.existsSync(keyPath)) {
      throw new Error('WhatsApp private key not found. Set WHATSAPP_PRIVATE_KEY or WHATSAPP_PRIVATE_KEY_PATH');
    }
    privateKeyData = fs.readFileSync(keyPath, 'utf8');
  }

  return privateKeyData;
}

export interface DecryptedRequest {
  decryptedBody: any;
  aesKeyBuffer: Buffer;
  initialVectorBuffer: Buffer;
}

export function decryptRequest(body: any): DecryptedRequest {
  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;

  if (!encrypted_aes_key || !encrypted_flow_data || !initial_vector) {
    throw new Error('Missing required encryption fields');
  }

  const privateKeyPem = loadPrivateKey();
  const passphrase = config.whatsapp.privateKeyPassphrase;

  const encryptedAesKeyBuffer = Buffer.from(encrypted_aes_key, 'base64');
  const flowDataBuffer = Buffer.from(encrypted_flow_data, 'base64');
  const initialVectorBuffer = Buffer.from(initial_vector, 'base64');

  const decryptedAesKey = crypto.privateDecrypt(
    {
      key: crypto.createPrivateKey({
        key: privateKeyPem,
        format: 'pem',
        passphrase: passphrase || undefined,
      }),
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    encryptedAesKeyBuffer,
  );

  const TAG_LENGTH = 16;
  const encryptedFlowDataBody = flowDataBuffer.subarray(0, flowDataBuffer.length - TAG_LENGTH);
  const encryptedFlowDataTag = flowDataBuffer.subarray(flowDataBuffer.length - TAG_LENGTH);

  const decipher = crypto.createDecipheriv('aes-128-gcm', decryptedAesKey, initialVectorBuffer);
  decipher.setAuthTag(encryptedFlowDataTag);

  const decryptedJSONString = Buffer.concat([decipher.update(encryptedFlowDataBody), decipher.final()]).toString(
    'utf-8',
  );

  return {
    decryptedBody: JSON.parse(decryptedJSONString),
    aesKeyBuffer: decryptedAesKey,
    initialVectorBuffer,
  };
}

export function encryptResponse(response: any, aesKeyBuffer: Buffer, initialVectorBuffer: Buffer): string {
  const flippedIv: number[] = [];
  for (const byte of initialVectorBuffer) {
    flippedIv.push(~byte & 0xff);
  }

  const cipher = crypto.createCipheriv('aes-128-gcm', aesKeyBuffer, Buffer.from(flippedIv));

  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(response), 'utf-8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  return encrypted.toString('base64');
}

export function validateSignature(payload: string, signature: string, appSecret: string): boolean {
  if (!appSecret) return true;

  const expectedSignature = crypto.createHmac('sha256', appSecret).update(payload).digest('hex');

  const receivedSignature = signature.replace('sha256=', '');

  return crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(receivedSignature));
}
