# WhatsApp Flow Encryption Implementation Plan

## Overview

Implement end-to-end encryption for WhatsApp Flow endpoints to comply with Meta's security requirements. This involves RSA 2048-bit asymmetric encryption for key exchange and AES-128-GCM symmetric encryption for payload encryption.

## Current State

- **8 WhatsApp Flow endpoints** exist in `/src/routes/whatsapp-flow.ts` returning plain JSON
- **No encryption** implementation currently exists
- **No RSA key pair** has been generated
- Config and environment structure already in place

## Implementation Steps

### 1. Generate RSA Key Pair

**Action:** Create RSA 2048-bit key pair using OpenSSL

```bash
# Generate private key (PKCS#8 format, unencrypted)
openssl genrsa -out private.pem 2048

# Extract public key
openssl rsa -in private.pem -pubout -out public.pem

# Convert to PKCS#8 format (required by Meta)
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in private.pem -out private_pkcs8.pem
```

**File Locations:**

- `private_pkcs8.pem` - Store securely on server (add to `.gitignore`)
- `public.pem` - Upload to Meta Business Manager

**Storage Decision:** Store private key as environment variable `WHATSAPP_PRIVATE_KEY` for cloud deployment compatibility

### 2. Create Encryption Service

**File:** `/src/services/whatsapp/whatsapp-crypto.ts`

**Functions to Implement:**

#### `decryptRequest(body, privateKey)`

- Extract `encrypted_aes_key`, `encrypted_flow_data`, `initial_vector` from request body
- Decode base64 strings to buffers
- Decrypt AES key using RSA-OAEP with SHA-256:
  ```typescript
  crypto.privateDecrypt(
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    encryptedAesKeyBuffer,
  );
  ```
- Extract 16-byte auth tag from end of `encrypted_flow_data`
- Decrypt flow data using AES-128-GCM:
  ```typescript
  const decipher = crypto.createDecipheriv('aes-128-gcm', aesKey, iv);
  decipher.setAuthTag(authTag);
  ```
- Return `{ decryptedBody, aesKeyBuffer, initialVectorBuffer }`

#### `encryptResponse(response, aesKey, iv)`

- Flip IV bits (XOR each byte with 0xFF)
- Encrypt response using AES-128-GCM with flipped IV
- Append 16-byte auth tag to ciphertext
- Return base64-encoded string

#### `validateSignature(payload, signature, appSecret)`

- Generate SHA256 HMAC of payload using app secret
- Compare with `X-Hub-Signature-256` header (after `sha256=` prefix)
- Return boolean

### 3. Create Middleware for Encrypted Requests

**File:** `/src/middleware/whatsappFlowEncryption.ts`

**Middleware Logic:**

```typescript
export const whatsappFlowEncryption = async (req, res, next) => {
  try {
    // 1. Validate signature if app secret is configured
    if (config.whatsapp.appSecret) {
      const signature = req.headers['x-hub-signature-256'];
      if (!validateSignature(req.body, signature, config.whatsapp.appSecret)) {
        return res.status(401).send('Invalid signature');
      }
    }

    // 2. Decrypt request
    const { decryptedBody, aesKeyBuffer, initialVectorBuffer } = decryptRequest(req.body, config.whatsapp.privateKey);

    // 3. Handle health check (ping)
    if (decryptedBody.action === 'ping') {
      const response = { data: { status: 'active' } };
      const encrypted = encryptResponse(response, aesKeyBuffer, initialVectorBuffer);
      return res.type('text/plain').send(encrypted);
    }

    // 4. Handle error notification
    if (decryptedBody.action === 'error') {
      console.error('Flow error:', decryptedBody.data);
      const response = { data: { acknowledged: true } };
      const encrypted = encryptResponse(response, aesKeyBuffer, initialVectorBuffer);
      return res.type('text/plain').send(encrypted);
    }

    // 5. Store decryption context for response encryption
    req.whatsappFlow = {
      decryptedBody,
      aesKeyBuffer,
      initialVectorBuffer,
    };

    // 6. Replace req.body with decrypted data
    req.body = decryptedBody.data || {};

    next();
  } catch (error) {
    console.error('Decryption failed:', error);
    return res.status(421).send('Decryption failed');
  }
};
```

### 4. Create Response Encryption Helper

**File:** `/src/middleware/whatsappFlowResponse.ts`

**Helper Function:**

```typescript
export const sendEncryptedResponse = (req, res, responseData) => {
  if (!req.whatsappFlow) {
    // Fallback to plain JSON (for testing)
    return res.json(responseData);
  }

  const { aesKeyBuffer, initialVectorBuffer } = req.whatsappFlow;
  const encrypted = encryptResponse(responseData, aesKeyBuffer, initialVectorBuffer);
  res.type('text/plain').send(encrypted);
};
```

### 5. Refactor WhatsApp Flow Endpoints

**File:** `/src/routes/whatsapp-flow.ts`

**Changes Required:**

#### Add Encryption Middleware

```typescript
import { whatsappFlowEncryption } from '@/middleware/whatsappFlowEncryption';
import { sendEncryptedResponse } from '@/middleware/whatsappFlowResponse';

router.post('/restaurants', whatsappFlowEncryption, async (req, res) => {
  // ... existing logic ...
  sendEncryptedResponse(req, res, { restaurants: formattedRestaurants });
});
```

#### Update All Endpoints

Apply to all 8 endpoints:

1. `/restaurants` - Browse restaurants
2. `/menu` - Get restaurant menu
3. `/cart` - Get cart contents
4. `/cart/add` - Add item to cart
5. `/payment` - Process payment
6. `/order/status` - Get order status
7. `/order/refresh` - Refresh order status
8. `/orders` - Get order history

**Pattern:**

```typescript
router.post('/endpoint', whatsappFlowEncryption, async (req, res) => {
  try {
    // Business logic (unchanged)
    const result = await processData(req.body);

    // Send encrypted response
    sendEncryptedResponse(req, res, result);
  } catch (error) {
    console.error('Error:', error);
    sendEncryptedResponse(req, res, {
      error: 'Operation failed',
      error_message: error.message,
    });
  }
});
```

### 6. Update Configuration

**File:** `/src/config/index.ts`

**Add to `whatsapp` object:**

```typescript
whatsapp: {
  // ... existing config ...
  privateKey: process.env.WHATSAPP_PRIVATE_KEY || '',
  appSecret: process.env.WHATSAPP_APP_SECRET || '',
  flowEndpointEnabled: process.env.WHATSAPP_FLOW_ENCRYPTION_ENABLED === 'true',
}
```

### 7. Update Environment Variables

**File:** `.env`

**Add:**

```env
# WhatsApp Flow Encryption
WHATSAPP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
WHATSAPP_APP_SECRET=your_meta_app_secret_here
WHATSAPP_FLOW_ENCRYPTION_ENABLED=true
```

**File:** `.env.example`

**Add:**

```env
# WhatsApp Flow Encryption (RSA private key in PKCS#8 format)
WHATSAPP_PRIVATE_KEY=
# Meta app secret for signature validation
WHATSAPP_APP_SECRET=
# Enable encryption (set to false for testing)
WHATSAPP_FLOW_ENCRYPTION_ENABLED=false
```

### 8. Update .gitignore

**Add:**

```
# WhatsApp Flow encryption keys
*.pem
private*.pem
public.pem
```

### 9. Create Key Management Script

**File:** `/scripts/generate-whatsapp-keys.sh`

```bash
#!/bin/bash
# Generate RSA 2048-bit key pair for WhatsApp Flow encryption

echo "Generating RSA 2048-bit key pair..."

# Generate private key
openssl genrsa -out private.pem 2048

# Extract public key
openssl rsa -in private.pem -pubout -out public.pem

# Convert to PKCS#8 format
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in private.pem -out private_pkcs8.pem

echo "✓ Keys generated successfully"
echo ""
echo "Files created:"
echo "  - private.pem (PKCS#1 format)"
echo "  - private_pkcs8.pem (PKCS#8 format - use this for WHATSAPP_PRIVATE_KEY)"
echo "  - public.pem (upload to Meta Business Manager)"
echo ""
echo "Next steps:"
echo "1. Copy contents of private_pkcs8.pem to WHATSAPP_PRIVATE_KEY in .env"
echo "2. Upload public.pem to Meta Business Manager"
echo "3. Set WHATSAPP_FLOW_ENCRYPTION_ENABLED=true in .env"
```

### 10. Create Testing Script

**File:** `/scripts/test-whatsapp-encryption.ts`

```typescript
import crypto from 'crypto';
import fs from 'fs';

// Test encryption/decryption locally
const publicKey = fs.readFileSync('public.pem', 'utf8');
const privateKey = fs.readFileSync('private_pkcs8.pem', 'utf8');

// Generate random AES key and IV
const aesKey = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);

// Encrypt AES key with public key
const encryptedAesKey = crypto.publicEncrypt(
  {
    key: publicKey,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256',
  },
  aesKey,
);

// Encrypt test payload
const payload = JSON.stringify({ test: 'data' });
const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, iv);
const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
const authTag = cipher.getAuthTag();
const encryptedData = Buffer.concat([encrypted, authTag]);

// Create request body
const requestBody = {
  encrypted_aes_key: encryptedAesKey.toString('base64'),
  encrypted_flow_data: encryptedData.toString('base64'),
  initial_vector: iv.toString('base64'),
};

console.log('Test request body:', JSON.stringify(requestBody, null, 2));

// Test decryption
const decryptedAesKey = crypto.privateDecrypt(
  {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256',
  },
  Buffer.from(requestBody.encrypted_aes_key, 'base64'),
);

const flowData = Buffer.from(requestBody.encrypted_flow_data, 'base64');
const ivBuffer = Buffer.from(requestBody.initial_vector, 'base64');
const authTagBuffer = flowData.subarray(-16);
const encryptedFlowData = flowData.subarray(0, -16);

const decipher = crypto.createDecipheriv('aes-128-gcm', decryptedAesKey, ivBuffer);
decipher.setAuthTag(authTagBuffer);
const decrypted = Buffer.concat([decipher.update(encryptedFlowData), decipher.final()]);

console.log('Decrypted payload:', decrypted.toString('utf8'));
console.log('✓ Encryption/decryption test passed');
```

### 11. Update Flow JSON

**File:** `/src/whatsapp-flows/piki-food-flow.json`

**Add `data_api_version` at top level:**

```json
{
  "version": "7.3",
  "data_api_version": "3.0",
  "routing_model": { ... },
  "screens": [ ... ]
}
```

### 12. Create Documentation

**File:** `/docs/WHATSAPP_FLOW_ENCRYPTION.md`

**Contents:**

- Setup instructions for generating keys
- How to upload public key to Meta Business Manager
- How to configure environment variables
- Testing procedures
- Troubleshooting common errors (421, signature validation failures)
- Security best practices

### 13. Update App Entry Point

**File:** `/src/app.ts`

**Add type definitions:**

```typescript
declare global {
  namespace Express {
    interface Request {
      whatsappFlow?: {
        decryptedBody: any;
        aesKeyBuffer: Buffer;
        initialVectorBuffer: Buffer;
      };
    }
  }
}
```

## Testing Strategy

### Local Testing (Encryption Disabled)

1. Set `WHATSAPP_FLOW_ENCRYPTION_ENABLED=false`
2. Test endpoints with plain JSON requests
3. Verify business logic works correctly

### Local Testing (Encryption Enabled)

1. Generate key pair using script
2. Set `WHATSAPP_FLOW_ENCRYPTION_ENABLED=true`
3. Run encryption test script
4. Use Postman/curl with encrypted payloads

### Production Testing

1. Upload public key to Meta Business Manager
2. Set `WHATSAPP_FLOW_ENCRYPTION_ENABLED=true`
3. Test flow in WhatsApp app
4. Monitor logs for decryption errors

## Security Considerations

1. **Private Key Storage:**
   - Never commit private key to repository
   - Use environment variables or secret management service
   - Rotate keys periodically

2. **Signature Validation:**
   - Always validate `X-Hub-Signature-256` in production
   - Set `WHATSAPP_APP_SECRET` from Meta app dashboard

3. **Error Handling:**
   - Return HTTP 421 for decryption failures (forces client to re-download public key)
   - Log errors but don't expose sensitive details

4. **Performance:**
   - RSA decryption is CPU-intensive
   - Consider caching decrypted AES keys if needed
   - Monitor response times

## Deployment Checklist

- [ ] Generate RSA key pair
- [ ] Add private key to environment variables
- [ ] Upload public key to Meta Business Manager
- [ ] Set `WHATSAPP_APP_SECRET` from Meta app
- [ ] Enable encryption in production environment
- [ ] Test health check endpoint (ping)
- [ ] Test error notification handling
- [ ] Verify all 8 flow endpoints work with encryption
- [ ] Monitor logs for decryption errors
- [ ] Document key rotation procedure

## Files to Create/Modify

### New Files

1. `/src/services/whatsapp/whatsapp-crypto.ts` - Encryption/decryption logic
2. `/src/middleware/whatsappFlowEncryption.ts` - Request decryption middleware
3. `/src/middleware/whatsappFlowResponse.ts` - Response encryption helper
4. `/scripts/generate-whatsapp-keys.sh` - Key generation script
5. `/scripts/test-whatsapp-encryption.ts` - Encryption test script
6. `/docs/WHATSAPP_FLOW_ENCRYPTION.md` - Documentation

### Modified Files

1. `/src/routes/whatsapp-flow.ts` - Add middleware to all endpoints
2. `/src/config/index.ts` - Add encryption config
3. `/src/app.ts` - Add type definitions
4. `/.env` - Add encryption environment variables
5. `/.env.example` - Document new variables
6. `/.gitignore` - Ignore key files
7. `/src/whatsapp-flows/piki-food-flow.json` - Add `data_api_version`

## Meta Business Manager Setup

### Upload Public Key

1. Go to Meta Business Manager
2. Navigate to WhatsApp > API Setup
3. Scroll to "WhatsApp Business Encryption"
4. Click "Upload and Sign Key"
5. Upload `public.pem` file
6. Verify key fingerprint matches

### Configure Endpoint

1. In Flow Builder, add endpoint URL
2. Set endpoint to: `https://your-domain.com/api/whatsapp/flow/[endpoint]`
3. Enable encryption
4. Test with "Preview" mode

## Troubleshooting

### Error: "Decryption failed" (HTTP 421)

- Verify private key format (must be PKCS#8)
- Check private key matches uploaded public key
- Ensure `WHATSAPP_PRIVATE_KEY` environment variable is set correctly

### Error: "Invalid signature" (HTTP 401)

- Verify `WHATSAPP_APP_SECRET` matches Meta app secret
- Check signature validation logic
- Temporarily disable signature validation for debugging

### Error: "Auth tag mismatch"

- Verify AES-GCM implementation
- Check auth tag extraction (last 16 bytes)
- Ensure IV is correctly decoded from base64

### Flow not calling endpoint

- Verify `data_api_version: "3.0"` in Flow JSON
- Check endpoint URL is accessible (HTTPS, valid certificate)
- Test endpoint with health check (ping)

## Success Criteria

- [ ] All 8 endpoints accept encrypted requests
- [ ] All responses are encrypted
- [ ] Health check (ping) returns encrypted `{ status: 'active' }`
- [ ] Error notifications are acknowledged
- [ ] Signature validation works in production
- [ ] No decryption errors in logs
- [ ] Flow works end-to-end in WhatsApp app
- [ ] Performance is acceptable (< 500ms response time)

## Next Steps After Implementation

1. **Monitor Production:**
   - Set up alerts for decryption failures
   - Monitor response times
   - Track error rates

2. **Key Rotation:**
   - Document key rotation procedure
   - Schedule quarterly key rotation
   - Test rotation in staging first

3. **Performance Optimization:**
   - Profile encryption/decryption overhead
   - Consider connection pooling for database calls
   - Implement caching where appropriate

4. **Security Audit:**
   - Review encryption implementation
   - Test for common vulnerabilities
   - Update dependencies regularly
