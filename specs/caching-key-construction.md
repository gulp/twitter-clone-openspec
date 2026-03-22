# Cache Key Construction

## What

Principles for constructing cache keys that ensure cache correctness: all inputs that affect query results must be included in the key. A cache key uniquely identifies a specific query result; omitting relevant parameters causes wrong data to be served.

## Where

- Feed cache keys: `src/server/services/feed.ts:134-135`
- Suggestions cache keys: `src/server/trpc/routers/social.ts:294`
- Cursor hashing: `src/server/services/feed.ts:453-459`
- Key pattern inventory: documented in `specs/caching-redis-key-patterns.md:40-52`

## How It Works

### Core Principle: Key Uniqueness

A cache key must uniquely identify the query result. If two different requests can produce different results, they must have different cache keys.

**Rule:** Include every input parameter that affects the output in the cache key.

### Feed Cache Key Construction

Feed pages are keyed by user, version, and cursor:

```typescript
// From src/server/services/feed.ts:134-135
const cursorHash = parsedCursor ? hashCursor(parsedCursor) : "first";
const cacheKey = `feed:${userId}:v:${currentVersion}:page:${cursorHash}`;
```

Components:
- `userId` — different users see different feeds
- `currentVersion` — incremented on follow/unfollow to invalidate stale pages
- `cursorHash` — deterministic hash of `{effectiveAt, tweetId}` cursor

**Missing:** `limit` parameter. Bug tracked in tw-2pj.

### Suggestions Cache Key Construction

Follow suggestions are keyed only by user:

```typescript
// From src/server/trpc/routers/social.ts:294
const cacheKey = `suggestions:${userId}`;
```

This is correct because:
- Suggestions query has no parameters beyond `userId`
- Always returns same set of users for a given user at a given time
- Limit is applied client-side (fixed at 5 in the query)

### Cursor Hashing

Cursors are hashed to prevent key length explosion:

```typescript
// From src/server/services/feed.ts:453-459
function hashCursor(cursor: FeedCursor): string {
  const json = JSON.stringify({
    effectiveAt: cursor.effectiveAt.toISOString(),
    tweetId: cursor.tweetId,
  });
  return createHash("sha256").update(json).digest("hex").slice(0, 16);
}
```

**Why hash instead of including raw JSON:**
- Cursors can be long (ISO timestamp + CUID = ~40 chars)
- Deep pagination creates many unique cursors → many cache keys
- 16-char hash is sufficient (collision probability negligible for pagination depth)

**Determinism requirement:** Cursor serialization must be deterministic. Object key order matters:

```typescript
// CORRECT: stable key order
JSON.stringify({ effectiveAt: "...", tweetId: "..." })

// WRONG: object iteration order is undefined in JS
JSON.stringify(cursor)  // may produce different JSON on different runtimes
```

### Session Cache Keys

Sessions are keyed by JTI (JWT ID):

```typescript
// From src/server/redis.ts:188
`session:jti:${jti}`
```

This is correct because:
- Each JWT has a unique `jti` claim (UUID)
- Session data is tied to specific JWT, not user
- Multiple sessions per user are distinct (different JTIs)

### Rate Limit Keys

Rate limits are keyed by scope and identifier:

```typescript
// From src/server/redis.ts:126
`rate:${scope}:${identifier}`
```

Components:
- `scope` — operation being limited (e.g., `login`, `reset-password`)
- `identifier` — entity being limited (e.g., IP address, user ID)

This allows per-scope limits on the same identifier:
- `rate:login:127.0.0.1` — 10 login attempts per 15 min
- `rate:reset-password:127.0.0.1` — 3 reset requests per hour

## Invariants

**I1: Deterministic serialization** — If a parameter is included via hash, the serialization must be deterministic. Use explicit key order in `JSON.stringify()`, not object iteration.

**I2: All query parameters in key** — Every parameter passed to the cached query must appear in the cache key or be proven to not affect results.

**I3: No redundant parameters** — Keys should include only parameters that affect results. Don't include `requestId`, timestamps, or other metadata that doesn't change the query output.

**I4: Hash collision safety** — When using hashes (like cursor hash), collision probability must be negligible. 16-char SHA-256 prefix provides 64 bits of entropy (collision at ~4B unique cursors).

**I5: Version invalidation subsumes version in key** — Version counters (`feed:version:{userId}`) are separate from cache keys. Bumping the version invalidates all pages for that user without needing to enumerate/delete old keys.

## Gotchas

**Feed cache key omits limit parameter** — Bug tracked in tw-2pj. Current implementation:
```typescript
const cacheKey = `feed:${userId}:v:${currentVersion}:page:${cursorHash}`;
```

Should include limit:
```typescript
const cacheKey = `feed:${userId}:v:${currentVersion}:page:${cursorHash}:limit:${limit}`;
```

Without this, requesting 10 items may return a cached 20-item page, or vice versa. The client receives wrong page size.

**Cursor hash hides ordering parameters** — If feed ordering changes (e.g., adding a `sortBy` parameter), the cursor hash doesn't reveal this. The cache key must include ordering mode explicitly:
```typescript
`feed:${userId}:v:${currentVersion}:${sortMode}:page:${cursorHash}`
```

**Version bump doesn't delete old keys** — Incrementing `feed:version:{userId}` doesn't delete cached pages with old versions. They expire via 60s TTL or are evicted by LRU. This is intentional (SCAN to delete all matching keys blocks Redis), but means old data lingers briefly.

**Hashing loses debuggability** — Cache keys with hashes (`page:a7f3c2d8`) are opaque. Can't tell what cursor they represent without reverse lookup. This is a trade-off for bounded key length.

**Session key uses jti, not userId** — Multiple sessions for the same user have different cache keys. Logging out invalidates one JTI's session but leaves others active. This is correct behavior (allows "log out of this device" vs "log out everywhere").

**Per-user vs global keys** — `tombstones:tweets` is global, not per-user. All users filter against the same set. This works because:
- Soft-delete is rare (low memory)
- Global set is faster than per-user lookup (single `SMEMBERS` vs N queries)
- 60s TTL keeps it bounded

**Empty cursor vs no cursor** — First page uses `cursorHash = "first"`, not hash of empty object. This makes the cache key human-readable and debuggable.

**Stringified dates must be ISO-8601** — Cursor hashing uses `.toISOString()` for determinism. `new Date().toString()` varies by locale and timezone.

**Limit affects page size, not content ordering** — Even if limit is omitted from key (current bug), the cached content is still correctly ordered. The bug only manifests as wrong page size, not wrong tweet order.
