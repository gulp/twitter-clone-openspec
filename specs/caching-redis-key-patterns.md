# Redis Key Patterns and TTL Strategy

## What

Standardized key naming convention and TTL policy for all Redis operations. Keys are namespaced by feature (`feed:`, `session:`, `rate:`, etc.) with specific data types and expiration rules per use case.

## Where

- Key pattern definitions: documented in `plans/twitter-clone.md:862-872`
- Wrapper implementations: `src/server/redis.ts:36-445`
- Feed cache keys: `src/server/services/feed.ts:135,174,394-395`
- Session keys: `src/server/redis.ts:188,206`
- Rate limit keys: `src/server/redis.ts:126`
- SSE keys: `src/server/redis.ts:242,259,401,422`
- Tombstones: `src/server/trpc/routers/tweet.ts:258-259`
- Suggestions cache: `src/server/trpc/routers/social.ts:294`

## How It Works

### Key Naming Convention

All keys follow `{feature}:{entity}:{id}` pattern with optional suffixes:

```typescript
// From src/server/redis.ts:188
`session:jti:${jti}`

// From src/server/redis.ts:126
`rate:${scope}:${identifier}`

// From src/server/services/feed.ts:394-395
`feed:${userId}:v:${currentVersion}:page:${cursorHash}`

// From src/server/redis.ts:242
`sse:connections:${userId}`
```

### Complete Key Inventory

| Key Pattern | Data Type | TTL | Purpose |
|-------------|-----------|-----|---------|
| `session:jti:{jti}` | String (JSON) | 30 days | JWT allow-list entry |
| `feed:version:{userId}` | String (integer) | none | Monotonic version counter for cache invalidation |
| `feed:{userId}:v:{version}:page:{cursorHash}` | String (JSON) | 60s | Cached feed page |
| `feed:{userId}:rebuilding` | String | 5s | SETNX lock to prevent concurrent cache rebuilds |
| `tombstones:tweets` | Sorted Set | 60s per entry (score) | Soft-deleted tweet IDs for cache filtering |
| `sse:connections:{userId}` | Set | none | Active SSE connection IDs |
| `sse:seq:{userId}` | String (integer) | none | Monotonic SSE event sequence number |
| `sse:replay:{userId}` | List | 5 min | Event replay buffer (capped at 200 entries) |
| `rate:{scope}:{identifier}` | Sorted Set | varies | Sliding-window rate limiter |
| `notification:unread:{userId}` | String (integer) | none | Cached unread notification count |
| `suggestions:{userId}` | String (JSON) | 5 min | Cached follow suggestions |

### TTL Application

TTLs are applied at key creation via `SETEX` or `SET ... EX`:

```typescript
// From src/server/redis.ts:57-59
if (ttlSeconds) {
  await redis.setex(key, ttlSeconds, value);
} else {
  await redis.set(key, value);
}
```

For sorted sets with score-based expiry:

```typescript
// From src/server/trpc/routers/tweet.ts:256-259
const now = Date.now();
const expiryTimestamp = now + 60000; // 60 seconds from now
await redis.zadd("tombstones:tweets", expiryTimestamp, tweetId);
```

### SETNX Locking Pattern

Feed rebuild uses Redis `SET ... NX EX` for distributed locking:

```typescript
// From src/server/services/feed.ts:178
const lockResult = await redis.set(lockKey, "1", "EX", 5, "NX");
acquiredLock = lockResult === "OK";
```

If the lock is held (returns `null`), concurrent requests wait briefly then fall through to PostgreSQL query.

### Atomic Operations

Counters use `INCR`/`DECR` for atomicity:

```typescript
// From src/server/redis.ts:98
return await redis.incr(key);
```

Unread count decrement floors at zero via Lua script:

```typescript
// From src/server/redis.ts:355-362
const lua = `
  local key = KEYS[1]
  local val = redis.call('GET', key)
  if val and tonumber(val) > 0 then
    return redis.call('DECR', key)
  end
  return 0
`;
await redis.eval(lua, 1, `notification:unread:${userId}`);
```

### Rate Limiter Lua Script

Rate limiting uses atomic Lua script to prevent race conditions:

```typescript
// From src/server/redis.ts:133-152
const luaScript = `
  local key = KEYS[1]
  local now = ARGV[1]
  local windowStart = ARGV[2]
  local limit = ARGV[3]
  local windowSeconds = ARGV[4]
  local member = ARGV[5]

  redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)
  local count = redis.call('ZCARD', key)

  if count >= tonumber(limit) then
    return {0, 0}
  end

  redis.call('ZADD', key, now, member)
  redis.call('EXPIRE', key, windowSeconds)

  return {1, tonumber(limit) - count - 1}
`;
```

This ensures concurrent requests can't both pass the count check before either adds their entry.

## Invariants

1. **Feature-based namespacing** — All keys start with feature prefix (`session:`, `feed:`, `rate:`, etc.). Never mix features in the same namespace.

2. **Counters have no TTL** — `feed:version:{userId}`, `sse:seq:{userId}`, and `notification:unread:{userId}` persist indefinitely. They're write-only monotonic counters that occupy minimal space (~50 bytes each).

3. **Score-based expiry for tombstones** — `tombstones:tweets` is a sorted set where each member's score is its expiry timestamp. Individual entries expire independently (no shared TTL). Cleanup happens lazily via `ZREMRANGEBYSCORE` on reads (src/server/services/feed.ts:410-421).

4. **TTL never extends on read** — Cache hits don't refresh TTL. A feed page cached at T0 expires at T0+60s regardless of access pattern.

5. **Session keys use sliding TTL** — Session writes call `SETEX` with full 30-day TTL on every session update (src/server/redis.ts:206). This effectively implements sliding-window session expiration.

## Gotchas

**SETNX lock acquisition failure is not an error** — When `feed:{userId}:rebuilding` lock is held, the request continues without the lock and queries PostgreSQL directly (src/server/services/feed.ts:174-184). This prevents deadlocks when cache rebuild takes >5s.

**Tombstones key is global, not per-user** — Deleted tweets go into a single `tombstones:tweets` sorted set, not `tombstones:tweets:{userId}`. Cache filtering checks every cached tweet against this global sorted set (src/server/services/feed.ts:146-148). Each entry's score is its expiry timestamp, allowing independent TTL per deleted tweet. Cleanup is lazy via `ZREMRANGEBYSCORE` on reads, keeping memory bounded to deleted tweets in last 60s.

**Rate limit keys expire automatically** — The Lua script sets `EXPIRE` on every request (src/server/redis.ts:149). If a user makes one request then stops, the key self-evicts after `windowSeconds`. No cleanup needed.

**SSE replay buffer is capped** — `sse:replay:{userId}` uses `LPUSH` + `LTRIM 0 199` to maintain max 200 entries (src/server/redis.ts:401-404). The `LTRIM` happens on every write, so the list never grows unbounded.

**Version counters survive Redis restart** — `feed:version:{userId}` and `sse:seq:{userId}` have no TTL and persist until Redis restarts. On restart, they're lost and re-initialized to 1 on first write. This is safe because version bump invalidates all cached pages, so losing the counter just causes temporary cache misses.

**Cursor hash prevents pagination key explosion** — Feed cache keys include `cursorHash` (16-char SHA-256 digest) instead of full cursor JSON (src/server/services/feed.ts:453-459). This bounds key length and prevents Redis memory bloat when users paginate deep into their feed.

**No namespace collisions between features** — `session:jti:{uuid}` can never collide with `feed:version:{uuid}` even if the same UUID appears in both, because the first `:` segment differs. This partitioning makes key pattern matching safe (e.g., `DEL session:*` won't touch feed keys).

**Auth rate limiter keys use scope prefix** — `rate:{scope}:{identifier}` allows different limits for different operations on the same identifier. `rate:login:127.0.0.1` and `rate:register:127.0.0.1` are separate keys with independent limits (src/server/redis.ts:126).

**Unread count has no TTL but syncs on every mark-read** — `notification:unread:{userId}` persists indefinitely but is re-synced from the database on every `markRead` call to prevent drift (implementation in notification router). Cache miss falls back to `COUNT(*)` query (src/server/redis.ts:298).
