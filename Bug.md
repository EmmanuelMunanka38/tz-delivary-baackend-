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

7. Redis and Ratelimiter Issue Solving

   **Files reviewed:** `src/middleware/rateLimiter.ts`, `src/db/redis.ts`, `src/config/index.ts`, `src/app.ts`, `src/routes/auth.ts`, `.env.example`, `package.json`

   **Observed symptom:** With three backend replicas behind a proxy, an endpoint returns “Too many requests” even when there is no apparent end-user traffic. The reported number “249” is not an HTTP status configured by this repository. The application explicitly configures `statusCode: 429`; therefore, `249` is likely a client-side error code, a displayed counter, or a `RateLimit-*` value. The actual HTTP response should be confirmed from the response status and headers.

   **Current behavior:**

   - `globalLimiter` runs for almost every request and allows 100 requests per IP per one-second Redis window.
   - `publicLimiter` runs for every `/api/` request and allows 300 requests per IP per 60-second Redis window.
   - `openEndpointLimiter` adds another 60 requests per IP per 60 seconds on restaurants, categories, and promotions.
   - `/api/health`, `/api/metrics`, and `/api/debug/ip` are all behind both the global and public limiters. A load-balancer health check, uptime monitor, proxy retry loop, browser polling loop, or mobile-app retry loop is therefore counted as traffic even when there are no human users.
   - The Redis prefixes are shared (`rl:global:`, `rl:public:`, `rl:open:`, `rl:auth:`, and `rl:otp:`). This is correct for three replicas: all replicas must see one aggregate counter. It also means that a request burst through any replica consumes the same bucket, and that old counters remain visible if the same Redis database and prefixes are reused by another deployment/environment.
   - The rate limiter uses the ioredis TCP client from `src/db/redis.ts`; the `upstashRedis` REST client is not passed to `RedisStore` and is not used by the rate limiter. The comments and `.env.example` describe Upstash REST as the distributed rate-limiter path, but the implementation actually requires a working `REDIS_URL` TCP connection.

   **Most likely causes of the false-looking 429:**

   1. **The proxy or health checks are the hidden traffic source.** Every request from a proxy/monitor that presents the same client address shares one Redis key. Three replicas do not give three independent limits; they intentionally share the limit. If the proxy checks `/api/health` more than 300 times per minute, or retries a failing/slow request, the public bucket reaches its limit without user traffic.
   2. **The forwarded-IP calculation is not trustworthy or stable.** `app.set('trust proxy', true)` trusts every proxy hop, while `getClientIp()` independently takes the leftmost `X-Forwarded-For` value. This assumes every upstream proxy overwrites/sanitizes that header. If one proxy appends, preserves, or omits it, all requests can collapse to the proxy/LB address and share one bucket. If the header is client-controlled, it can also be spoofed. An empty or malformed first value can create the same shared key.
   3. **Redis state may be shared across environments or deployments.** The keys are intentionally persistent for the duration of their TTL. A reused Redis database, a previous deployment, or another service using the same `rl:*` prefixes can make a new replica start with existing counts. The normal TTLs are one second for `global`, one minute for `public`/`open`, five minutes for `otp`, and 15 minutes for `auth`; a count that remains elevated beyond those periods indicates that requests are still arriving or the Redis key/database is not the one expected.
   4. **The Redis fail-open implementation is incomplete.** `makeStore()` catches Redis errors and returns `[0, 60000]` for `EVAL`/`EVALSHA`, but returns numeric `0` for `SCRIPT LOAD`. `rate-limit-redis` v6 requires `SCRIPT LOAD` to return a SHA string and requires the script commands to return a two-item `[totalHits, timeToExpire]` result. Consequently, a Redis connection failure can produce store initialization/runtime errors rather than the documented reliable fail-open behavior. This does not explain a genuine 429 while Redis is healthy, but it can make the incident inconsistent and obscure the real failure.

   **How to confirm the exact cause in production:**

   1. Capture one failing response with `curl -i` or the proxy access log. Record the HTTP status, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, response body, request path, and request ID. A real limiter response is HTTP 429; `RateLimit-Remaining: 249` is not a 249 error and would mean 249 requests remain in a bucket.
   2. Call `/api/debug/ip` once through the public proxy and once directly against a replica. Compare `req.ip`, `remoteAddress`, and `x-forwarded-for`. Do not expose this endpoint permanently; it currently reveals trusted proxy information.
   3. Inspect proxy/LB access logs for `/api/health`, retries, readiness checks, and requests returning 429. Ensure health checks use an endpoint excluded from the public limiter.
   4. In the exact Redis database used by the replicas, inspect only the rate-limit keys and their TTLs, without logging credentials or values: `SCAN MATCH 'rl:*'`, then `TTL` and `GET` for the relevant key. Confirm the configured Redis host/database is the intended production instance and that no staging service shares it.
   5. Check startup logs for `[Redis] ioredis connected`, `[Redis] Connection error`, and `[RateLimiter] Redis error`. Confirm all three replicas use the same `REDIS_URL`, the same key prefixes, and compatible application versions.
   6. Temporarily log a hashed/redacted limiter key, selected limiter name, path, status, and replica identifier. Never log raw authorization headers, emails, Redis URLs, or tokens. This will show whether all requests are being counted under one proxy IP.

   **Recommended fix order:**

   - Create an unthrottled, authenticated or network-restricted readiness endpoint for the load balancer, or explicitly skip trusted health-check paths in all public limiters. Keep business/API endpoints protected.
   - Establish one canonical client-IP strategy. Configure the proxy to overwrite `X-Forwarded-For` with a sanitized value, configure Express with the known proxy hop count or trusted proxy subnets instead of `true`, and use Express's normalized IP value (with IPv6 normalization) rather than separately parsing an untrusted header. Reject an empty forwarded address and use a safe fallback.
   - Keep one shared Redis store for all replicas, but isolate environments with a deployment/environment prefix (for example, `production:rl:`) and verify that every replica points to the same Redis database. Do not flush the whole Redis database during an incident because BullMQ and Socket.IO also use it.
   - Correct the `rate-limit-redis` v6 adapter error path. Either allow store errors to pass through using the library's supported `passOnStoreError` policy, or return protocol-correct values for every command (`SCRIPT LOAD` must return a SHA string; `EVALSHA` must return a two-item result). Add startup/readiness diagnostics so Redis failures are visible instead of silently converted into misleading rate-limit behavior.
   - Add per-route limits deliberately rather than stacking broad limits on operational endpoints. Keep strict IP-plus-account/email limits for authentication and OTP, but avoid using a single proxy IP as the only identity for normal authenticated API traffic.
   - Add integration tests covering three app instances against one Redis database, sanitized/multi-hop `X-Forwarded-For`, missing headers, IPv6 addresses, health-check traffic, Redis command failures, and reset after each configured TTL.

   **Conclusion:** The three-replica architecture is not itself the bug; Redis sharing is required for distributed rate limiting. The immediate investigation target is the proxy/health-check request rate and the actual IP seen by the limiter. The highest-risk code issues are trusting all proxy hops while manually selecting the leftmost forwarded value, throttling `/api/health`, and claiming fail-open Redis behavior that does not satisfy the `rate-limit-redis` v6 command contract.
