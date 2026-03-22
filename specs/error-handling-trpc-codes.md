# TRPCError Code Hierarchy

## What

The application uses tRPC's standardized error codes to communicate failures to clients. Each code maps to an HTTP status and signals a specific failure class. All errors thrown in procedures must be `TRPCError` instances to ensure consistent client-side handling.

## Where

Error throwing occurs throughout:
- `src/server/trpc/index.ts:144` — UNAUTHORIZED check in protectedProcedure
- `src/server/trpc/routers/auth.ts:58-61,84-86,96-98` — CONFLICT for registration uniqueness
- `src/server/trpc/routers/auth.ts:164-167` — TOO_MANY_REQUESTS for rate limit hits
- `src/server/trpc/routers/tweet.ts:50-53,70-73,76-80` — BAD_REQUEST for invalid operations
- `src/server/trpc/routers/tweet.ts:210-213,320-323` — NOT_FOUND for missing resources
- `src/server/trpc/routers/tweet.ts:222-227` — FORBIDDEN for authorization failures
- `src/server/trpc/routers/engagement.ts:45-48,178-181` — BAD_REQUEST for self-engagement blocks
- `src/server/trpc/routers/social.ts:36-40` — BAD_REQUEST for self-follow

Logging middleware at `src/server/trpc/index.ts:87-110` categorizes errors by code.

## How It Works

The tRPC middleware intercepts all thrown errors and logs them with appropriate severity:

```typescript
// src/server/trpc/index.ts:87-110
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

### Error Code Usage

**UNAUTHORIZED** (HTTP 401)
- Missing session in protected procedure (`src/server/trpc/index.ts:144`)
- Never used for wrong password — that's BAD_REQUEST per spec

**FORBIDDEN** (HTTP 403)
- User authenticated but lacks permission for the resource
- Example: `src/server/trpc/routers/tweet.ts:222-227` — deleting another user's tweet

**BAD_REQUEST** (HTTP 400)
- Invalid input that passed Zod validation but violates business rules
- Examples:
  - Self-follow: `src/server/trpc/routers/social.ts:36-40`
  - Self-retweet: `src/server/trpc/routers/engagement.ts:176-181`
  - Empty tweet: `src/server/trpc/routers/tweet.ts:48-53`
  - Replying to deleted tweet: `src/server/trpc/routers/tweet.ts:76-80`

**NOT_FOUND** (HTTP 404)
- Resource does not exist or is soft-deleted
- Example: `src/server/trpc/routers/tweet.ts:319-323` — deleted tweets return NOT_FOUND

**CONFLICT** (HTTP 409)
- Resource uniqueness violation
- Example: `src/server/trpc/routers/auth.ts:82-86,94-99` — email/username already taken

**TOO_MANY_REQUESTS** (HTTP 429)
- Rate limit exceeded
- Example: `src/server/trpc/routers/auth.ts:58-61` — auth rate limit hit
- Always includes `retryAfter` in message per `src/server/services/rate-limiter.ts:13-14`

**INTERNAL_SERVER_ERROR** (HTTP 500)
- Unexpected failure or degraded service
- Example: `src/server/trpc/routers/auth.ts:66-69` — rate limiter unavailable (Redis down)

## Invariants

1. **I-E1:** All procedure errors MUST be `TRPCError` instances. Non-TRPCError exceptions are logged as UNKNOWN and re-thrown.
2. **I-E2:** Error messages MUST be user-facing (no stack traces, no SQL, no internal IDs in message field).
3. **I-E3:** UNAUTHORIZED is for missing auth. FORBIDDEN is for insufficient permissions. Never swap these.
4. **I-E4:** NOT_FOUND is used for both nonexistent and soft-deleted resources (I5 — deleted tweets indistinguishable from missing).
5. **I-E5:** Rate limit errors MUST include `retryAfter` seconds in the message.
6. **I-E6:** INTERNAL_SERVER_ERROR is logged at ERROR level. All other TRPCErrors at WARN.

## Gotchas

**Don't use NOT_FOUND for authorization failures.** If a tweet exists but the user can't access it due to permissions, use FORBIDDEN, not NOT_FOUND. (Though v1 has no tweet privacy, so this doesn't currently apply.)

**Deleted resources are NOT_FOUND, not CONFLICT or BAD_REQUEST.** Replying to a deleted tweet: `src/server/trpc/routers/tweet.ts:76-80` throws BAD_REQUEST with explicit message "Cannot reply to a deleted tweet". This is intentional — NOT_FOUND would leak deletion status to observers. BAD_REQUEST signals "you can see it's deleted but can't interact."

**Error code determines log level, not message content.** The logging middleware uses error.code to decide WARN vs ERROR. Custom log calls must match this policy or use the procedure-level logger.

**Rate limiting failure converts to INTERNAL_SERVER_ERROR.** When Redis is down and rate limiter throws "Rate limiting unavailable", auth routers catch and rethrow as INTERNAL_SERVER_ERROR (`src/server/trpc/routers/auth.ts:64-71`). This prevents leaking "rate limiter is broken" to attackers.
