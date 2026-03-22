# Error Handling & Failure Modes

This document catalogs all error handling policies and failure modes in the Twitter Clone application.

## Philosophy

- **No silent failures**: Every error path produces structured log output
- **Diagnostics over silence**: Failed operations log at appropriate level (WARN/ERROR) with requestId context
- **Fail-open vs fail-closed**: Different subsystems have different availability requirements
- **Structured logging**: All logs use the structured logger (`@/lib/logger`) with feature/operation/requestId context

## Redis Failure Policies

### Fail Closed (Security-Critical)

**Auth rate limiting** (`checkAuthIPRateLimit` in `services/rate-limiter.ts`):
- **Policy**: RETHROW errors — reject request on Redis failure
- **Rationale**: Allowing auth requests without rate limiting turns a Redis outage into an account-abuse incident
- **Log level**: ERROR
- **User-facing**: `"Rate limiting unavailable"` error (converted to `INTERNAL_SERVER_ERROR` in auth router)

### Fail Open (Graceful Degradation)

All other Redis operations degrade gracefully and return null/no-op on failure:

**Cache operations** (`cacheGet`, `cacheSet`, `cacheDel`, `cacheIncr`):
- **Policy**: Return null or no-op on failure
- **Fallback**: Query PostgreSQL directly
- **Log level**: WARN
- **Fields**: `feature: "cache"`, `operation`, `key`, `error`, `requestId`

**Session operations** (`sessionGet`, `sessionSet`, `sessionDel`):
- **Policy**: Return null or no-op on failure
- **Fallback**: JWT signature validation + `sessionVersion` DB check
- **Log level**: WARN
- **Fields**: `feature: "auth"`, `operation`, `error`, `requestId`

**SSE operations** (`sseAddConnection`, `sseRemoveConnection`, `sseGetConnections`, `sseNextSeq`, `sseAddToReplay`, `sseGetReplay`):
- **Policy**: Return empty array or no-op on failure
- **Fallback**: In-memory EventEmitter for SSE publish, local sequence for `sseNextSeq`
- **Log level**: WARN
- **Fields**: `feature: "sse"`, `operation`, `error`, `requestId`

**Unread counts** (`getUnreadCount`, `setUnreadCount`, `incrUnreadCount`, `decrUnreadCount`):
- **Policy**: Return null or no-op on failure
- **Fallback**: DB COUNT(*) query for `getUnreadCount`
- **Log level**: WARN
- **Fields**: `feature: "unread"`, `operation`, `error`, `requestId`

**Feed tombstones** (`redis.sadd("tombstones:tweets", ...)`):
- **Policy**: No-op on failure
- **Fallback**: Stale cache entries may show deleted tweets until TTL expires (60s)
- **Log level**: WARN
- **Fields**: `feature: "tombstones"`, `tweetId`, `error`, `requestId`

## SSE Publisher Failures

**`publishToUser` / `publishToFollowers` / `publishNewTweet` / `publishNotification` / `publishTweetDeleted`**:
- **Policy**: Fallback to in-memory EventEmitter on Redis failure
- **Persistence**: Notification still persisted in DB (SSE publish is post-commit)
- **Log level**: WARN (Redis failure), INFO (successful publish)
- **Fields**: `userId`, `eventType`, `seq`, `error`

**Lua script load failure** (`loadPublishScript`):
- **Policy**: THROW error — SSE publish unavailable
- **Log level**: ERROR
- **Fields**: `scriptPath`, `error`

## Email Send Failures

**`sendPasswordResetEmail`**:
- **Policy**: Fire-and-forget — log error but do NOT throw
- **Rationale**: Prevents timing attacks on password reset (§1.4)
- **Log level**: ERROR (failure), INFO (success)
- **Fields**: `to`, `messageId`, `previewUrl`, `error`

**Email transporter initialization**:
- **Policy**: THROW error — email service unavailable
- **Log level**: ERROR (Ethereal failure), INFO (success)
- **Fields**: `mode`, `user`, `previewUrl`, `error`

## S3 Pre-Signed URL Failures

**`getUploadUrl`**:
- **Policy**: THROW `"Failed to generate upload URL"`
- **Converts to**: `INTERNAL_SERVER_ERROR` in media router
- **Log level**: ERROR
- **Fields**: `feature: "media"`, `key`, `contentType`, `error`, `requestId`

## Notification Creation Failures

**`createNotification`**:
- **Self-suppression** (I6): Return null silently if `recipientId === actorId`
- **Deduplication**: Return null silently on P2002 (unique constraint on `dedupeKey`)
- **Unexpected errors**: Log ERROR before re-throwing
- **Log fields**: `recipientId`, `actorId`, `type`, `tweetId`, `error`

## Engagement Failures (like, retweet)

**`like` / `retweet` procedures**:
- **Idempotent**: Return `{ success: true }` silently on P2002 (already liked/retweeted)
- **Unexpected errors**: Log ERROR before re-throwing
- **Log fields**: `userId`, `tweetId`, `error`, `requestId`

**`unlike` / `undoRetweet` procedures**:
- **Idempotent**: Return `{ success: true }` silently on P2025 (concurrent unlike/undoRetweet race)
- **Rationale**: Between the existence check and the delete transaction, a concurrent request may win the race

## Social Graph Failures (follow)

**`follow` procedure**:
- **Idempotent**: Return `{ success: true }` silently on P2002 (already following)
- **Unexpected errors**: Log ERROR before re-throwing
- **Log fields**: `followerId`, `followingId`, `error`, `requestId`

**`unfollow` procedure**:
- **Idempotent**: Return `{ success: true }` silently on P2025 (concurrent unfollow race)

## Registration Failures

**`register` procedure**:
- **Concurrent race**: Catches P2002 on `prisma.user.create` and returns field-specific error (`"Email already in use"` or `"Username already taken"`) based on the violated constraint's `meta.target`
- **Rationale**: Between the uniqueness check and the create, a concurrent registration may claim the same email/username

## Feed Assembly Failures

**`assembleFeed`**:
- **Cache miss**: Log INFO, fall through to PostgreSQL query
- **Cache failure**: Log WARN, degrade to PostgreSQL
- **SETNX lock failure**: Log WARN, continue without lock (cache write is best-effort)
- **Tombstone fetch failure**: Return empty Set, continue
- **JSON parse failure** (cached data or replay buffer): Return null/empty array, continue

**`parseFeedCursor`**:
- **Invalid cursor**: THROW `"Invalid cursor"` (converted to `BAD_REQUEST`)

## Search Cursor Failures

**`tweets` / `users` procedures**:
- **Invalid cursor**: THROW `TRPCError` with `code: "BAD_REQUEST"`, `message: "Invalid cursor"`
- **Intentional**: Cursor parsing errors are validation failures, not internal errors

## Prisma Connection Failures

**All database operations**:
- **Policy**: Prisma errors propagate as TRPCError automatically via tRPC's error formatter
- **Log level**: ERROR (application-level errors only)
- **Note**: Prisma connection errors are handled by Prisma's built-in retry logic and connection pooling

## Empty Catch Blocks (Intentional)

The following empty catch blocks are **intentional** and documented:

1. **`redis.ts:431`** — JSON parsing fallback in `sseGetReplay` filter
   - Falls back to `false` on parse failure, excluding malformed events from replay

2. **`search.ts:71-76, 96-101`** — Cursor validation
   - Invalid cursor throws `TRPCError` with `BAD_REQUEST` code

3. **`social.ts:284-286`** — Cache JSON parsing fallback in `getSuggestions`
   - Falls back to DB query on parse failure

## Log Redaction

All logs automatically redact sensitive fields:
- `password` → `[REDACTED]`
- `hashedPassword` → `[REDACTED]`
- `token` → `[REDACTED]`
- `access_token` → `[REDACTED]`
- `refresh_token` → `[REDACTED]`

Redaction is implemented in `LogCapture` helper (tests) and the structured logger (production).

## Verification

Integration tests verify:
- All error paths produce structured log output (`tests/integration/security-logs.test.ts`)
- Redis degradation paths log at WARN/ERROR with requestId
- No sensitive data leaked in logs
- DB invariants enforced (`tests/integration/schema-invariants.test.ts`)
- Security controls exercised end-to-end (`tests/integration/security.test.ts`)

## Monitoring Recommendations

1. **Alert on ERROR logs** with `feature: "media"` or `feature: "email"` — indicates infrastructure issues
2. **Alert on high volume of WARN logs** with `feature: "cache"` — indicates Redis degradation
3. **Alert on any ERROR log** with `feature: "rate-limit"` — indicates Redis failure blocking auth
4. **Track `requestId` correlation** for multi-operation debugging
5. **Monitor TTL of tombstones:tweets** — if Redis fails, deleted tweets may appear for up to 60s

## Summary

| Feature | Failure Mode | Policy | Log Level | Fallback |
|---------|--------------|--------|-----------|----------|
| Auth rate limiting | Redis unavailable | Fail closed (THROW) | ERROR | None — reject request |
| Cache | Redis unavailable | Fail open (return null) | WARN | PostgreSQL query |
| Sessions | Redis unavailable | Fail open (return null) | WARN | JWT + DB sessionVersion |
| SSE | Redis unavailable | Fail open (in-memory) | WARN | EventEmitter |
| Unread counts | Redis unavailable | Fail open (return null) | WARN | DB COUNT(*) |
| Tombstones | Redis unavailable | Fail open (no-op) | WARN | Stale cache (60s TTL) |
| Email | SMTP failure | Fire-and-forget | ERROR | None — log only |
| S3 | Pre-sign failure | THROW | ERROR | None — user gets error |
| Notifications | Unexpected error | Log + THROW | ERROR | None — propagate |
| Engagement (like/rt) | P2002 duplicate | Idempotent success | — | Silent |
| Engagement (unlike/undo) | P2025 race | Idempotent success | — | Silent |
| Social (follow) | P2002 duplicate | Idempotent success | — | Silent |
| Social (unfollow) | P2025 race | Idempotent success | — | Silent |
| Registration | P2002 race | Field-specific error | — | User sees conflict message |
| Engagement/Social | Unexpected error | Log + THROW | ERROR | None — propagate |
