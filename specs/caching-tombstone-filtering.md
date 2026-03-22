# Tombstone Filtering for Cached Feeds

## What

In-memory filtering of soft-deleted tweets from cached feed pages using a Redis set of deleted tweet IDs (tombstones). Prevents showing deleted content without invalidating all cached feeds.

## Where

- Tombstone creation: `src/server/trpc/routers/tweet.ts:258` (on delete)
- Tombstone filtering: `src/server/services/feed.ts:147` (on cache hit)
- Tombstone retrieval: `src/server/services/feed.ts:410` (getTombstones helper)

## How It Works

### The Problem

Tweets are soft-deleted (`deleted: boolean` column) rather than hard-deleted. When a tweet is deleted:
- All existing cached feed pages containing that tweet become stale
- Version bumping ALL followers' feeds is expensive (O(follower count) Redis operations)
- Cache invalidation on every delete defeats the purpose of caching

### The Solution

Instead of invalidating cached feed pages on delete, we:
1. Add the deleted tweet ID to a global `tombstones:tweets` Redis set
2. Filter tombstones from cached pages at read time
3. Let both tombstones and cached pages expire naturally after 60s

### Tombstone Creation (Write Path)

When a tweet is soft-deleted, its ID is added to the tombstones set:

```typescript
// From src/server/trpc/routers/tweet.ts:256-259
await redis.sadd("tombstones:tweets", tweetId);
await redis.expire("tombstones:tweets", 60);
```

**Key details:**
- `SADD` is idempotent — deleting the same tweet twice is safe
- `EXPIRE` resets the entire set's TTL to 60s (not per-member)
- Operation is fail-open — if Redis fails, worst case is serving deleted tweet for ≤60s

### Tombstone Filtering (Read Path)

When serving a cached feed page, tombstones are fetched and filtered out:

```typescript
// From src/server/services/feed.ts:146-148
const tombstones = await getTombstones(requestId);
const filtered = cachedFeed.items.filter((item) => !tombstones.has(item.id));
```

**Key details:**
- Tombstones are fetched on EVERY cache hit (not cached themselves)
- Filtering is in-memory (O(n) where n = page size, typically 20 items)
- `getTombstones` returns empty set on Redis failure (fail-open)

### Tombstone Retrieval Helper

```typescript
// From src/server/services/feed.ts:410-420
async function getTombstones(requestId?: string): Promise<Set<string>> {
  try {
    const tombstones = await redis.smembers("tombstones:tweets");
    return new Set(tombstones);
  } catch (error) {
    log.warn("Failed to get tombstones (fail open)", {
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return new Set();
  }
}
```

**Fail-open behavior:** If Redis is unavailable, return empty set. Cached pages may show deleted tweets for up to 60s (until cache expires), but the system remains available.

### TTL Coordination

Both tombstones and cached feed pages have 60s TTL:

```typescript
// Tombstone TTL
await redis.expire("tombstones:tweets", 60);

// Feed page TTL
await cacheSet(cacheKey, JSON.stringify(result), 60, requestId);
```

After 60s:
- All cached pages referencing the deleted tweet have expired
- The tombstone set expires (no longer needed)

## Invariants

1. **Tombstone TTL ≥ feed cache TTL** — Both are 60s. Tombstones must outlive any cached page that might contain the deleted tweet.

2. **Tombstones are global, not per-user** — Single Redis key (`tombstones:tweets`) serves all users. This scales because:
   - Set membership check is O(1)
   - Typical deletion rate is low (<10 deletes/sec across all users)
   - Set size is bounded by total deletes in last 60s

3. **Filtering is idempotent** — Filtering the same page multiple times produces the same result. A tweet either is or isn't in the tombstones set.

4. **Tombstones are write-only from delete path** — Only the tweet deletion mutation adds to the set. No other code path modifies it.

5. **Cache miss bypasses tombstones** — Freshly fetched feeds from PostgreSQL automatically exclude soft-deleted tweets via `WHERE deleted = false` (src/server/services/feed.ts:243). Tombstone filtering only applies to cached pages.

## Gotchas

**EXPIRE resets TTL for entire set** — Each tweet deletion calls `EXPIRE tombstones:tweets 60`, resetting the countdown even if the set already existed. During high delete volume, the set can persist indefinitely (each delete extends the TTL by 60s). This is safe:
- Set size is bounded by unique deleted tweet IDs
- Memory cost is ~(40 bytes × number of deleted tweets in last 60s)
- During a delete storm (100 deletes/sec), set grows to ~6,000 entries (~240KB)

**Tombstone check happens AFTER cache deserialization** — Cached pages are deserialized before filtering:

```typescript
const cachedFeed = JSON.parse(cached) as FeedResult;
const tombstones = await getTombstones(requestId);
const filtered = cachedFeed.items.filter((item) => !tombstones.has(item.id));
```

This means we pay the deserialization cost even if all items are tombstoned. In practice, this is rare (typical page has 0-1 deleted tweets out of 20 items).

**Tombstones are NOT added to fresh DB queries** — When fetching from PostgreSQL (cache miss), `WHERE deleted = false` filters deleted tweets at query time. Tombstones are only relevant for cached pages.

**Race condition: delete after cache write** — Timeline:
1. Feed query executes: tweet T1 is not deleted
2. Feed page cached with T1
3. T1 is deleted → added to tombstones
4. Next cache hit: T1 is filtered out

This is correct. The tombstone filtering handles the race automatically.

**Race condition: delete before cache write** — Timeline:
1. Feed query executes: tweet T1 is not deleted
2. T1 is deleted → added to tombstones
3. Feed page cached with T1
4. Next cache hit: T1 is filtered out

Still correct. The slow query case (step 1 completes before step 2) is covered.

**Empty tombstones set is common** — If no tweets have been deleted in the last 60s, `SMEMBERS tombstones:tweets` returns an empty array. This is the happy path (no filtering needed).

**Tombstones persist beyond tweet's cached lifetime** — If a tweet is deleted at t=0, the tombstone persists until t=60 (last EXPIRE). But the cached page containing that tweet expires at its own t=60 (independent clock). The tombstones set may contain IDs that no cached page references. This is harmless: the set expires eventually.

**Filtering is client-side (backend code), not browser** — Tombstone filtering happens in `src/server/services/feed.ts`, not in the React components. Clients never see deleted tweets if tombstone filtering succeeds.

**No partial filtering** — Either ALL tombstones are fetched and ALL deleted tweets are filtered, or Redis fails and NO filtering occurs (fail-open). There's no middle ground where some tombstones are applied.

**Tombstones are NOT persisted to PostgreSQL** — The `tombstones:tweets` set is Redis-only. If Redis restarts:
- Tombstones set is lost
- Cached pages are also lost (Redis restart clears cache)
- Fresh queries from PostgreSQL use `WHERE deleted = false` (correct)

No data inconsistency occurs because tombstones and cached pages have the same lifecycle.
