# Feed Cache Ignores Limit Parameter

## What

The feed cache key is built from `userId`, `version`, and `cursorHash` only — the `limit` parameter is NOT included. This means a request with `limit=50` served from cache will return the same result as `limit=20` if the cache was populated by a prior request with `limit=20`. The limit parameter only affects database queries on cache MISS, not cache retrieval.

## Where

- Cache key construction: `src/server/services/feed.ts:135` — `feed:{userId}:v:{version}:page:{cursorHash}`
- Cache retrieval: `src/server/services/feed.ts:94-101` — `tryGetCachedFeed` doesn't use limit
- Cache storage: `src/server/services/feed.ts:395` — `cacheFeedPage` doesn't include limit in key
- DB query: `src/server/services/feed.ts:264` — `LIMIT ${limit + 1}` only used on cache miss

## How It Works

### Cache Key Construction

```typescript
// src/server/services/feed.ts:133-135
const cursorHash = parsedCursor ? hashCursor(parsedCursor) : "first";
const cacheKey = `feed:${userId}:v:${currentVersion}:page:${cursorHash}`;
// NO limit in key ← limit parameter ignored
```

**Key components:**
- `userId` — feed owner
- `currentVersion` — monotonic feed version counter (invalidation marker)
- `cursorHash` — deterministic hash of cursor `{effectiveAt, tweetId}`
- **Missing:** `limit` parameter

### Request Flow

#### Scenario A: Cache Hit

```typescript
// src/server/services/feed.ts:84-101
export async function assembleFeed(
  userId: string,
  cursor?: string,
  limit = 20,  // ← limit parameter provided
  requestId?: string
): Promise<FeedResult> {
  const parsedCursor = cursor ? parseFeedCursor(cursor) : null;

  // Try Redis-cached feed (limit NOT passed)
  const cachedResult = await tryGetCachedFeed(userId, parsedCursor, requestId);
  if (cachedResult) {
    return cachedResult;  // ← Returns cached items regardless of limit
  }

  // Cache miss → use limit for DB query
  return await fetchFeedFromDB(userId, parsedCursor, limit, requestId);
}
```

**Cache hit behavior:**
1. Client requests `{ cursor: null, limit: 50 }`
2. Cache key: `feed:user123:v:5:page:first`
3. Cache contains 20 items (from prior `limit=20` request)
4. **Returns 20 items** (ignores `limit=50`)

#### Scenario B: Cache Miss

```typescript
// src/server/services/feed.ts:189-264
const feedItems = await fetchFeedItemsFromDB(userId, parsedCursor, limit);
// ← LIMIT ${limit + 1} in raw SQL (line 264)
```

**Cache miss behavior:**
1. Client requests `{ cursor: null, limit: 50 }`
2. Cache key: `feed:user123:v:5:page:first` (no entry)
3. Fetches `LIMIT 51` from PostgreSQL (peek-ahead for nextCursor)
4. Caches first 50 items (or fewer if less data available)
5. **Returns 50 items**

### Consequence: Inconsistent Page Sizes

**Timeline:**
1. **T=0s:** User A requests feed with `limit=10`
   - Cache miss → DB query `LIMIT 11`
   - Returns 10 items, caches them under `feed:user123:v:5:page:first`
2. **T=5s:** User B requests feed with `limit=50`
   - Cache hit → retrieves `feed:user123:v:5:page:first`
   - **Returns 10 items** (not 50)
3. **T=120s:** Cache expires (60s TTL)
4. **T=125s:** User C requests feed with `limit=50`
   - Cache miss → DB query `LIMIT 51`
   - Returns 50 items, caches them
5. **T=130s:** User D requests feed with `limit=10`
   - Cache hit → retrieves 50 items
   - **Returns 50 items** (not 10)

**Result:** Page size depends on cache state, not request parameter.

### Why Not Include Limit in Cache Key?

**Cache fragmentation:**

```typescript
// If limit were in cache key (NOT implemented):
const cacheKey = `feed:${userId}:v:${version}:page:${cursorHash}:limit:${limit}`;

// Results in separate cache entries:
feed:user123:v:5:page:first:limit:10
feed:user123:v:5:page:first:limit:20
feed:user123:v:5:page:first:limit:50
feed:user123:v:5:page:first:limit:100
```

**Problems:**
- **Redis memory explosion:** 4 entries per page × 1000 users × 10 pages = 40k cache entries
- **Cache hit rate drops:** Different limits rarely share cache entries
- **CPU waste:** DB queries for same data but different limits

**Current trade-off:**
- **Sacrifice:** Limit parameter may not be honored on cache hit
- **Gain:** Higher cache hit rate, lower Redis memory, fewer DB queries

## Invariants

1. **I-FEED-LIM-1:** Cache key NEVER includes limit parameter (by design)
2. **I-FEED-LIM-2:** Limit parameter only affects DB query on cache MISS
3. **I-FEED-LIM-3:** Cached feed page size determined by FIRST request's limit (cache population)
4. **I-FEED-LIM-4:** Subsequent requests with different limits receive cached page as-is
5. **I-FEED-LIM-5:** Cache expiration (60s TTL) or version bump (feed invalidation) resets behavior

## Gotchas

### ❌ DON'T: Assume limit parameter is always honored

```typescript
// WRONG: Expect 100 items on every request
const feed = await trpc.feed.home.query({ limit: 100 });
// ← May return 20 items if cache was populated with limit=20
```

### ✅ DO: Use default limit (20) consistently

```typescript
// CORRECT: Use default limit for predictable caching
const feed = await trpc.feed.home.query({ limit: 20 }); // default
// ← Consistent page size across cache hit/miss
```

### Edge Case: Client Requests limit > Default (20)

**Scenario:**
- Default limit: 20
- Client requests: 50

**Outcome:**
- **If cache hit:** Returns 20 items (underfull page)
- **If cache miss:** Returns 50 items (full page)

**Client-side implication:**
- Infinite scroll may show only 20 items initially (cache hit)
- Scrolling triggers next page (cache miss → 50 items)
- **UX inconsistency:** Variable page sizes during same scroll session

**Mitigation (not implemented):**
- Cap client-side limit to default (enforce `limit: 20` in tRPC schema)
- Document limit parameter as "advisory, not guaranteed"
- Add cache warming (pre-populate cache with common limits)

### Edge Case: Mobile vs. Desktop Limits

```typescript
// Mobile client (small screen, fewer items)
const feed = await trpc.feed.home.query({ limit: 10 });

// Desktop client (large screen, more items)
const feed = await trpc.feed.home.query({ limit: 30 });
```

**If mobile client populates cache:**
- Desktop users get 10 items (half-empty feed)
- Requires scroll/pagination to load more

**If desktop client populates cache:**
- Mobile users get 30 items (may scroll past viewport)
- Not a data leak (all items user is authorized to see)

**Current state:** No client-specific caching (same cache for all clients).

### Performance Implication: Cache Hit Rate

**Without limit in key (current):**
```
Request 1: limit=20 → cache miss → populate feed:user:v:1:page:first
Request 2: limit=30 → cache hit   ← same key
Request 3: limit=10 → cache hit   ← same key
Hit rate: 66% (2/3 requests)
```

**With limit in key (alternative):**
```
Request 1: limit=20 → cache miss → populate feed:user:v:1:page:first:lim:20
Request 2: limit=30 → cache miss → populate feed:user:v:1:page:first:lim:30
Request 3: limit=10 → cache miss → populate feed:user:v:1:page:first:lim:10
Hit rate: 0% (all misses)
```

**Conclusion:** Ignoring limit in cache key improves hit rate from ~0% to ~66% for heterogeneous clients.

### Client-Side Workaround: Trim to Requested Limit

```typescript
// Client-side defense: trim to requested limit
const { items } = await trpc.feed.home.query({ limit: 20 });
const trimmed = items.slice(0, 20);  // ← Discard excess if cache had 50
```

**Why not implemented:**
- Cache typically returns ≤ limit (rare overfull case)
- Most clients use default limit (20) consistently
- Trimming loses peek-ahead benefit (nextCursor calculation)

## Related Specs

- `caching-feed-assembly.md` — Feed caching strategy, version-based invalidation
- `caching-key-construction.md` — Cache key uniqueness principles, parameter inclusion rules
- `caching-ttl-strategy.md` — Feed page TTL (60s), version TTL (none)
- `pagination-cursor-encoding.md` — Cursor format, peek-ahead strategy (LIMIT n+1)
