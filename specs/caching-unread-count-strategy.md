# Unread Notification Count Caching Strategy

## What

Unread notification counts are cached in Redis with automatic DB fallback and backfill. The cache acts as a performance optimization that gracefully degrades to accurate DB counts when Redis is unavailable.

This pattern avoids expensive `COUNT(*)` queries on every notification bell render while maintaining correctness through automatic cache invalidation on read/unread actions.

## Where

**Redis operations:**
- `src/server/redis.ts:316-329` — `getUnreadCount()` with fail-open null return
- `src/server/redis.ts:337-350` — `setUnreadCount()` with fail-open no-op
- `src/server/redis.ts:352-390` — `decrUnreadCount()` with Lua atomicity (floored at 0)

**Cache consumer:**
- `src/server/trpc/routers/notification.ts:69-90` — `unreadCount` query with cache-aside pattern
- `src/server/trpc/routers/notification.ts:96-120` — `markRead` decrements cache via Lua script
- `src/server/trpc/routers/notification.ts:122-154` — `markAllRead` clears cache (sets to 0)

**Redis key pattern:**
- `notification:unread:{userId}` — String value, no TTL, updated transactionally

## How It Works

### 1. Cache-Aside Read Pattern

```typescript
// src/server/trpc/routers/notification.ts:69-90
unreadCount: protectedProcedure.query(async ({ ctx }) => {
  const userId = ctx.session.user.id;

  // Try Redis cache first
  const cachedCount = await getUnreadCount(userId);
  if (cachedCount !== null) {
    return { count: cachedCount };
  }

  // Fallback to DB count
  const dbCount = await prisma.notification.count({
    where: {
      recipientId: userId,
      read: false,
    },
  });

  // Backfill Redis cache
  await setUnreadCount(userId, dbCount);

  return { count: dbCount };
})
```

**Flow:**
1. **Cache hit** (cachedCount is number) → return immediately
2. **Cache miss** (cachedCount is null) → query DB, backfill cache, return DB count
3. **Redis failure** (exception caught in `getUnreadCount`) → null return, triggers DB fallback

### 2. Cache Invalidation on Writes

**Decrement on markRead:**
```typescript
// src/server/trpc/routers/notification.ts:96-120
markRead: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
  // ... update notification.read = true in DB ...

  // Decrement unread count (Lua script, floored at 0)
  await decrUnreadCount(userId);

  // ... SSE event, cache invalidation ...
})
```

Uses `redis.ts:352-390` Lua script to atomically decrement with floor at 0:
```lua
local key = KEYS[1]
local current = redis.call('GET', key)
if current then
  local val = tonumber(current)
  if val and val > 0 then
    redis.call('SET', key, val - 1)
  end
end
return 0
```

**Clear on markAllRead:**
```typescript
// src/server/trpc/routers/notification.ts:122-154
markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
  // ... update all notifications where read = false ...

  // Set unread count to 0
  await setUnreadCount(userId, 0);

  // ... SSE event ...
})
```

### 3. Fail-Open Error Handling

**getUnreadCount:**
```typescript
// src/server/redis.ts:316-329
export async function getUnreadCount(userId: string, requestId?: string): Promise<number | null> {
  try {
    const count = await redis.get(`notification:unread:${userId}`);
    return count ? Number.parseInt(count, 10) : null;
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "unread",
      operation: "getUnreadCount",
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return null; // Caller treats this as cache miss → DB fallback
  }
}
```

**setUnreadCount / decrUnreadCount:**
```typescript
// src/server/redis.ts:337-350, 352-390
// Both catch exceptions and log.warn but return void/0
// Failures are silent — cache becomes stale but DB remains source of truth
```

### 4. No TTL — Explicit Invalidation Only

Unlike feed cache (60s TTL) or suggestions (5min TTL), unread counts have **no expiration**:
- Cache persists indefinitely until explicit invalidation
- Rationale: unread count changes are deterministic (only via markRead/markAllRead)
- No risk of stale data from external DB updates (notifications are append-only)

**Cache lifecycle:**
1. First `unreadCount` query → DB fallback → backfill cache
2. `markRead` → decrement cache
3. `markAllRead` → set cache to 0
4. New notification created → increment happens via `createNotification` service

**Increment on notification creation:**
```typescript
// src/server/services/notification.ts:55-60
// After prisma.notification.create:
const currentCount = await getUnreadCount(recipientId);
if (currentCount !== null) {
  await setUnreadCount(recipientId, currentCount + 1);
}
```

## Invariants

**I1:** `getUnreadCount()` MUST return `null` on Redis failure or cache miss (not `0` or throw).

**I2:** Callers of `getUnreadCount()` MUST treat `null` as cache miss and query DB with `COUNT(*)`.

**I3:** `decrUnreadCount()` MUST use Lua script to prevent race condition with concurrent markRead operations.

**I4:** `decrUnreadCount()` MUST floor at 0 (never go negative, even if Redis count drifts out of sync with DB).

**I5:** Unread count cache MUST NOT have a TTL — it is invalidated explicitly on writes.

**I6:** Cache write failures (setUnreadCount, decrUnreadCount) MUST fail-open (log.warn, no throw).

**I7:** After markAllRead, cache MUST be set to `0`, not deleted (DELETE would cause next read to trigger DB COUNT).

## Gotchas

### Cache Drift from Concurrent Updates

**Scenario:** User has two browser tabs. Tab A calls `markRead(notif1)`, tab B calls `markRead(notif2)` concurrently.

**Behavior:**
1. Both tabs read current count from cache (e.g., 5)
2. Both call `decrUnreadCount()` → Lua script decrements twice → cache = 3
3. DB has 3 unread notifications remaining → **cache matches DB** ✅

**Why it works:** Lua script atomicity ensures sequential decrements even with concurrent requests.

**Where it breaks:** If `markRead` mutation fails after `decrUnreadCount()` succeeds:
1. Cache decremented to 3
2. DB update throws (network failure, constraint violation, etc.)
3. Notification still marked unread in DB
4. Cache = 3, DB unread count = 4 → **drift** ❌

**Mitigation:** Next `unreadCount` query with cache miss will backfill with accurate DB count.

### Increment Race on Notification Creation

**Scenario:** Two notifications created concurrently for same user.

**createNotification flow:**
```typescript
// src/server/services/notification.ts:55-60
const currentCount = await getUnreadCount(recipientId);  // Read
if (currentCount !== null) {
  await setUnreadCount(recipientId, currentCount + 1);   // Write
}
```

**Race:**
1. Thread A reads count = 5
2. Thread B reads count = 5
3. Thread A sets count = 6
4. Thread B sets count = 6 (overwrites A's increment)
5. Cache = 6, DB has 7 unread → **drift** ❌

**Frequency:** Low (notifications are infrequent, multi-notification bursts are rare).

**Mitigation:** Cache miss on next `unreadCount` query triggers DB backfill. Drift is temporary.

**Alternative (not implemented):** Use `INCR` instead of GET+SET, but requires separate handling for initial backfill.

### Cache Miss After markAllRead

**Scenario:** User marks all read, then immediately queries unread count, but Redis is down.

**Flow:**
1. `markAllRead` → `setUnreadCount(userId, 0)` fails silently (fail-open)
2. `unreadCount` query → `getUnreadCount(userId)` returns null (Redis down)
3. DB COUNT → returns 0 (notifications marked read)
4. Backfill → `setUnreadCount(userId, 0)` fails again

**Result:** User sees correct count (0), but cache never backfills until Redis recovers.

**Impact:** Extra DB queries until Redis comes back. No correctness issue.

### Lua Script Idempotency

**decrUnreadCount Lua script:**
```lua
local current = redis.call('GET', key)
if current then
  local val = tonumber(current)
  if val and val > 0 then
    redis.call('SET', key, val - 1)
  end
end
```

**Edge cases:**
- Key doesn't exist → no-op (cache miss, will backfill on next read)
- Value is "0" → no-op (already at floor)
- Value is non-numeric → no-op (corrupted cache, will backfill on next read)
- Value is negative (shouldn't happen) → no-op (floor enforcement)

**Idempotency:** Calling `decrUnreadCount` multiple times for same notification won't cause negative counts, but cache will drift if retried after successful decrement. Mutations should not retry blindly.

### No Batch API

**Problem:** Fetching unread counts for multiple users (e.g., admin dashboard) requires N queries.

**Current limitation:** No `getBatchUnreadCount(userIds[])` function.

**Workaround:** Use `redis.mget()` for batch reads, but still requires individual backfills on cache miss.

**Not implemented in v1** — single-user queries only.

## Testing

### Verify Cache Hit

```typescript
// Set cache directly
await redis.set("notification:unread:userId123", "5");

// Query should return cached value
const result = await caller.notification.unreadCount();
expect(result.count).toBe(5);

// DB should not be queried (check with Prisma.$queryRaw spy)
```

### Verify DB Fallback

```typescript
// Clear cache
await redis.del("notification:unread:userId123");

// Create 3 unread notifications in DB
// ...

// Query should fallback to DB and backfill cache
const result = await caller.notification.unreadCount();
expect(result.count).toBe(3);

// Cache should now be populated
const cached = await redis.get("notification:unread:userId123");
expect(cached).toBe("3");
```

### Verify Decrement Floor

```typescript
// Set cache to 1
await redis.set("notification:unread:userId123", "1");

// Call markRead twice
await caller.notification.markRead({ id: "notif1" });
await caller.notification.markRead({ id: "notif2" });

// Cache should be floored at 0
const count = await redis.get("notification:unread:userId123");
expect(count).toBe("0");
```

### Verify Fail-Open on Redis Failure

```typescript
// Disconnect Redis
await redis.disconnect();

// Query should still work via DB fallback
const result = await caller.notification.unreadCount();
expect(result.count).toBeGreaterThanOrEqual(0);

// No exception thrown
```

## Related Specs

- `caching-cache-aside-pattern.md` — General cache-aside pattern (read-through, backfill)
- `caching-lua-atomicity.md` — Lua script for atomic decrement with floor
- `caching-redis-key-patterns.md` — Key naming convention and TTL strategy
- `error-handling-redis-failure-policy.md` — Fail-open vs fail-closed policies
