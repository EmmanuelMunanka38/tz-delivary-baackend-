Bug report - pikifood_Backend

Overview

This document lists observed issues in the codebase, their risk, a short reproduction note, and step-by-step, simple code approaches to fix them. Changes below are minimal and targeted; include tests or logging verification after applying.

1. Sensitive and noisy logging in SMS service
   File: src/services/sms.service.ts
   Issue: API keys and OTPs are logged to console (including API key substring). This leaks secrets and exposes OTPs in non-dev environments.
   Risk: Secret leakage, security / privacy breach.
   Fix (steps):

- Remove printing of API keys. Mask secrets if absolutely needed for debugging.
- Only print OTPs in development when a config flag is set (config.isDev).
- Switch console.\* to a proper logger (optional); at minimum, replace console.error for sensitive info.
  Simple code approach:

```typescript
// replace the API key printing block with:
if (status === 401) {
  console.error('[SMS] Authentication failed. Check AT_USERNAME and AT_API_KEY in .env');
  if (config.isDev && apiKey) {
    const masked = apiKey.replace(/.(?=.{4})/g, '*');
    console.error('[SMS]   API Key (masked):', masked);
  }
}
// ensure OTP console output is wrapped with dev check
if (config.isDev) console.log(`[SMS] [DEV] OTP for ${internationalNumber}: ${otp}`);
```

2. Console.log used throughout (production noise)
   Files: many (src/index.ts, src/queue/index.ts, src/socket/index.ts, services/\*)
   Issue: app uses console.log/console.error everywhere. This makes production troubleshooting and log management harder.
   Risk: Hard to integrate with log aggregation, inconsistent log levels, noisy stdout.
   Fix (steps):

- Replace console usage with a structured logger (pino or winston).
- Create a small logger wrapper (logger.info/error/debug) and import across modules.
  Simple code approach:

```typescript
// Install pino and create src/lib/logger.ts
import pino from 'pino';
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
export default logger;

// Example replacement
// console.log('PostgreSQL connected');
logger.info('PostgreSQL connected');
```

3. Socket auth: accepting token from query string and silent catch
   File: src/socket/index.ts
   Issue: The middleware reads token from handshake.query (could be an object) and catch block discards original error. Accepting query tokens can leak tokens in URLs and may be parsed incorrectly.
   Risk: Token leakage via URL, brittle parsing, poor error visibility.
   Fix (steps):

- Only accept socket.handshake.auth.token (per Socket.IO recommended practice).
- Validate token is a string before verify.
- Log the original error for internal diagnostics, but send a generic message to the client.
  Simple code approach:

```typescript
const token = socket.handshake.auth?.token;
if (!token || typeof token !== 'string') return next(new Error('Authentication required'));
try {
  const decoded = jwt.verify(token, config.jwt.accessSecret) as any;
  // ...
} catch (err) {
  logger.warn('Socket auth failed', { cause: err?.message });
  next(new Error('Invalid token'));
}
```

4. validate middleware forwards raw errors to next()
   File: src/middleware/validate.ts
   Issue: On validation failure schema.parse throws and middleware calls next(error) which may propagate unformatted errors to global error handler.
   Risk: Inconsistent client error responses and potential leakage of internal validation details.
   Fix (steps):

- Catch ZodError and convert to a consistent 400 response with a small message list.
  Simple code approach:

```typescript
import { ZodError } from 'zod';
// inside catch block
if (error instanceof ZodError) {
  res.status(400).json({ success: false, errors: error.errors.map((e) => e.message) });
  return;
}
next(error);
```

5. Webhook handler hides processing failures by always returning 200 on error
   File: src/routes/payment.ts (clickPesaWebhookRouter.post)
   Issue: The catch block logs an error then responds with 200 OK. This hides failures from the provider and may prevent retries.
   Risk: Missed webhook events, silent failures.
   Fix (steps):

- Decide desired behavior: if the provider retries on non-200, return 5xx when processing fails so the provider retries.
- If intentionally returning 200 (to avoid retries), log a high-severity alert and push to monitoring/queue for manual replay.
  Simple code approach (return 500 to allow retries):

```typescript
} catch (error) {
  console.error('Webhook processing error:', error);
  res.status(500).json({ success: false, message: 'Webhook processing failed' });
}
```

6. Catch blocks without error variable hide root cause
   Examples: src/socket/index.ts io.use(...) uses catch { next(new Error('Invalid token')) }
   Issue: catch without (err) prevents logging the underlying reason.
   Risk: Hard to debug authentication and runtime failures.
   Fix (steps):

- Always include error variable and log it (masked) internally.
  Simple code approach:

```typescript
} catch (err: any) {
  logger.debug('Token verification error', { message: err.message });
  next(new Error('Invalid token'));
}
```

Notes & next actions

- These are prioritized, actionable fixes. Begin with sensitive logging (SMS) and socket auth changes, then replace console.\* with a logger.
- After code changes, run unit tests and exercise the webhook/OTP flows in a staging environment.
- If desired, a follow-up PR can be produced with minimal diffs applying these fixes.

If you want, proceed to apply these changes (create commits, run tests) and open a PR with the fixes.
