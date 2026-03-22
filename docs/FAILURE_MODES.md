# Failure Modes & Error Handling

This document describes all known failure modes in the Twitter Clone application, their expected behavior, and how they are logged and handled.

## Table of Contents

1. [Failure Policies](#failure-policies)
2. [Redis Failures](#redis-failures)
3. [Database Failures](#database-failures)
4. [Rate Limiting Failures](#rate-limiting-failures)
5. [SSE Publishing Failures](#sse-publishing-failures)
6. [Email Service Failures](#email-service-failures)
7. [Media Upload Failures](#media-upload-failures)
8. [Feed Assembly Failures](#feed-assembly-failures)
9. [Authentication Failures](#authentication-failures)
10. [Logging Requirements](#logging-requirements)

---

## Failure Policies

### Fail Closed

**When to use:** Security-critical operations where degraded service is safer than allowing potentially compromised requests.

**Services that fail closed:**
- Auth rate limiting (login, registration, password reset)
- CSRF origin validation
- Session validation

**Behavior:**
- Log at ERROR level with requestId
- Throw error or return HTTP 500/503
- Block the request completely

### Fail Open

**When to use:** Performance optimizations and non-critical features where degraded service is better than complete failure.

**Services that fail open:**
- Redis caching (feeds, unread counts, tombstones)
- SSE connection tracking
- Feed version bumping
- Email sending

**Behavior:**
- Log at WARN level with requestId
- Continue operation with fallback (DB query, skip cache, etc.)
- Degrade gracefully without blocking the request

---

## Redis Failures

### Cache Operations (GET/SET/DEL/INCR)

**Failure Policy:** Fail open

**Expected Behavior:**
- Return `null` on GET failures → caller falls back to DB query
- No-op on SET/DEL failures → cache write is best-effort
- Return `null` on INCR failures → caller falls back to DB count

**Logging:**
```typescript
log.warn("Redis operation failed", {
  feature: "cache",
  operation: "GET" | "SET" | "DEL" | "INCR",
  key: string,
  error: string,
  requestId?: string,
});
```

**Test Coverage:** `tests/integration/security-logs.test.ts` - Redis degradation logs

### Session Operations (sessionGet/sessionSet/sessionDel)

**Failure Policy:** Fail open with DB fallback

**Expected Behavior:**
- `sessionGet` returns `null` → NextAuth falls back to JWT signature + DB sessionVersion check
- `sessionSet` is no-op → session allow-list is performance optimization only
- `sessionDel` is no-op → sessionVersion increment still invalidates

**Logging:**
```typescript
log.warn("Redis operation failed", {
  feature: "auth",
  operation: "sessionGet" | "sessionSet" | "sessionDel",
  error: string,
  requestId?: string,
});
```

### SSE Operations (sseAddConnection/sseRemoveConnection/sseGetConnections)

**Failure Policy:** Fail open

**Expected Behavior:**
- Operations are no-op on failure
- Return empty array for `sseGetConnections`
- SSE publishing falls back to in-memory EventEmitter

**Logging:**
```typescript
log.warn("Redis operation failed", {
  feature: "sse",
  operation: "sseAddConnection" | "sseRemoveConnection" | "sseGetConnections",
  error: string,
  requestId?: string,
});
```

### Unread Count Operations

**Failure Policy:** Fail open

**Expected Behavior:**
- `getUnreadCount` returns `null` → caller falls back to `COUNT(*)` query
- `setUnreadCount/incrUnreadCount/decrUnreadCount` are no-op → eventual consistency with DB

**Logging:**
```typescript
log.warn("Redis operation failed", {
  feature: "unread",
  operation: "getUnreadCount" | "setUnreadCount" | "incrUnreadCount" | "decrUnreadCount",
  count?: number,
  error: string,
  requestId?: string,
});
```

---

## Database Failures

### Prisma Query Errors

**Failure Policy:** Propagate to caller with structured logging

**Expected Behavior:**
- Log error with requestId correlation
- Throw error to tRPC handler
- Return INTERNAL_SERVER_ERROR to client

**Logging:**
```typescript
log.error("Prisma query error", {
  requestId: string,
  model: string,
  operation: string,
  latencyMs: number,
  error: string,
});
```

**Test Coverage:** Prisma middleware in `src/server/db.ts`

### Constraint Violations

**Expected Behavior:**
- P2002 (unique constraint) → handled as idempotent success or CONFLICT
- CHECK constraint violations → propagated as BAD_REQUEST
- Foreign key violations → NOT_FOUND or BAD_REQUEST

**Specific Handling:**
- Like/Retweet/Follow duplicate → idempotent success `{ success: true }`
- Notification deduplication → silent skip, return `null`
- Negative counts → caught by CHECK, logged as error

**Test Coverage:** `tests/integration/schema-invariants.test.ts`

---

## Rate Limiting Failures

### Auth Rate Limiting (Fail Closed)

**Failure Policy:** Fail closed - reject request on Redis failure

**Expected Behavior:**
- Throw error "Rate limiting unavailable"
- Converted to TRPCError INTERNAL_SERVER_ERROR in routers
- Client receives HTTP 500 with "Service temporarily unavailable"

**Logging:**
```typescript
log.error("Rate limiter Redis failure (fail closed)", {
  feature: "rate-limit",
  scope: string,
  identifier: string,
  error: string,
});
```

**Affected Endpoints:**
- `auth.register`
- `auth.requestReset`

**Test Coverage:** `tests/integration/rate-limit.test.ts`

### General API Rate Limiting (Fail Open)

**Failure Policy:** Fail open - allow request on Redis failure

**Expected Behavior:**
- Return `{ allowed: true }` on Redis failure
- Degrade gracefully, allow request through

**Logging:**
```typescript
log.warn("Rate limiter Redis failure (fail open)", {
  feature: "rate-limit",
  scope: string,
  identifier: string,
  error: string,
});
```

**Affected Endpoints:**
- `tweet.create`
- General API operations

---

## SSE Publishing Failures

### publishToUser Failure

**Failure Policy:** Fail open with in-memory fallback

**Expected Behavior:**
- Falls back to in-memory EventEmitter (tests only)
- Returns `null` sequence number
- Notification still persisted in DB

**Logging:**
```typescript
log.warn("SSE publishToUser failed, falling back to in-memory", {
  userId: string,
  eventType: string,
  error: string,
});
```

### publishToFollowers Failure

**Failure Policy:** Best-effort with partial success

**Expected Behavior:**
- Uses `Promise.allSettled` for parallel publishing
- Logs total and succeeded counts
- Returns `{ total: number, succeeded: number }`

**Logging:**
```typescript
log.error("publishToFollowers failed", {
  authorId: string,
  eventType: string,
  error: string,
});
```

### Lua Script Load Failure

**Failure Policy:** Fail fast at startup

**Expected Behavior:**
- Throws error during application startup
- Prevents application from starting
- Requires manual intervention

**Logging:**
```typescript
log.error("Failed to load SSE publish Lua script", {
  scriptPath: string,
  error: string,
});
```

---

## Email Service Failures

### Ethereal Test Account Creation Failure

**Failure Policy:** Fail fast at initialization

**Expected Behavior:**
- Throws "Email service unavailable"
- Prevents password reset flows from working
- Requires SMTP configuration or Ethereal availability

**Logging:**
```typescript
log.error("Failed to create Ethereal test account", {
  error: string,
});
```

### Password Reset Email Send Failure

**Failure Policy:** Fire-and-forget, fail open

**Expected Behavior:**
- Email send failures are logged but NOT thrown
- User still receives generic success response (anti-enumeration)
- Password reset token still created in DB

**Logging:**
```typescript
log.error("Failed to send password reset email", {
  to: string,
  error: string,
});
```

**Test Coverage:** `tests/integration/auth.test.ts` - requestReset timing safety

---

## Media Upload Failures

### Pre-signed URL Generation Failure

**Failure Policy:** Return TRPCError INTERNAL_SERVER_ERROR

**Expected Behavior:**
- S3 client errors logged
- User receives "Failed to generate upload URL"
- Client should retry or show error message

### Media URL Validation Failures

**Failure Policy:** Return TRPCError BAD_REQUEST

**Expected Behavior:**
- External URLs rejected: "Invalid media URL: must be from authorized storage"
- Wrong user prefix rejected: "Invalid media URL: does not match user ownership"
- Too many URLs (>4) rejected by Zod validation

**Test Coverage:** `tests/integration/security.test.ts` - media URL validation

---

## Feed Assembly Failures

### Invalid Cursor

**Failure Policy:** Return TRPCError BAD_REQUEST

**Expected Behavior:**
- Base64 decode failures caught
- Converted to TRPCError in feed router
- Client receives "Invalid cursor"

**Logging:**
```typescript
// parseFeedCursor throws Error("Invalid cursor")
// Caught in feed.home procedure and converted to TRPCError BAD_REQUEST
```

### Cache Miss / Version Mismatch

**Failure Policy:** Fail open, fetch from DB

**Expected Behavior:**
- Cache miss logged at INFO level with `cacheHit: false`
- Executes UNION query against PostgreSQL
- Acquires SETNX lock to prevent thundering herd
- Returns fresh data from DB

**Logging:**
```typescript
log.info("Feed cache miss", {
  userId: string,
  cacheHit: false,
  requestId: string,
});
```

### Feed Rebuild Lock Acquisition Failure

**Failure Policy:** Fail open, proceed without lock

**Expected Behavior:**
- Log warning
- Proceed with DB query anyway
- Multiple concurrent queries may occur (acceptable)

**Logging:**
```typescript
log.warn("Failed to acquire feed rebuild lock (fail open)", {
  userId: string,
  error: string,
  requestId: string,
});
```

---

## Authentication Failures

### Invalid Credentials

**Failure Policy:** Return generic error message

**Expected Behavior:**
- Same error for wrong email AND wrong password: "Invalid email or password"
- Timing-safe comparison using dummy hash when user not found
- No enumeration of valid emails

**Test Coverage:** `tests/integration/auth.test.ts`

### OAuth Sign-In Rejections

**Failure Policy:** Log and reject sign-in

**Expected Behavior:**
- No email provided → logged at WARN, return `false`
- Email not verified → logged at WARN, return `false`
- Auto-create user failure → logged at ERROR, return `false`

**Logging:**
```typescript
log.warn("OAuth sign-in rejected: no email provided", {
  provider: string,
});

log.warn("OAuth sign-in rejected: email not verified", {
  provider: string,
  email: string,
});

log.error("Failed to auto-create OAuth user", {
  provider: string,
  email: string,
  error: string,
});
```

### Session Invalidation

**Expected Behavior:**
- `logoutAll` increments sessionVersion → all JWT tokens with stale `sv` rejected
- `completeReset` increments sessionVersion → all existing sessions invalidated
- Redis session deletion is best-effort; DB sessionVersion is authoritative

**Test Coverage:** `tests/integration/security.test.ts` - session invalidation

---

## Logging Requirements

### All Logs Must Include

1. **Structured Format:** JSON with consistent schema
2. **Request Correlation:** `requestId` when available (from tRPC context or AsyncLocalStorage)
3. **Feature Tag:** `feature: "cache" | "auth" | "sse" | "rate-limit" | "unread" | etc.`
4. **Operation:** Specific operation name for debugging
5. **Error Message:** Human-readable error string

### Sensitive Data Redaction

**Never log:**
- `password` (always `[REDACTED]`)
- `hashedPassword` (always `[REDACTED]`)
- `token` / `access_token` / `refresh_token` (always `[REDACTED]`)
- Raw bcrypt hashes (regex: `/\$2[ayb]\$/`)

**Test Coverage:** `tests/integration/security-logs.test.ts` - log redaction

### Log Levels

- **ERROR:** Fail-closed scenarios, unexpected exceptions, data corruption
- **WARN:** Fail-open degradations, rate limits hit, CSRF rejections
- **INFO:** Normal operations, cache hits/misses, successful requests

### Request ID Propagation

All tRPC procedures include `requestId` in context:
- Generated in `createTRPCContext` (UUIDv4)
- Stored in AsyncLocalStorage for Prisma correlation
- Included in all structured logs

**Example:**
```typescript
export async function createTRPCContext(opts: FetchCreateContextFnOptions) {
  const session = await getServerSession(authOptions);
  const requestId = randomUUID();

  return {
    session,
    requestId,
    req: opts.req,
  };
}
```

---

## Testing Strategy

### Integration Tests

All failure modes are tested with:
- Real PostgreSQL database (CHECK constraints, FTS, etc.)
- Real Redis degradation scenarios
- Log capture and assertion
- No mocks for critical paths

**Test Files:**
- `tests/integration/security.test.ts` - CSRF, session invalidation, information disclosure
- `tests/integration/schema-invariants.test.ts` - DB constraints, deleted tweet filtering
- `tests/integration/security-logs.test.ts` - Structured logging, requestId correlation, redaction

### Diagnostics in Production

All failures are diagnosable without leaking sensitive data:
- Logs include enough context (feature, operation, key names)
- requestId enables end-to-end tracing
- Error messages are user-friendly but generic (anti-enumeration)
- Secrets are redacted before logging

---

## Summary

The application has **zero silent failures**:
- Every error path has structured logging
- Every catch block either logs or rethrows
- Redis failures degrade gracefully with clear log traces
- Database errors are correlated via requestId
- Rate limiting failures are visible and actionable
- All logs are diagnosable without exposing secrets

**Key Principle:** "Fail visibly" — no errors are swallowed without logging. Operators can trace any failure from client error through logs back to root cause.
