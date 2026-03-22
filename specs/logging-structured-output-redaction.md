# Structured Logging with Automatic Redaction

## What

All logs use structured JSON format with automatic redaction of sensitive fields. The logger wraps `console.log/warn/error` to ensure consistent output shape, prevent accidental credential leaks, and enable machine-parseable correlation across distributed traces.

## Where

- `src/lib/logger.ts:1-62` — Logger implementation with `log.info/warn/error` and redaction
- `src/server/redis.ts:40-46,63-69,81-88,171-177` — Redis failure logging (feature/operation pattern)
- `src/server/services/feed.ts:96-100,105-109,155-159` — Feed cache hit/miss logging
- `src/server/trpc/index.ts` — tRPC error handler (logs all server errors)
- `src/server/db.ts` — Prisma query logging (production only)
- `src/app/api/sse/route.ts` — SSE connection lifecycle logging

## How It Works

### 1. Structured JSON Output

Every log entry is a JSON object with standard fields:

```typescript
// src/lib/logger.ts:34-42
export const log = {
  info: (msg: string, data?: LogFields) =>
    console.log(
      JSON.stringify({
        level: "info",
        msg,
        ...redact(data),
        ts: new Date().toISOString(),
      })
    ),
  // warn and error follow same pattern
};
```

**Standard fields:**
- `level` — `"info"`, `"warn"`, or `"error"`
- `msg` — Human-readable message string
- `ts` — ISO 8601 timestamp
- All fields from the optional `data` parameter (after redaction)

### 2. Automatic Redaction

Sensitive field keys are replaced with `"[REDACTED]"` before output:

```typescript
// src/lib/logger.ts:14-28
const REDACTED_KEYS = ["password", "hashedPassword", "token", "access_token", "refresh_token"];

function redact(data?: LogFields): LogFields | undefined {
  if (!data) return data;
  const clone = { ...data };
  for (const key of REDACTED_KEYS) {
    if (key in clone) {
      clone[key] = "[REDACTED]";
    }
  }
  return clone;
}
```

**Redacted keys:** `password`, `hashedPassword`, `token`, `access_token`, `refresh_token`

**Example:**
```typescript
log.info("User login", { userId: "abc123", password: "secret" });
// Output: {"level":"info","msg":"User login","userId":"abc123","password":"[REDACTED]","ts":"..."}
```

### 3. Log Level Guidelines

**info** — Normal operation, key state transitions:
- Cache hit/miss
- Feed rebuilt
- SSE connection established

**warn** — Degraded operation, fail-open scenarios:
- Redis cache failure (fall through to DB)
- SSE publish failure (client will poll)
- Unread count cache miss

**error** — Failed operation, fail-closed scenarios:
- Rate limiter failure (reject request)
- Auth validation failure
- Database constraint violation

From `src/server/redis.ts`:
```typescript
// Fail-open: log.warn
log.warn("Redis operation failed", {
  feature: "cache",
  operation: "GET",
  key,
  error: error instanceof Error ? error.message : String(error),
  requestId,
});

// Fail-closed: log.error
log.error("Redis operation failed", {
  feature: "rate-limit",
  operation: "authRateLimitCheck",
  scope,
  error: errorMessage,
  requestId,
});
```

### 4. Standard Context Fields

All log entries should include relevant context. Common fields from `src/lib/logger.ts:6-12`:

- `requestId` — UUIDv4 correlation ID (see logging-request-correlation.md)
- `route` — tRPC procedure name or HTTP route
- `userId` — ID of authenticated user (if applicable)
- `errorCode` — tRPC error code or HTTP status
- `latencyMs` — Operation duration

**Feature-specific context** (from Redis operations):
- `feature` — Subsystem name (`"cache"`, `"sse"`, `"rate-limit"`, `"unread"`)
- `operation` — Function name (`"GET"`, `"SET"`, `"authRateLimitCheck"`)
- `key` — Redis key being accessed
- `error` — Error message (always extract `.message` from Error objects)

## Invariants

1. **I-LOG1:** All logs MUST use `log.info/warn/error` from `src/lib/logger.ts`. Never use bare `console.log`.

2. **I-LOG2:** Logs MUST NOT include request bodies, full error stack traces, or PII beyond user IDs. Never log email addresses, IP addresses (except for rate limiting internal logs), or session tokens.

3. **I-LOG3:** Error objects MUST be converted to strings via `error.message` before logging. Never pass `Error` objects directly to the logger (they don't serialize to JSON).

4. **I-LOG4:** All sensitive fields MUST use keys from `REDACTED_KEYS` list. If a new credential field is added (e.g., `apiKey`), it MUST be added to `REDACTED_KEYS`.

5. **I-LOG5:** The `requestId` field MUST be included in all logs within a tRPC context. This enables correlation across PostgreSQL, Redis, and application logs.

6. **I-LOG6:** Log level MUST match fail-open/fail-closed policy:
   - Fail-open degradation → `log.warn`
   - Fail-closed rejection → `log.error`
   - Normal operation → `log.info`

7. **I-LOG7:** Logs MUST be valid JSON. Do not interpolate unescaped strings into log messages that could break JSON parsing.

## Gotchas

**Don't log full Error objects.** JavaScript's `JSON.stringify(new Error("msg"))` produces `{}` (empty object). Always extract `.message` or use `String(error)`:

```typescript
// WRONG
log.error("Failed", { error });  // → { error: {} }

// RIGHT
log.error("Failed", { error: error instanceof Error ? error.message : String(error) });
```

**Redaction is shallow.** Nested objects are not recursively redacted. If a field contains `{ auth: { password: "secret" } }`, only top-level `password` keys are redacted:

```typescript
log.info("Debug", { password: "foo", nested: { password: "bar" } });
// Output: { password: "[REDACTED]", nested: { password: "bar" } }  ← nested.password NOT redacted
```

**No automatic PII detection.** The logger does NOT scan values for email addresses or phone numbers. Developers must avoid passing PII in field values.

**Log only at key boundaries.** From godfile §1.18: "Use at key boundaries: tRPC error handler, auth failures, rate limit hits, Redis failures, SSE connection lifecycle. Do NOT log request bodies or sensitive data." Logging every function call creates noise and performance overhead.

**Production vs development.** In development (`NODE_ENV !== "production"`), logs are human-readable with newlines and colors via `console.log`. In production, structured JSON goes to stdout for ingestion by log aggregators (CloudWatch, Datadog, etc.). Never rely on log format for business logic.

**requestId propagation requires AsyncLocalStorage.** The `requestId` field is not automatically injected — callers must pass it explicitly from tRPC context. See `logging-request-correlation.md` for propagation pattern.

**Redacted doesn't mean deleted.** `[REDACTED]` values still appear in logs. This is intentional — it shows that a field was present (useful for debugging missing credentials) without exposing the value. Do NOT send logs containing `[REDACTED]` to untrusted external services.

**String() coercion can leak secrets.** If an error message contains a secret (e.g., `Error("Invalid API key: sk_live_123")`), `String(error)` will log the secret. Sanitize error messages at creation time, not log time.
