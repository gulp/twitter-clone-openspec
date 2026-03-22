# Redis Failure Policy: Fail-Open vs Fail-Closed

## What

Redis failures are handled with two policies: **fail-closed** (reject the request, throw error) for security-critical paths, and **fail-open** (degrade gracefully, return null/empty/no-op) for performance optimizations. This prevents Redis outages from either becoming security incidents or taking down the entire application.

## Where

All Redis operations are wrapped in `src/server/redis.ts`:

**Fail-open wrappers:**
- `src/server/redis.ts:36-49` — `cacheGet` returns null on failure
- `src/server/redis.ts:55-72` — `cacheSet` no-op on failure
- `src/server/redis.ts:78-90` — `cacheDel` no-op on failure
- `src/server/redis.ts:96-109` — `cacheIncr` returns null on failure
- `src/server/redis.ts:186-198,204-216,222-233` — session allow-list wrappers
- `src/server/redis.ts:240-288` — SSE connection tracking
- `src/server/redis.ts:295-372` — unread notification count operations
- `src/server/redis.ts:379-445` — SSE sequence and replay buffer

**Fail-closed wrapper:**
- `src/server/redis.ts:119-180` — `authRateLimitCheck` re-throws "Rate limiting unavailable"

Rate limiter service at `src/server/services/rate-limiter.ts`:
- `src/server/services/rate-limiter.ts:98-120` — fail-closed/fail-open decision based on `failClosed` parameter
- `src/server/services/rate-limiter.ts:20-24` — `RATE_LIMITS` presets specify `failClosed` flag

## How It Works

Each Redis operation category is wrapped with try-catch. The catch block logs the error with structured data and either returns a safe default (fail-open) or re-throws (fail-closed).

### Fail-Open Pattern

```typescript
// src/server/redis.ts:36-49
export async function cacheGet(key: string, requestId?: string): Promise<string | null> {
  try {
    return await redis.get(key);
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "cache",
      operation: "GET",
      key,
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return null;
  }
}
```

**Fallback behavior:** Caller treats `null` as cache miss and queries PostgreSQL. Example: feed assembly at `src/server/services/feed.ts` checks cache, then falls through to DB query.

**No-op example:**

```typescript
// src/server/redis.ts:78-90
export async function cacheDel(key: string, requestId?: string): Promise<void> {
  try {
    await redis.del(key);
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "cache",
      operation: "DEL",
      key,
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
  }
}
```

Cache invalidation is best-effort. If it fails, stale data remains until TTL expires. This is acceptable for read-heavy features like feed caching and follow suggestions.

### Fail-Closed Pattern

```typescript
// src/server/services/rate-limiter.ts:98-120
try {
  const result = await redis.eval(luaScript, ...);
  return { allowed: result[0] === 1, retryAfter: result[1] || undefined };
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (failClosed) {
    // FAIL CLOSED: reject request on Redis failure (security-critical paths)
    log.error("Rate limiter Redis failure (fail closed)", {
      feature: "rate-limit",
      scope,
      identifier,
      error: errorMessage,
    });
    throw new Error("Rate limiting unavailable");
  }

  // FAIL OPEN: allow request on Redis failure (graceful degradation)
  log.warn("Rate limiter Redis failure (fail open)", {
    feature: "rate-limit",
    scope,
    identifier,
    error: errorMessage,
  });
  return { allowed: true };
}
```

Auth endpoints use `failClosed: true` (`src/server/services/rate-limiter.ts:21`). When Redis is down, rate limiter throws, auth routers catch and convert to `INTERNAL_SERVER_ERROR` (`src/server/trpc/routers/auth.ts:63-72`).

**Why fail closed for auth?** Allowing unlimited login/registration attempts during a Redis outage turns the outage into a credential-stuffing or account-enumeration incident. Better to degrade auth availability than compromise security.

### Policy Decision Table (from godfile)

From `plans/twitter-clone.md:1578-1586`:

| Subsystem | On failure | Action |
|-----------|-----------|--------|
| Redis (auth rate-limit) | Connection lost | **Reject request** (fail closed). Log ERROR. |
| Redis (cache/SSE/unread) | Connection lost | **Degrade** (fail open). Cache miss → DB. SSE → poll. Unread → COUNT(*). Log WARN. |

## Invariants

1. **I-RF1:** All Redis operations MUST be wrapped in try-catch. Bare `await redis.get()` without catch is a bug.
2. **I-RF2:** Fail-closed operations MUST log at ERROR level. Fail-open operations MUST log at WARN level.
3. **I-RF3:** Auth rate limiting (login, registration, password reset) MUST fail closed. No exceptions.
4. **I-RF4:** Feed cache, SSE, session allow-list, unread counts MUST fail open. These are performance optimizations, not correctness requirements.
5. **I-RF5:** Redis failure logs MUST include `feature`, `operation`, `error`, and `requestId` fields for correlation.
6. **I-RF6:** Fail-open wrappers return safe defaults: `null` for reads, `void` for writes, `[]` for lists, `0` for counts where caller can handle it.

## Gotchas

**Don't fail closed for read-path rate limiting.** If you add rate limiting to `/api/timeline`, use `failClosed: false`. The preset is `GENERAL_API: { failClosed: false }` for this reason. Only auth endpoints where account abuse is the risk should fail closed.

**Session allow-list is fail-open, but JWT validation still works.** When `sessionGet` returns null due to Redis failure, NextAuth falls back to JWT signature verification and `sessionVersion` DB lookup (`src/server/auth.ts`). This is why session checks can degrade gracefully — Redis is a fast-path cache, not the source of truth.

**Unread count fail-open means count can be stale or wrong.** If `incrUnreadCount` fails silently, the cached count drifts from reality. This is acceptable because the client can always query `notification.unreadCount` which does `COUNT(*)` against PostgreSQL as fallback. The cache is a performance hint, not a correctness guarantee.

**SSE publish failures don't break notifications.** SSE events are ephemeral and best-effort. If `sseAddToReplay` fails, clients miss real-time updates but can still poll `/api/trpc/notification.list` to get the full history. Notifications are persisted in PostgreSQL first, SSE second.

**Redis retry is built into ioredis, not app-level.** The client is configured with `maxRetriesPerRequest: 3` and exponential backoff (`src/server/redis.ts:15-19`). If all retries fail, the error propagates to the wrapper catch block. The application does NOT implement its own retry loop on top of this.

**Don't use Redis transactions (`MULTI`/`EXEC`) for fail-open operations.** Transactions fail atomically — if one command fails, all fail. Lua scripts (used in rate limiter) are atomic but still throw on Redis connection failure. For fail-open operations, use individual commands and catch each independently if needed.
