# JSON Parsing Safety — Cached Data Trust Model

## What

Defines when to use defensive JSON.parse with try/catch versus trusting cached JSON data. The codebase serializes structured data to Redis and base64url cursors, then deserializes it later. Parsing can fail due to corruption, Redis restart with partial writes, or malicious cursor input. This spec documents the trust model and error handling strategy.

## Where

**Cursors (user-controlled input):**
- `src/server/services/feed.ts:426-437` — parseFeedCursor with try/catch, throws on invalid
- `src/server/trpc/routers/search.ts:63-75` — parseTweetSearchCursor with try/catch, throws on invalid
- `src/server/trpc/routers/search.ts:91-102` — parseUserSearchCursor with try/catch, throws on invalid

**Redis cached data (self-serialized):**
- `src/server/services/feed.ts:143-144` — cached feed deserialization, NO try/catch (trust model)
- `src/server/trpc/routers/social.ts:306-311` — cached mutual connections, HAS try/catch (fail-open)
- `src/server/redis.ts:461-468` — SSE replay events filter, HAS try/catch (defensive)

## How It Works

### Trust Model

**1. User-controlled input → ALWAYS validate**

Cursors are base64url-encoded JSON strings sent by clients. Malicious or corrupted cursors MUST be caught and rejected with a clear error.

```typescript
// src/server/services/feed.ts:426-437
function parseFeedCursor(cursor: string): FeedCursor {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf-8");
    const parsed = JSON.parse(decoded);
    return {
      effectiveAt: new Date(parsed.effectiveAt),
      tweetId: parsed.tweetId,
    };
  } catch (error) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid cursor" });
  }
}
```

All cursor parsing functions follow this pattern: decode base64url → JSON.parse → type coercion → throw BAD_REQUEST on failure.

**2. Self-serialized cache data → INCONSISTENT (gap)**

The codebase writes JSON to Redis via `JSON.stringify` and reads it back via `JSON.parse`. Two conflicting patterns exist:

**Pattern A: Trust cache data (NO error handling)**
```typescript
// src/server/services/feed.ts:143-144
const cached = await cacheGet(`feed:home:${userId}:${feedVersion}:${limit}`);
if (cached) {
  return null;
}
const cachedFeed = JSON.parse(cached) as FeedResult;  // ← NO try/catch
```

Assumption: JSON written by our code is always valid. If Redis corrupts it or returns partial data, `JSON.parse` throws, bubbles up as INTERNAL_SERVER_ERROR.

**Pattern B: Defensive parsing with fail-open (HAS error handling)**
```typescript
// src/server/trpc/routers/social.ts:306-311
const cached = await cacheGet(cacheKey);
if (cached) {
  try {
    return JSON.parse(cached);
  } catch {
    // Invalid JSON, continue to DB query
  }
}
```

Assumption: Cache corruption is possible but rare. On parse failure, silently ignore cache and query DB (fail-open).

**Pattern C: Defensive filter (SSE events)**
```typescript
// src/server/redis.ts:461-468
return events.filter((event) => {
  try {
    const parsed = JSON.parse(event);
    return parsed.id > sinceSeq;
  } catch {
    return false;  // Skip corrupted event
  }
});
```

Assumption: SSE replay buffer may contain corrupted events (Redis LRANGE returns all entries, some may be partial). Skip unparseable events, return the rest.

### Current State

- **src/server/services/feed.ts:144** — NO error handling (throws on corruption)
- **src/server/trpc/routers/social.ts:308** — HAS error handling (fail-open to DB)
- **src/server/redis.ts:463** — HAS error handling (skip corrupted events)

No unified policy. The spec documents the inconsistency but does not prescribe a fix (implementation decision).

## Invariants

**I1. User input MUST have try/catch**
All cursor parsing functions wrap JSON.parse in try/catch and throw BAD_REQUEST on failure.

**I2. Cache corruption causes fail-open or fail-closed**
- Fail-open: catch JSON.parse, log warning, fall back to DB query (social.ts pattern)
- Fail-closed: let JSON.parse throw, return INTERNAL_SERVER_ERROR (feed.ts pattern)

**I3. Type assertions follow successful parse**
After `JSON.parse`, code performs type coercion (e.g., `new Date(parsed.effectiveAt)`) without additional validation. Assumes parse success = structurally valid.

## Gotchas

**G1. src/server/services/feed.ts:144 throws on Redis corruption**
If Redis returns corrupted JSON for a cached feed, `JSON.parse` throws SyntaxError, bubbles up as 500 INTERNAL_SERVER_ERROR. No fallback to DB. Users see a generic error instead of a fresh feed.

**G2. No JSON schema validation**
After `JSON.parse`, code blindly accesses fields (`parsed.effectiveAt`, `parsed.tweetId`). If cached data has wrong shape (due to code change or corruption), accessing missing fields returns `undefined`, causing downstream errors.

Example: cached feed has old structure without `retweet` field. Code accesses `item.retweet.user.username` → TypeError: Cannot read property 'user' of undefined.

**G3. Silent cache bypass in src/server/trpc/routers/social.ts**
On JSON parse failure, `src/server/trpc/routers/social.ts:308-311` silently falls back to DB without logging. Impossible to detect cache corruption in production (no metrics, no alerts).

**G4. Partial JSON from Redis**
Redis LRANGE/GET can return truncated data if key was partially written during a crash. Example: `{"id":123,"content":"` (no closing brace). `JSON.parse` throws, behavior depends on pattern (see I2).

**G5. Type coercion hides errors**
`new Date(parsed.effectiveAt)` returns `Invalid Date` if `effectiveAt` is malformed, but code doesn't check. Invalid cursor → Invalid Date → feed query with nonsensical timestamp → wrong results instead of error.

**G6. No cache versioning**
If code changes the cached feed structure (e.g., adds new field), old cache entries remain. `JSON.parse` succeeds but data has old schema. No cache versioning or migration strategy.
