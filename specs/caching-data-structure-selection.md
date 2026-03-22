# Redis Data Structure Selection

## What

Guide for choosing the right Redis data type for different caching use cases. The codebase uses four Redis data structures: STRING (key-value pairs), SET (unordered unique collections), ZSET (sorted sets with scores), and LIST (ordered sequences). Each structure has specific operation patterns and performance characteristics.

## Where

**STRING usage:**
- Cache entries: `src/server/services/feed.ts:397` — JSON-serialized feed pages
- Sessions: `src/server/redis.ts:206` — JWT session allow-list
- Counters: `src/server/redis.ts:98,390` — version counters, unread counts
- SETNX locks: `src/server/services/feed.ts:178` — distributed locking

**SET usage:**
- SSE connections: `src/server/redis.ts:240-292` — active connection tracking
- Tombstones: `src/server/trpc/routers/tweet.ts:258` — soft-deleted tweet IDs

**ZSET usage:**
- Rate limiting: `src/server/services/rate-limiter.ts:62-78` — sliding window with timestamp scores

**LIST usage:**
- SSE replay buffer: `src/server/services/sse-publisher.ts:72-73` — bounded event history

## How It Works

### STRING — Simple Values, Counters, JSON Blobs

**Use STRING when:** You need simple key-value storage with atomic increment/decrement, or when storing serialized JSON objects.

**Operations:**
- `SET key value` — Write a value
- `GET key` — Read a value
- `SETEX key ttl value` — Write with TTL
- `SET key value EX ttl NX` — Atomic SETNX with TTL (distributed locking)
- `INCR key` / `DECR key` — Atomic counter operations

**Codebase examples:**

1. **Versioned cache entries** (`src/server/services/feed.ts:397`):
   ```typescript
   const cacheKey = `feed:${userId}:v:${currentVersion}:page:${cursorHash}`;
   await cacheSet(cacheKey, JSON.stringify(result), 60, requestId);
   ```
   - Store: JSON-serialized FeedResult
   - TTL: 60 seconds
   - Read: `cacheGet()` → deserialize → filter tombstones

2. **Monotonic version counters** (`src/server/services/feed.ts:476`):
   ```typescript
   await Promise.all(
     followers.map((follower) => cacheIncr(`feed:version:${follower.followerId}`))
   );
   ```
   - Store: Integer (version number)
   - TTL: None (persists until Redis restart)
   - Operation: INCR for atomic increment

3. **SETNX distributed lock** (`src/server/services/feed.ts:178`):
   ```typescript
   const lockResult = await redis.set(lockKey, "1", "EX", 5, "NX");
   acquiredLock = lockResult === "OK";
   ```
   - Store: Dummy value "1"
   - TTL: 5 seconds (auto-release if process crashes)
   - Check: `lockResult === "OK"` means lock acquired

**Performance:**
- GET/SET: O(1)
- INCR/DECR: O(1) atomic

### SET — Unordered Unique Collections

**Use SET when:** You need to track membership in a collection, test if an element exists, or maintain a unique list of items where order doesn't matter.

**Operations:**
- `SADD key member [member ...]` — Add one or more members
- `SREM key member [member ...]` — Remove members
- `SMEMBERS key` — Get all members (WARNING: O(N), avoid for large sets)
- `SISMEMBER key member` — Check membership (O(1))

**Codebase examples:**

1. **SSE connection tracking** (`src/server/redis.ts:240-292`):
   ```typescript
   // Add connection
   await redis.sadd(`sse:connections:${userId}`, connectionId);
   await redis.expire(`sse:connections:${userId}`, 120);

   // Get all connections
   const connectionIds = await redis.smembers(`sse:connections:${userId}`);

   // Remove connection
   await redis.srem(`sse:connections:${userId}`, connectionId);
   ```
   - Store: Set of connection IDs per user
   - TTL: 120 seconds (refreshed on heartbeat via `EXPIRE`)
   - Use case: Track which SSE connections are active for a user

2. **Tombstone filtering** (`src/server/trpc/routers/tweet.ts:258-259`):
   ```typescript
   await redis.sadd("tombstones:tweets", tweetId);
   await redis.expire("tombstones:tweets", 60);
   ```
   Then client-side filtering in `src/server/services/feed.ts:146-148`:
   ```typescript
   const tombstones = await getTombstones(requestId); // SMEMBERS
   const filtered = cachedFeed.items.filter((item) => !tombstones.has(item.id));
   ```
   - Store: Global set of deleted tweet IDs
   - TTL: 60 seconds (matches feed cache TTL)
   - Use case: In-memory filter for soft-deleted tweets without invalidating all caches

**Performance:**
- SADD/SREM/SISMEMBER: O(1)
- SMEMBERS: O(N) — only acceptable for small sets (tombstones ~10s of entries, connections ~1-5 per user)

**When NOT to use:**
- Large collections where you need to list all members (SMEMBERS becomes slow)
- Ordered data (use ZSET or LIST instead)
- Need to query "how many" without listing all (SET doesn't have SCARD equivalent that's useful for large sets)

### ZSET — Sorted Sets with Scores

**Use ZSET when:** You need sorted data based on numeric scores, time-based expiry with range queries, or sliding-window algorithms (e.g., rate limiting).

**Operations:**
- `ZADD key score member` — Add member with score
- `ZREMRANGEBYSCORE key min max` — Remove members by score range
- `ZCARD key` — Get count of members
- `ZRANGE key start stop [WITHSCORES]` — Get members by rank (ordered by score)

**Codebase example:**

**Sliding-window rate limiter** (`src/server/services/rate-limiter.ts:62-78`):
```typescript
const luaScript = `
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local windowStart = tonumber(ARGV[2])
  local limit = tonumber(ARGV[3])
  local windowSeconds = tonumber(ARGV[4])
  local member = ARGV[5]

  -- Remove expired entries
  redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)

  -- Get current count
  local count = redis.call('ZCARD', key)

  if count >= limit then
    -- Rate limit exceeded
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local oldestTimestamp = tonumber(oldest[2] or now)
    local retryAfter = math.ceil((oldestTimestamp + windowSeconds * 1000 - now) / 1000)
    return {0, retryAfter > 0 and retryAfter or 1}
  end

  -- Add new entry
  redis.call('ZADD', key, now, member)
  redis.call('EXPIRE', key, windowSeconds)

  return {1, 0}
`;
```

Key pattern: `rate:{scope}:{identifier}` (e.g., `rate:auth:ip:127.0.0.1`)

**How it works:**
- Score: Timestamp in milliseconds
- Member: `${now}:${randomId}` (unique request identifier)
- Sliding window: `ZREMRANGEBYSCORE` removes entries older than `now - windowSeconds`
- Count: `ZCARD` returns current request count in window
- Atomicity: Entire script runs atomically (prevents race conditions)

**Why ZSET for rate limiting:**
1. **Time-based expiry**: `ZREMRANGEBYSCORE` efficiently removes old entries by score range
2. **Count in window**: `ZCARD` gives exact count after cleanup
3. **Oldest timestamp**: `ZRANGE key 0 0 WITHSCORES` gets oldest entry for retryAfter calculation
4. **Auto-cleanup**: `EXPIRE` on the key itself removes the entire ZSET after inactivity

**Performance:**
- ZADD: O(log N)
- ZREMRANGEBYSCORE: O(log N + M) where M is number of removed elements
- ZCARD: O(1)
- ZRANGE: O(log N + M) where M is result size

**Alternative approaches (not used):**
- Counter + TTL: Can't handle sliding window (fixed window only)
- Token bucket: Requires separate state for refill timestamps

### LIST — Ordered Sequences with Bounded Size

**Use LIST when:** You need FIFO/LIFO queue behavior, bounded history with automatic eviction, or ordered event replay.

**Operations:**
- `LPUSH key element` — Prepend to list (left push)
- `RPUSH key element` — Append to list (right push)
- `LPOP key` — Remove and return first element
- `LTRIM key start stop` — Trim list to specified range
- `LRANGE key start stop` — Get elements by index range

**Codebase example:**

**SSE replay buffer** (`src/server/services/sse-publisher.ts:72-73` in Lua script):
```lua
-- From scripts/sse-lua/publish.lua (referenced in src/server/services/sse-publisher.ts:87-90)
redis.call('LPUSH', replayKey, eventWithId)
redis.call('LTRIM', replayKey, 0, 199)  -- Keep max 200 entries
redis.call('EXPIRE', replayKey, 300)     -- 5-minute TTL
```

Client reads with filtering in `src/server/redis.ts:442-456`:
```typescript
const events = await redis.lrange(key, 0, -1);

// Filter events with seq > sinceSeq
return events.filter((event) => {
  try {
    const parsed = JSON.parse(event);
    return parsed.id > sinceSeq;
  } catch {
    return false;
  }
});
```

Key pattern: `sse:replay:{userId}`

**How it works:**
- New events: `LPUSH` adds to the left (most recent)
- Bounded size: `LTRIM 0 199` keeps only the 200 most recent entries
- Replay: `LRANGE 0 -1` reads entire buffer, client filters by sequence number
- TTL: 5 minutes (events older than 5min are stale)

**Why LIST for replay buffer:**
1. **Automatic eviction**: `LTRIM` caps size without manual cleanup
2. **Insertion order**: LPUSH preserves time ordering (newest first)
3. **Bulk read**: `LRANGE` efficiently retrieves entire buffer for filtering
4. **Client-side filtering**: Sequence number check happens in application code (Redis doesn't natively filter LIST by field)

**LIST vs ZSET for event history:**
- LIST: Simpler, fixed size via LTRIM, but no native filtering by score
- ZSET: Score-based range queries (`ZRANGEBYSCORE`), but requires ZREMRANGEBYRANK for size capping (more complex)

For this use case, LIST + client-side filtering is simpler because:
- Replay buffer is small (200 entries max)
- Client-side filtering is cheap (JSON parse + integer comparison)
- LTRIM handles size capping automatically

**Performance:**
- LPUSH/RPUSH: O(1)
- LTRIM: O(N) where N is number of removed elements (only happens on eviction, so amortized O(1))
- LRANGE: O(S + N) where S is offset, N is result size

## Invariants

1. **STRING for simple types** — Use STRING for primitives (integers, booleans), JSON blobs, or any value that doesn't need collection operations.

2. **SET for membership** — Use SET when you need O(1) membership checks or unique collections. Avoid SMEMBERS on large sets (>1000 members).

3. **ZSET for time-based** — Use ZSET when scores represent timestamps and you need range queries by time. Rate limiting always uses ZSET with timestamp scores.

4. **LIST for bounded history** — Use LIST when you need ordered sequence with automatic size capping via LTRIM. SSE replay buffers always use LIST + LPUSH + LTRIM pattern.

5. **Lua for atomicity** — Complex operations spanning multiple data structures must use Lua scripts to prevent race conditions (e.g., rate limiter, SSE publish).

6. **No HASH in v1** — The codebase intentionally avoids Redis HASH. All structured data is JSON-serialized into STRING values. This simplifies cache invalidation (delete entire JSON blob vs. tracking individual HASH fields).

## Gotchas

**STRING counters have no TTL by default** — Version counters (`feed:version:{userId}`) and sequence numbers (`sse:seq:{userId}`) are write-only monotonic counters with no TTL. They persist until Redis restart, then re-initialize to 1 on first write. This is intentional: losing the counter causes temporary cache misses, which is safer than TTL eviction mid-session.

**SET SMEMBERS is O(N)** — Never call `SMEMBERS` on unbounded sets. The codebase uses it for:
- SSE connections (max 1-5 per user)
- Tombstones (deleted tweets in last 60s, typically <50 entries)

Both are small by design. If you need larger collections, use ZSET or LIST instead.

**ZSET score must be numeric** — ZADD requires numeric scores. For timestamp-based sorting, use `Date.now()` (milliseconds since epoch). Don't use ISO strings as scores.

**LIST LTRIM is destructive** — `LTRIM key 0 199` deletes all elements beyond index 199. Always `LTRIM` after `LPUSH` to cap size. The Lua script in `sse-publisher.ts` guarantees this happens atomically.

**SETNX returns null on failure** — `SET key value EX ttl NX` returns:
- `"OK"` if lock acquired
- `null` if key already exists (lock held by another process)

Don't check `if (result)` — check `if (result === "OK")` explicitly (src/server/services/feed.ts:179).

**Rate limiter ZSET uses random member IDs** — `rate:{scope}:{identifier}` stores members as `${now}:${randomId}` (src/server/services/rate-limiter.ts:49). Without the random suffix, concurrent requests at the same millisecond would be treated as duplicates (ZADD doesn't add if member already exists). The random ID ensures each request gets its own entry.

**No HINCRBY for nested counters** — The codebase doesn't use Redis HASH for grouping related counters (e.g., `user:{userId}` with fields `tweetCount`, `followerCount`). Instead, it stores denormalized counts in PostgreSQL and caches derived values as separate STRING keys. This avoids partial HASH invalidation complexity.

**LIST index order** — `LPUSH` adds to index 0 (left). `LRANGE 0 -1` returns `[newest, ..., oldest]`. Client code must filter by sequence number because Redis doesn't natively support `LRANGE` by score (only by index).

**ZSET duplicate members** — `ZADD key score member` overwrites the score if `member` already exists. For rate limiting, this is prevented by using `${now}:${randomId}` as the member (src/server/services/rate-limiter.ts:49), ensuring uniqueness.

**EXPIRE updates TTL** — Calling `EXPIRE key ttl` resets the TTL to the new value, even if the key already had a TTL. The tombstones pattern at `src/server/trpc/routers/tweet.ts:258-259` relies on this:
```typescript
await redis.sadd("tombstones:tweets", tweetId);
await redis.expire("tombstones:tweets", 60);  // Resets TTL to 60s on every SADD
```
This is safe because all soft-deletes want the same 60s TTL.
