# Feed Assembly and Deduplication

## What

Home timeline feed assembly uses fan-out-on-read with a single UNION query that merges original tweets and retweets from followed users, then deduplicates using PostgreSQL's DISTINCT ON. Assembled pages are cached in Redis with version-based invalidation and tombstone filtering for deleted tweets.

## Where

- `src/server/services/feed.ts:84-111` — assembleFeed entry point
- `src/server/services/feed.ts:225-275` — fetchFeedItemsFromDB with UNION + DISTINCT ON query
- `src/server/services/feed.ts:277-372` — hydrateFeedItems batch query and engagement state
- `src/server/services/feed.ts:118-162` — tryGetCachedFeed with tombstone filtering
- `src/server/services/feed.ts:466-484` — bumpFeedVersionForFollowers cache invalidation
- `src/server/trpc/routers/tweet.ts:177` — cache invalidation on tweet create
- `src/server/trpc/routers/tweet.ts:258-259` — tombstone set on tweet delete
- `src/server/trpc/routers/engagement.ts:209,283` — cache invalidation on retweet/undo

## How It Works

### Feed Assembly Flow

```
1. Parse cursor (if provided) → { effectiveAt, tweetId }
2. Try Redis cache hit:
   a. Read feed:version:{userId} → currentVersion
   b. Compute cursorHash = sha256({ effectiveAt, tweetId }).slice(0, 16)
   c. Read feed:{userId}:v:{currentVersion}:page:{cursorHash}
   d. If hit: filter against tombstones:tweets set, return
3. On cache miss:
   a. Acquire SETNX lock: feed:{userId}:rebuilding (5s TTL)
   b. Execute UNION query (original tweets + retweets)
   c. Hydrate tweet + author data (batch query)
   d. Batch-check hasLiked/hasRetweeted for current user
   e. Cache result with 60s TTL
   f. Return { items, nextCursor }
```

Implemented in `src/server/services/feed.ts:84-218`.

### Deduplication Logic (DISTINCT ON)

The UNION query at `src/server/services/feed.ts:234-265` produces duplicate tweetIds when:
- A user you follow posts a tweet (original)
- Another user you follow retweets the same tweet (retweet)

The `deduped` CTE uses `DISTINCT ON (tweetId)` with tiebreaker:

```sql
SELECT DISTINCT ON ("tweetId") *
FROM feed_items
ORDER BY "tweetId", "effectiveAt" DESC, "retweeterId" DESC NULLS LAST
```

Tiebreaker order:
1. `effectiveAt DESC` — most recent appearance wins
2. `retweeterId DESC NULLS LAST` — if tied on effectiveAt, retweeted version wins over original

This ensures:
- A tweet appears at most once in the feed
- Priority to the most recent retweet timestamp
- If original tweet and retweet have same effectiveAt (race), show retweeted version

### Cursor Encoding

Home feed is ordered by `(effectiveAt DESC, tweetId DESC)`, not raw `tweet.createdAt`. The cursor must encode `{ effectiveAt, tweetId }` to avoid pagination skips when a retweet changes effective ordering.

Cursor encoding at `src/server/services/feed.ts:442-448`:

```typescript
const json = JSON.stringify({
  effectiveAt: cursor.effectiveAt.toISOString(),
  tweetId: cursor.tweetId,
});
return Buffer.from(json, "utf-8").toString("base64url");
```

The query at `src/server/services/feed.ts:230-232` applies cursor as composite WHERE:

```sql
WHERE ("effectiveAt", "tweetId") < (${parsedCursor.effectiveAt}, ${parsedCursor.tweetId})
```

This is PostgreSQL's row-value comparison syntax for composite cursor pagination.

### Cache Versioning

Version counter at `feed:version:{userId}` (monotonic integer). Incremented when:
- User posts a new tweet (`src/server/trpc/routers/tweet.ts:177`)
- User retweets (`src/server/trpc/routers/engagement.ts:209`)
- User undoes retweet (`src/server/trpc/routers/engagement.ts:283`)

Implemented in `src/server/services/feed.ts:466-484`. Bumps version for **all followers** of the acting user:

```typescript
const followers = await prisma.follow.findMany({
  where: { followingId: userId },
  select: { followerId: true },
});

await Promise.all(
  followers.map((follower) => cacheIncr(`feed:version:${follower.followerId}`))
);
```

Cache read at `src/server/services/feed.ts:125-141` checks current version. Mismatch → cache miss.

### Tombstone Filtering (Delete Strategy)

Tweet deletion does NOT bump feed versions (would cause thundering herd for high-follower accounts). Instead, add deleted tweetId to `tombstones:tweets` set with 60s TTL (`src/server/trpc/routers/tweet.ts:258-259`):

```typescript
await redis.sadd("tombstones:tweets", tweetId);
await redis.expire("tombstones:tweets", 60);
```

Cache hit path filters tombstones client-side at `src/server/services/feed.ts:146-149`:

```typescript
const tombstones = await getTombstones(requestId);
const filtered = cachedFeed.items.filter((item) => !tombstones.has(item.id));
```

The 60s tombstone TTL matches the 60s feed page cache TTL. After 60s, the deleted tweet naturally drops from newly rebuilt cache pages.

### SETNX Lock (Thundering Herd Protection)

On cache miss, acquire lock at `src/server/services/feed.ts:173-186`:

```typescript
const lockResult = await redis.set(lockKey, "1", "EX", 5, "NX");
acquiredLock = lockResult === "OK";
```

Only the process that acquires the lock caches the result. Concurrent requests for the same page:
- If lock acquisition fails: execute DB query but skip caching
- Prevents multiple processes from simultaneously rebuilding the same cache entry

Lock TTL is 5s. If the rebuilding process crashes, the lock auto-expires.

### Hydration (Batch Queries)

After fetching `{ tweetId, effectiveAt, retweeterId }` rows, hydrate full data at `src/server/services/feed.ts:277-372`:

1. **Batch-fetch tweets with authors** (lines 291-306):
   ```typescript
   const tweets = await prisma.tweet.findMany({
     where: { id: { in: tweetIds } },
     select: {
       id: true,
       content: true,
       // ... all tweet fields
       author: { select: publicUserSelect },
     },
   });
   ```

2. **Batch-check engagement state** (lines 312-325):
   ```typescript
   const [likedTweetIds, retweetedTweetIds] = await Promise.all([
     prisma.like.findMany({
       where: { userId, tweetId: { in: tweetIds } },
       select: { tweetId: true },
     }).then((likes) => new Set(likes.map((l) => l.tweetId))),
     prisma.retweet.findMany({
       where: { userId, tweetId: { in: tweetIds } },
       select: { tweetId: true },
     }).then((retweets) => new Set(retweets.map((r) => r.tweetId))),
   ]);
   ```

3. **Fetch retweeter usernames** (lines 328-340):
   ```typescript
   const retweeters = await prisma.user.findMany({
     where: { id: { in: retweeterIds } },
     select: { id: true, username: true },
   });
   ```

All queries are batched to avoid N+1. Total DB round trips: 3 queries regardless of feed size.

## Invariants

1. **Deduplication priority**: Most recent `effectiveAt` wins. If tied, retweeted version wins over original (`retweeterId DESC NULLS LAST`).
2. **Cursor encoding**: Home feed cursors encode `{ effectiveAt, tweetId }`, not raw `tweet.createdAt`. User timeline cursors encode `tweet.id`.
3. **Version monotonicity**: `feed:version:{userId}` only increments, never decrements. A version mismatch means cache is stale.
4. **Tombstone TTL**: Tombstone set TTL (60s) matches feed page cache TTL (60s). After 60s, deleted tweets drop from rebuilt caches naturally.
5. **Lock TTL**: SETNX lock TTL is 5s. Shorter than typical DB query time to prevent lock leaks while preventing thundering herd.
6. **Fail-open caching**: All Redis cache operations are fail-open. Redis unavailable → fall through to PostgreSQL query.
7. **Batch hydration**: Feed hydration always uses 3 batch queries (tweets+authors, likes, retweets) regardless of feed size. Never N+1.

## Gotchas

1. **effectiveAt vs createdAt**: The feed query orders by `effectiveAt`, not `tweet.createdAt`. For original tweets, `effectiveAt = tweet.createdAt`. For retweets, `effectiveAt = retweet.createdAt`. Cursors must encode `effectiveAt` to avoid pagination skips.

2. **DISTINCT ON tiebreaker**: The tiebreaker `ORDER BY "tweetId", "effectiveAt" DESC, "retweeterId" DESC NULLS LAST` is critical. Without `retweeterId DESC NULLS LAST`, PostgreSQL would prefer the original over the retweet when tied on `effectiveAt`, breaking the retweeted-version-wins invariant.

3. **Version bump scope**: `bumpFeedVersionForFollowers` increments version for **all followers**, not just the acting user. A high-follower account posting a tweet will bump thousands of version counters. This is intentional — the alternative (TTL-based invalidation) would cause thundering-herd cache rebuilds.

4. **Tombstone set is global**: `tombstones:tweets` is a single global Redis SET, not per-user. This is safe because tweetIds are globally unique (CUID). The set auto-expires after 60s, so it doesn't grow unbounded.

5. **Cache miss concurrency**: On cache miss, only the lock-acquiring process caches the result. Concurrent requests may execute redundant DB queries but will not overwrite each other's cache entries. This is a trade-off for simplicity — stale-while-revalidate with wait queues would be more efficient but much more complex.

6. **Cursor hash determinism**: The cursor hash (`sha256(json).slice(0, 16)`) must be deterministic for the same `{ effectiveAt, tweetId }`. The JSON serialization uses `toISOString()` for dates to ensure consistent string encoding across processes.

7. **Hydration gap**: If a tweet is deleted between the UNION query and the hydration step (lines 225-275 → 277-372), the tweet won't be found in the `tweetMap` lookup. The code skips missing tweets at line 348-350. This is correct behavior — deleted tweets should not appear in the feed.

8. **No follow/unfollow bump**: The current implementation only bumps feed versions on tweet create/retweet, not on follow/unfollow. This means a user who follows someone new won't see their tweets until the cache naturally expires (60s TTL). This is a known limitation to reduce version-bump load.
