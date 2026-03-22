# Cache-Aside Pattern (Read-Through Cache)

## What

The cache-aside pattern is the foundational caching strategy used for simple query result caching. The application code checks the cache before querying the database, and populates the cache on miss. Used for follow suggestions and other read-heavy, low-change-frequency queries where eventual consistency is acceptable.

## Where

- **Follow suggestions:** `src/server/trpc/routers/social.ts:292-359`
- **Feed page caching** (extended variant with versioning): `src/server/services/feed.ts:118-162`
- **Cache primitives:** `src/server/redis.ts:36-90` (cacheGet, cacheSet)

## How It Works

### Basic Pattern (getSuggestions)

```typescript
// src/server/trpc/routers/social.ts:292-359
getSuggestions: protectedProcedure.query(async ({ ctx }) => {
  const userId = ctx.session.user.id;
  const cacheKey = `suggestions:${userId}`;

  // 1. Try cache first
  const cached = await cacheGet(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // Invalid JSON, fall through to DB query
    }
  }

  // 2. Cache miss — query database
  const suggestions = await prisma.$queryRaw<...>(`
    WITH followed AS (
      SELECT "followingId" FROM "Follow" WHERE "followerId" = ${userId}
    ),
    mutual AS (
      SELECT f."followingId" AS "suggestedUserId", COUNT(*) AS "mutualCount"
      FROM "Follow" f
      WHERE f."followerId" IN (SELECT "followingId" FROM followed)
        AND f."followingId" != ${userId}
        AND f."followingId" NOT IN (SELECT "followingId" FROM followed)
      GROUP BY f."followingId"
    )
    SELECT u.*, m."mutualCount"::int
    FROM mutual m
    JOIN "User" u ON u.id = m."suggestedUserId"
    ORDER BY m."mutualCount" DESC, u."followerCount" DESC
    LIMIT 10
  `);

  const result = suggestions.map(({ mutualCount, ...user }) => user);

  // 3. Cache the result (best-effort, fail-open)
  await cacheSet(cacheKey, JSON.stringify(result), 300); // 5 min TTL

  return result;
});
```

### Flow

1. **Check cache** with `cacheGet(key)` — returns `null` on miss or Redis failure
2. **Deserialize** with `JSON.parse()` — fall through to DB on parse error
3. **Query database** on cache miss — standard Prisma query
4. **Serialize and cache** with `cacheSet(key, JSON.stringify(result), ttl)`
5. **Return result** — same shape whether from cache or DB

### Cache Invalidation

**Explicit deletion** on state changes (not TTL-only):

```typescript
// src/server/trpc/routers/social.ts:103-106
// After follow/unfollow, invalidate suggestion caches for both users
await Promise.all([
  cacheDel(`suggestions:${followerId}`),
  cacheDel(`suggestions:${followingId}`),
]);
```

TTL (300s = 5 minutes) provides eventual consistency if invalidation fails.

### Error Handling

**Fail-open everywhere**:
- `cacheGet()` returns `null` on Redis failure → DB query proceeds
- `JSON.parse()` throws → caught, DB query proceeds
- `cacheSet()` no-ops on Redis failure → no error, just no cache

No Redis failure blocks the request.

## Invariants

1. **Cache reads are optional** — `null` or parse error always falls back to DB
2. **Cache writes are best-effort** — `cacheSet()` never throws, never blocks response
3. **JSON is the serialization format** — all cached query results use `JSON.stringify()` / `JSON.parse()`
4. **TTL is mandatory** — every `cacheSet()` call includes TTL (no infinite-TTL keys)
5. **Explicit invalidation on mutations** — state changes call `cacheDel()` in addition to TTL
6. **Cache keys namespace by entity** — pattern is `{entity}:{id}` (e.g., `suggestions:{userId}`)

## Gotchas

1. **JSON.parse() throws on invalid JSON** — wrap in try-catch, not just `if (cached)`
2. **cacheGet() returns null on Redis failure** — distinguish from "key doesn't exist" is impossible
3. **TTL alone is insufficient** — must explicitly invalidate on follow/unfollow or results stay stale for 5 minutes
4. **Don't cache primitive types as-is** — always `JSON.stringify()`, even for numbers/booleans (consistency)
5. **Parse errors skip cache, don't break request** — if cache contains garbage, DB query proceeds
6. **Concurrent cache misses both query DB** — no SETNX lock (acceptable for low-cost queries like suggestions)
7. **Cache keys don't include cursor/limit** — getSuggestions has no pagination, so no cursor in key; feed pages do include `cursorHash` in key (see `caching-feed-assembly.md`)
