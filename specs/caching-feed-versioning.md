# Feed Versioning for Cache Invalidation

## What

Redis-based versioning strategy that invalidates cached feed pages by incrementing a user's feed version counter. When a follow/unfollow happens or a followed user posts, the version bumps, causing old cached pages to be ignored.

## Where

- Version bumping: `src/server/trpc/routers/social.ts:100`, `src/server/trpc/routers/social.ts:168`, `src/server/services/feed.ts:466`
- Version checking: `src/server/services/feed.ts:125`
- Cache key construction: `src/server/services/feed.ts:135`, `src/server/services/feed.ts:395`

## How It Works

Each user has a monotonic feed version counter in Redis at `feed:version:{userId}`. Cached feed pages include the version in their key: `feed:{userId}:v:{version}:page:{cursorHash}`.

### Version Initialization

On first cache write, the version counter is initialized to 1:

```typescript
// From src/server/services/feed.ts:385-392
const versionKey = `feed:version:${userId}`;
let currentVersion = await cacheGet(versionKey, requestId);

if (!currentVersion) {
  // Initialize version counter
  await cacheIncr(versionKey, requestId);
  currentVersion = "1";
}
```

### Cache Key Construction

Cached pages embed the current version:

```typescript
// From src/server/services/feed.ts:394-395
const cursorHash = parsedCursor ? hashCursor(parsedCursor) : "first";
const cacheKey = `feed:${userId}:v:${currentVersion}:page:${cursorHash}`;
```

### Version Checking on Read

When serving from cache, the current version must match:

```typescript
// From src/server/services/feed.ts:125-131
const versionKey = `feed:version:${userId}`;
const currentVersion = await cacheGet(versionKey, requestId);

if (!currentVersion) {
  // No version set — cache miss
  return null;
}
```

If the version incremented since the page was cached, the key lookup fails (cache miss).

### Version Bumping

The version counter is incremented atomically via Redis INCR when the user's feed should be invalidated:

```typescript
// From src/server/trpc/routers/social.ts:369-372
async function bumpFeedVersion(userId: string): Promise<void> {
  const key = `feed:version:${userId}`;
  await cacheIncr(key);
}
```

This is called:
- **On follow**: `src/server/trpc/routers/social.ts:100` — follower's feed now includes followee's tweets
- **On unfollow**: `src/server/trpc/routers/social.ts:168` — follower's feed no longer includes followee's tweets
- **When a user posts**: `src/server/services/feed.ts:466-484` — all followers' feeds now include the new tweet

### Follower Version Bumping

When a user posts a tweet, all their followers' feed versions are bumped:

```typescript
// From src/server/services/feed.ts:466-484
export async function bumpFeedVersionForFollowers(userId: string): Promise<void> {
  try {
    // Get all followers
    const followers = await prisma.follow.findMany({
      where: { followingId: userId },
      select: { followerId: true },
    });

    // Bump version for each follower
    await Promise.all(
      followers.map((follower) => cacheIncr(`feed:version:${follower.followerId}`))
    );
  } catch (error) {
    log.warn("Failed to bump feed version for followers (fail open)", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
```

## Invariants

1. **Version counters are monotonically increasing** — Redis INCR guarantees atomicity. Version N+1 always invalidates all pages cached with version N.

2. **Old pages never shadow new pages** — A cache hit only succeeds if `currentVersion == cachedVersion`. After a version bump, old pages become unreachable (Redis will eventually evict them based on LRU policy).

3. **Version bumps are best-effort** — If Redis fails during `bumpFeedVersion`, the operation logs a warning and continues (fail open). The worst case is serving stale cache for up to 60s (feed page TTL).

4. **No version means no cache** — If `feed:version:{userId}` doesn't exist, cache reads return miss (src/server/services/feed.ts:128-131). This prevents serving stale pages after a Redis restart that lost all version counters.

5. **Version bumping is asynchronous** — Neither follow/unfollow nor tweet creation waits for version bumps to complete. Feed invalidation happens in the background via `Promise.all()` without blocking the mutation response.

## Gotchas

**Concurrent version increments are safe** — Multiple `INCR` operations on the same key are atomic and serialized by Redis. If two followers post at the same time, both version bumps succeed and the counter increments by 2.

**Version bumps don't delete old cached pages** — Old pages remain in Redis until they expire (60s TTL) or are evicted by LRU. This is intentional: deleting all pages matching `feed:{userId}:v:*` requires a SCAN operation that blocks Redis. Instead, we rely on TTL and natural eviction.

**Feed version key has no TTL** — `feed:version:{userId}` never expires. It persists until Redis restarts. This is safe because versions are write-only counters (never decremented) and occupy minimal space (~50 bytes per user).

**User's own feed version bumps on follow/unfollow, not on posting** — When user A posts, we bump all followers' versions but NOT user A's version. User A's home feed includes tweets from people they follow, not their own tweets. This is correct per Twitter semantics.

**bumpFeedVersionForFollowers is O(N) in follower count** — A user with 10,000 followers triggers 10,000 Redis INCR operations. This scales because:
1. Operations run in parallel via `Promise.all()`
2. Each INCR is a single Redis roundtrip (~1ms)
3. The entire operation is best-effort (fail open) — if it takes too long or fails, the worst case is serving stale cache for 60s

**Cursor hash is deterministic** — Two requests with the same cursor always produce the same `cursorHash` (src/server/services/feed.ts:453-459). This allows cache hits for paginated feed requests. The hash is a SHA-256 digest of the JSON-serialized cursor, truncated to 16 hex chars.

**Cache keys include userId AND version** — This prevents version leakage across users. User A's cached feed with version 5 never collides with User B's cached feed with version 5, even if they request the same cursor position.
