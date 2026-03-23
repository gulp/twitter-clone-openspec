# Error Handling: Subsystem Failure Policies

## What

Comprehensive error handling philosophy defining how each infrastructure subsystem (PostgreSQL, Redis, S3, Email, SSE) responds to failures. Every failure surfaces as a structured `TRPCError` to the client or a WARN/ERROR log with `requestId`. No silent swallows, no empty catch blocks, no `|| undefined` fallbacks masking broken queries.

## Where

- **Logging middleware:** `src/server/trpc/index.ts:56-129` — catches all tRPC errors, classifies by severity, logs with `requestId`
- **PostgreSQL:** Prisma throws on connection loss, surfaced as `INTERNAL_SERVER_ERROR` via tRPC logging middleware
- **Redis (auth rate-limit):** `src/server/services/rate-limiter.ts` — fail-closed on Redis failure (documented in `error-handling-redis-failure-policy.md`)
- **Redis (cache/SSE/unread):** Fail-open degradation (documented in `error-handling-redis-failure-policy.md`)
- **S3:** `src/server/s3.ts:46-69` — pre-sign failure logged, throws generic Error caught by tRPC
- **Email:** `src/server/services/email.ts` — fire-and-forget, logs ERROR on failure (documented in `security-email-timing-safety.md`)
- **SSE publish:** `src/server/services/sse-publisher.ts` — best-effort fan-out, logs WARN on Redis Pub/Sub failure

## How It Works

### Philosophy Statement

**Every failure surfaces.** No silent swallows. No empty catch blocks. No `|| undefined` fallbacks masking broken queries.

All errors propagate to the tRPC logging middleware (`src/server/trpc/index.ts:89-127`), which:
1. Logs all errors with `requestId`, `route`, `userId`, `latencyMs`, `errorCode`
2. Classifies errors by severity (WARN vs ERROR)
3. Re-throws to client as structured `TRPCError` or generic error

```typescript
// src/server/trpc/index.ts:92-127
if (error instanceof TRPCError) {
  const logData = { requestId, route, userId, latencyMs, errorCode: error.code, ip };

  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    log.warn("Auth failure", logData);
  } else if (error.code === "TOO_MANY_REQUESTS") {
    log.warn("Rate limit hit", logData);
  } else if (error.code === "INTERNAL_SERVER_ERROR" || error.code === "TIMEOUT") {
    log.error("tRPC error", { ...logData, message: error.message });
  } else {
    log.warn("tRPC error", logData);
  }
} else {
  // Non-tRPC errors (including Prisma, S3, uncaught exceptions)
  log.error("Unexpected error", { requestId, route, userId, latencyMs, errorCode: "UNKNOWN", message, ip });
}
throw error; // Always re-throw
```

### Per-Subsystem Behavior

#### PostgreSQL

**Policy:** Connection lost → Prisma throws → `INTERNAL_SERVER_ERROR`; log ERROR. No app-level retry.

Prisma manages its own connection pool internally. On connection failure, Prisma throws an error that propagates to the tRPC middleware, gets logged as "Unexpected error" (line 115), and surfaces to the client as a 500 error.

**Rationale:** Prisma's connection pool handles reconnection automatically. Application-level retries would duplicate this logic and risk amplifying load during partial outages. The client receives a clear error; they can retry at the request level.

**Implementation:** No explicit try-catch around Prisma queries. Errors bubble up naturally.

#### Redis (Auth Rate Limit)

**Policy:** Connection lost → **Reject request** (fail-closed). Log ERROR.

Rate limiting must fail closed to prevent abuse during Redis outages. Documented in `error-handling-redis-failure-policy.md`.

**Implementation:** `src/server/services/rate-limiter.ts` throws `TOO_MANY_REQUESTS` on Redis connection failure.

#### Redis (Cache / SSE / Unread Count)

**Policy:** Connection lost → **Degrade gracefully** (fail-open). Cache miss → fallback to DB. SSE → poll. Unread → `COUNT(*)`. Log WARN.

Non-critical Redis operations degrade gracefully to maintain availability. Documented in `error-handling-redis-failure-policy.md`.

**Implementation:**
- Feed cache: `src/server/services/feed.ts` — `.catch(() => null)` on `cacheGet`, treats as cache miss
- SSE: Client falls back to polling after 3 reconnect failures (`src/hooks/use-sse.ts:47-50`)
- Unread count: `src/server/trpc/routers/notification.ts` — `.catch()` on Redis, falls back to `COUNT(*)`

#### S3

**Policy:** Pre-sign failure → `INTERNAL_SERVER_ERROR` — "Upload temporarily unavailable". Log ERROR.

S3 pre-signing is a local cryptographic operation. Failures indicate misconfiguration (invalid credentials, wrong region) or SDK issues, not transient network problems. Retrying won't help.

**Implementation:** `src/server/s3.ts:46-69`

```typescript
// src/server/s3.ts:59-68
catch (error) {
  log.error("Failed to generate S3 pre-signed URL", {
    feature: "media",
    key,
    contentType,
    error: error instanceof Error ? error.message : String(error),
    requestId,
  });
  throw new Error("Failed to generate upload URL");
}
```

The generic `Error` is caught by tRPC middleware (line 114), logged as "Unexpected error", and surfaced as 500 to the client.

The mutation wrapper in `src/server/trpc/routers/media.ts:33-62` does not catch this error, allowing it to propagate.

#### Email (SMTP)

**Policy:** Send failure → Log ERROR. Do not block or retry. User can re-request password reset.

Email is fire-and-forget by design to prevent timing attacks. Documented in `security-email-timing-safety.md`.

**Implementation:** `src/server/services/email.ts` — SMTP failures logged but not surfaced to caller. The `requestPasswordReset` endpoint always returns success, regardless of email delivery.

**Rationale:** Retrying email sends risks exposing whether the recipient email exists (timing leak). Password reset tokens are valid for 1 hour; user can request a new one if they don't receive it.

#### SSE Publish

**Policy:** Pub/Sub failure → Log WARN. Notification persisted in DB — visible on next page load or poll.

SSE event publishing uses best-effort delivery via Redis Pub/Sub. If publishing fails (Redis down, network partition), the event is lost but the underlying data is already committed to PostgreSQL.

**Implementation:** `src/server/services/sse-publisher.ts:137-140` — `Promise.allSettled()` for fan-out, logs rejected promises at WARN level

```typescript
// Best-effort fan-out: log failures but don't throw
const results = await Promise.allSettled(publishPromises);
for (const [i, result] of results.entries()) {
  if (result.status === "rejected") {
    log.warn("SSE publish failed", { userId: followerIds[i], error: result.reason });
  }
}
```

**Rationale:** Notification rows are persisted in the database before SSE publishing. If SSE fails, the notification appears on next page load or when the client polls `/api/trpc/notification.list`. Throwing an error here would rollback the entire tweet creation, violating the principle that SSE is enhancement-only.

### Media URL Validation

**Policy:** Uploaded media URLs must belong to the user and come from our S3 bucket. Validation failures throw `BAD_REQUEST`.

**Implementation:** `src/server/trpc/routers/media.ts:98-135`

```typescript
// src/server/trpc/routers/media.ts:113-134
for (const url of urls) {
  // Verify URL is from our S3 bucket
  if (!url.startsWith(s3PublicUrl)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid media URL: must be from authorized storage" });
  }

  // Extract S3 key and verify user ownership
  const key = url.replace(`${s3PublicUrl}/`, "");
  const expectedPrefix = `${purpose}/${userId}/`;

  if (!key.startsWith(expectedPrefix)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid media URL: does not match user ownership" });
  }
}
```

**Orphan Handling:** If a user uploads media but never creates the tweet (closes browser, validation fails later), the S3 object remains as an orphan. No automatic cleanup in v1. S3 lifecycle policies (not implemented in v1) would handle this via TTL-based expiration for objects not referenced in the database.

### Retry Policy

**No application-level retries in v1.** Rationale per subsystem:
- **Prisma:** Manages its own connection pool and retries internally
- **Redis:** Idempotent operations self-heal on next request (feed version bumps, cache writes)
- **Email:** Fire-and-forget by design; user can re-request password reset
- **S3:** Pre-signing is a local crypto operation; retry won't fix configuration errors
- **SSE:** Best-effort delivery; missed events visible in database on next poll

Clients can retry failed requests at the HTTP level (tRPC client does this for network failures).

## Invariants

**I1. Error Surfacing:** Every infrastructure failure that affects request correctness is logged with ERROR or WARN severity and surfaces to the client as a `TRPCError` or generic 500 error. No silent failures.

**I2. Fail-Closed for Security:** Authentication rate limiting fails closed (rejects requests) on Redis outage to prevent brute-force attacks during infrastructure failures.

**I3. Fail-Open for Availability:** Non-critical features (feed cache, SSE, unread count cache) degrade gracefully on Redis outage, falling back to database queries or polling.

**I4. No Empty Catch Blocks:** All `.catch()` blocks either log the error or explicitly handle the fallback path. No `.catch(() => {})` swallowing errors without logging.

**I5. Media Ownership:** All media URLs stored in the database are validated to ensure they belong to the correct user and come from the authorized S3 bucket. No arbitrary URL injection.

**I6. S3 Orphans Accepted:** Uploaded-but-unused media objects are orphaned in S3 until cleaned up by lifecycle policies (not implemented in v1). This trades storage cost for implementation simplicity.

## Gotchas

**G1. Prisma Errors Not Caught:** Prisma connection failures are not caught explicitly. They propagate as generic `Error` instances to the tRPC middleware, which logs them as "Unexpected error" (line 115) with `errorCode: "UNKNOWN"`. The client receives a 500 error with no details. This is intentional — exposing database errors risks leaking schema information.

**G2. S3 Pre-Sign Throws Generic Error:** `src/server/s3.ts:67` throws `new Error("Failed to generate upload URL")` instead of `TRPCError`. This is caught by the tRPC middleware and surfaced as a 500 error. The specific S3 error is logged but not sent to the client.

**G3. Email Failure Silent to Caller:** Email send failures are logged but not thrown. The `requestPasswordReset` endpoint always returns success (200 OK) regardless of SMTP status. This prevents timing attacks but means users don't know if email delivery failed due to SMTP issues.

**G4. SSE Publish Best-Effort:** `Promise.allSettled()` for SSE fan-out means partial failures (some followers get the event, others don't) are possible. This is acceptable because the notification is persisted in the database. Followers who missed the SSE event see the notification on next page load.

**G5. No S3 Object Cleanup:** `validateMediaUrls()` verifies URL ownership but does not delete orphaned S3 objects. If a user uploads 4 images, then changes the tweet to only include 2, the unused 2 images remain in S3. S3 lifecycle policies (30-day TTL for unreferenced objects) would handle this in production.

**G6. Retry at Client Level Only:** The server performs no automatic retries. The tRPC client library handles network-level retries for transient connection failures, but business logic errors (500, Prisma errors, S3 failures) are not retried. The user must manually retry the request.

**G7. Redis Failure Mode Inconsistency:** Redis failures are handled inconsistently: auth rate limiting fails closed (throws `TOO_MANY_REQUESTS`), while cache/SSE/unread fail open (degrade to fallback). This is by design (security vs availability trade-off) but requires careful attention when adding new Redis-backed features. Default to fail-open unless the feature is security-critical.
