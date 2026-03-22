# Error Classification and Context Enrichment

## What

tRPC middleware classifies errors by severity and enriches log context with request metadata (IP, userId, latency). Different error types are logged at different levels: auth failures and rate limits at WARN, internal errors at ERROR, with automatic IP extraction for security events.

## Where

- `src/server/trpc/index.ts:55-126` — Logging middleware with error classification
- `src/server/trpc/index.ts:58-62` — IP extraction from headers (x-forwarded-for, x-real-ip)
- `src/server/trpc/index.ts:87-124` — TRPCError classification by error code
- `src/server/trpc/index.ts:79-84` — Slow query detection (>500ms)

## How It Works

### Request Context Enrichment

Every tRPC request captures standard context fields before executing the procedure:

```typescript
// src/server/trpc/index.ts:58-62
const ip =
  ctx.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  ctx.req.headers.get("x-real-ip") ||
  "unknown";
```

**IP extraction order:**
1. `x-forwarded-for` (comma-separated, take first) — set by reverse proxies
2. `x-real-ip` — alternative proxy header
3. `"unknown"` — fallback if no headers present

### Successful Response Logging

Normal responses log at INFO with basic context:

```typescript
// src/server/trpc/index.ts:71-84
const logData = {
  requestId: ctx.requestId,
  route: `${type}.${path}`,
  userId: ctx.session?.user?.id,
  latencyMs,
  statusCode: 200,
};

// Warn on slow queries
if (latencyMs > 500) {
  log.warn("Slow tRPC query", logData);
} else {
  log.info("tRPC response", logData);
}
```

**Slow query threshold:** 500ms triggers WARN instead of INFO.

### Error Classification by Code

TRPCError instances are classified by their `code` field:

```typescript
// src/server/trpc/index.ts:91-110
if (error instanceof TRPCError) {
  const logData = {
    requestId: ctx.requestId,
    route: `${type}.${path}`,
    userId: ctx.session?.user?.id,
    latencyMs,
    errorCode: error.code,
    ip,
  };

  // Auth failures and rate limits at WARN
  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    log.warn("Auth failure", logData);
  } else if (error.code === "TOO_MANY_REQUESTS") {
    log.warn("Rate limit hit", logData);
  } else if (error.code === "INTERNAL_SERVER_ERROR" || error.code === "TIMEOUT") {
    log.error("tRPC error", { ...logData, message: error.message });
  } else {
    log.warn("tRPC error", logData);
  }
}
```

**Classification rules:**

| Error Code | Log Level | Message | Includes IP | Includes error.message |
|------------|-----------|---------|-------------|------------------------|
| `UNAUTHORIZED` | WARN | "Auth failure" | Yes | No |
| `FORBIDDEN` | WARN | "Auth failure" | Yes | No |
| `TOO_MANY_REQUESTS` | WARN | "Rate limit hit" | Yes | No |
| `INTERNAL_SERVER_ERROR` | ERROR | "tRPC error" | Yes | Yes |
| `TIMEOUT` | ERROR | "tRPC error" | Yes | Yes |
| All others | WARN | "tRPC error" | Yes | No |

**IP address is included only in error logs**, not success logs. This enables correlation of auth failures and rate limit violations to source IPs for security monitoring.

### Non-TRPCError Handling

Unexpected errors (not TRPCError instances) are always logged at ERROR:

```typescript
// src/server/trpc/index.ts:111-121
else {
  // Non-tRPC errors
  log.error("Unexpected error", {
    requestId: ctx.requestId,
    route: `${type}.${path}`,
    userId: ctx.session?.user?.id,
    latencyMs,
    errorCode: "UNKNOWN",
    ip,
  });
}
```

These represent bugs or unhandled exceptions. The error code is forced to `"UNKNOWN"` to distinguish from properly thrown TRPCErrors.

### Latency Measurement

Latency is measured with millisecond precision using `Date.now()`:

```typescript
// src/server/trpc/index.ts:56
const startMs = Date.now();

// ... procedure execution ...

// src/server/trpc/index.ts:68
const latencyMs = Date.now() - startMs;
```

This latency appears in every log entry (success and error) and enables identification of slow endpoints.

## Invariants

1. **I1: All responses are logged** — Every tRPC procedure execution produces exactly one log entry (success or error), never zero, never multiple.

2. **I2: IP is logged only on errors** — IP address is included in error logs for security correlation but omitted from success logs to reduce log volume.

3. **I3: Error message only for server errors** — `error.message` is logged only for INTERNAL_SERVER_ERROR and TIMEOUT. Client errors (BAD_REQUEST, UNAUTHORIZED) omit the message to prevent leaking internal details.

4. **I4: Slow queries at WARN** — Requests taking >500ms are logged at WARN even on success. This threshold applies to both successful responses and errors.

5. **I5: Non-TRPCError always ERROR** — Unexpected errors (not instanceof TRPCError) are always logged at ERROR level with code "UNKNOWN". These represent unhandled exceptions.

6. **I6: requestId always present** — Every log entry includes requestId for correlation with Prisma queries and Redis operations.

7. **I7: userId optional** — userId appears in logs only for authenticated requests (ctx.session?.user?.id). Unauthenticated requests log userId as undefined.

## Gotchas

1. **x-forwarded-for is comma-separated** — When behind multiple proxies, the header contains a chain like `"client-ip, proxy1, proxy2"`. Always split and take the first element. Forgetting to split logs the entire chain as the IP.

2. **INTERNAL_SERVER_ERROR logs message, BAD_REQUEST does not** — This is intentional. Client errors (4xx codes) should not expose internal details. Only server errors (5xx codes) include `error.message` for debugging.

3. **Slow queries are WARN, not ERROR** — A 600ms response is slow but not an error. It still succeeds and returns data. Using ERROR for slow queries creates false positives in error monitoring.

4. **Auth failures are WARN, not ERROR** — Failed login attempts are expected behavior (users mistype passwords). Logging them at ERROR would spam error dashboards. WARN is sufficient for security monitoring.

5. **Latency includes middleware overhead** — The timer starts before AsyncLocalStorage propagation and ends after procedure completion. This includes tRPC framework overhead, not just application logic.

6. **Rate limit hit does not include remaining count** — The log entry shows that rate limiting occurred but not how close the user was to the limit. To add this, the rate limiter would need to return remaining count to the tRPC handler.

7. **Missing session means userId is undefined, not null** — `ctx.session?.user?.id` evaluates to undefined for unauthenticated requests. Log aggregation queries should check for both undefined and null when filtering by userId.

8. **Route format is "type.path"** — The route field concatenates query/mutation type with the procedure path, producing strings like `"query.user.getByUsername"` or `"mutation.tweet.create"`. This is not a file path.

9. **IP "unknown" does not mean local request** — If reverse proxy headers are misconfigured, all requests will log IP as "unknown". This is a deployment configuration issue, not a security event.

10. **Error.message may contain sensitive data** — Only server errors (INTERNAL_SERVER_ERROR, TIMEOUT) include error.message in logs. These should never be constructed from user input. Client errors omit the message to prevent logging PII or credentials from validation errors.
