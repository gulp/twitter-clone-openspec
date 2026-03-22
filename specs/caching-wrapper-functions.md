# Redis Wrapper Functions

## What

All Redis operations go through typed wrapper functions in `src/server/redis.ts` that enforce consistent error handling, logging, and fail-open/fail-closed policies. Direct `redis.*` calls are prohibited outside of `redis.ts` (with three documented exceptions for SETNX locking and tombstone SADD).

## Where

- **Wrapper definitions:** `src/server/redis.ts:36-467`
- **Direct redis usage (exceptions):**
  - SETNX lock: `src/server/services/feed.ts:178`
  - Tombstone SADD: `src/server/trpc/routers/tweet.ts:258-259`

## How It Works

### Wrapper Categories

**1. Generic cache operations (fail-open):**
```typescript
// src/server/redis.ts:36-48
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
    return null; // Fail open — caller falls back to DB
  }
}
```

All cache wrappers (`cacheGet`, `cacheSet`, `cacheDel`, `cacheIncr`) return `null` or no-op on failure.

**2. Auth rate limiting (fail-closed):**
```typescript
// src/server/redis.ts:119-180
export async function authRateLimitCheck(
  scope: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
  requestId?: string
): Promise<{ allowed: boolean; remaining: number }> {
  const key = `rate:${scope}:${identifier}`;
  // ... atomic Lua script ...

  try {
    const result = await redis.eval(luaScript, 1, key, ...);
    return { allowed: result[0] === 1, remaining: result[1] };
  } catch (error) {
    log.error("Redis operation failed", {
      feature: "rate-limit",
      operation: "authRateLimitCheck",
      scope,
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    throw new Error("Rate limiting unavailable"); // FAIL CLOSED
  }
}
```

THROWS on Redis failure — prevents auth endpoint abuse during outages.

**3. Session allow-list (fail-open with DB fallback):**
```typescript
// src/server/redis.ts:186-197
export async function sessionGet(jti: string, requestId?: string): Promise<string | null> {
  try {
    return await redis.get(`session:jti:${jti}`);
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "auth",
      operation: "sessionGet",
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return null; // Caller falls back to JWT + sessionVersion DB check
  }
}
```

Session wrappers (`sessionGet`, `sessionSet`, `sessionDel`) fail open. Auth still works via DB.

**4. SSE connection tracking (fail-open):**
```typescript
// src/server/redis.ts:240-254
export async function sseAddConnection(userId: string, connectionId: string, requestId?: string): Promise<void> {
  try {
    const key = `sse:connections:${userId}`;
    await redis.sadd(key, connectionId);
    await redis.expire(key, 120); // 2-minute TTL
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "sse",
      operation: "sseAddConnection",
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    // No-op on failure
  }
}
```

All SSE wrappers fail open. SSE degrades to in-process EventEmitter only.

**5. Unread counts (fail-open with Lua floor):**
```typescript
// src/server/redis.ts:374-394
export async function decrUnreadCount(userId: string, requestId?: string): Promise<void> {
  try {
    const lua = `
      local key = KEYS[1]
      local val = redis.call('GET', key)
      if val and tonumber(val) > 0 then
        return redis.call('DECR', key)
      end
      return 0
    `;
    await redis.eval(lua, 1, `notification:unread:${userId}`);
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "unread",
      operation: "decrUnreadCount",
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    // No-op
  }
}
```

Lua script prevents negative counts (bare `DECR` can go negative).

### Direct Redis Exceptions

**SETNX locking** (best-effort, not wrapped):
```typescript
// src/server/services/feed.ts:174-186
const lockKey = `feed:${userId}:rebuilding`;
let acquiredLock = false;

try {
  const lockResult = await redis.set(lockKey, "1", "EX", 5, "NX");
  acquiredLock = lockResult === "OK";
} catch (error) {
  log.warn("Failed to acquire feed rebuild lock (fail open)", {
    userId,
    error: error instanceof Error ? error.message : String(error),
    requestId,
  });
}
// Continues regardless of lock acquisition
```

Not wrapped because the operation is inherently fail-open (no wrapper needed).

**Tombstone SADD** (direct for simplicity):
```typescript
// src/server/trpc/routers/tweet.ts:258-259
await redis.sadd("tombstones:tweets", tweetId);
await redis.expire("tombstones:tweets", 60);
```

Called from within a Prisma transaction. Not wrapped to avoid nested error handling.

## Invariants

1. **All reads return null-ish on failure** (never throw) — enables DB fallback
2. **All writes no-op on failure** (never throw) — cache writes are best-effort
3. **Auth rate limiting throws on failure** — prevents abuse during Redis outages
4. **Every wrapper logs to structured logger** with `feature`, `operation`, `error`, `requestId`
5. **Every wrapper accepts optional `requestId`** for request correlation (§1.19)
6. **Lua scripts are inlined** (not stored via `SCRIPT LOAD`) to avoid multi-instance desync
7. **Direct redis calls outside redis.ts require inline try-catch + log.warn**

## Gotchas

1. **Don't add generic `try { redis.get() } catch`** — use `cacheGet()` wrapper instead
2. **sessionGet null ≠ invalid session** — it means "check DB"; invalid JTI returns empty string
3. **decrUnreadCount uses Lua, not bare DECR** — bare DECR goes negative
4. **SETNX lock failure is not fatal** — feed rebuild proceeds anyway (fail-open)
5. **Tombstone SADD is deliberately unwrapped** — called in transaction, nested error handling unnecessary
6. **authRateLimitCheck is the ONLY wrapper that throws** — everything else degrades gracefully
7. **Wrappers do NOT retry** — retries are handled by ioredis `retryStrategy` (max 3, exponential backoff)
