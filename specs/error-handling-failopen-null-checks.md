# Fail-Open Return Value Handling

## What

Fail-open Redis wrappers return null, void, empty arrays, or zero on failure. Callers must defensively handle these return values with fallback logic to avoid bugs where code assumes Redis operations always succeed.

## Where

**Fail-open wrappers (return null on failure):**
- `src/server/redis.ts:36-49` — `cacheGet` returns `string | null`
- `src/server/redis.ts:96-109` — `cacheIncr` returns `number | null`

**Fail-open wrappers (no-op on failure):**
- `src/server/redis.ts:55-72` — `cacheSet` returns `void`
- `src/server/redis.ts:78-90` — `cacheDel` returns `void`

**Caller sites that handle null returns:**
- `src/server/services/feed.ts:386-392` — version initialization with `cacheIncr` fallback
- `src/server/services/feed.ts:125-131` — version check with cache miss on null
- `src/server/services/feed.ts:350-358` — tombstone cache with empty Set fallback

## How It Works

Fail-open wrappers log warnings and return safe defaults instead of throwing. Callers must check return values and provide fallback behavior.

### Pattern: cacheIncr with fallback value

The feed version initialization uses the return value from `cacheIncr` to detect Redis failure:

```typescript
// src/server/services/feed.ts:388-392
if (!currentVersion) {
  // Initialize version counter
  const newVersion = await cacheIncr(versionKey, requestId);
  currentVersion = newVersion ? newVersion.toString() : "1";
}
```

**If Redis succeeds:** `cacheIncr` returns `1` (first increment), `currentVersion = "1"`.

**If Redis fails:** `cacheIncr` returns `null`, `currentVersion = "1"` (hardcoded fallback).

This prevents the bug where code assumed `cacheIncr` always succeeds and hardcoded `currentVersion = "1"` without checking the return value. The old code (before commit ac116e7) was:

```typescript
// BUGGY: ignores cacheIncr return value
await cacheIncr(versionKey, requestId);
currentVersion = "1";
```

**The race:** If Redis was down during initialization, the version counter was never set, but the cache key was written with version "1". Later reads would find no version key (null), treat it as a cache miss, and rebuild the feed even though a cached page existed.

### Pattern: cacheGet with null-as-miss

```typescript
// src/server/services/feed.ts:125-128
const versionKey = `feed:version:${userId}`;
const currentVersion = await cacheGet(versionKey, requestId);

if (!currentVersion) {
  // No version set — cache miss
  return null;
}
```

**Defensive check:** Treats both "key does not exist" and "Redis failure" as cache miss. The caller falls through to PostgreSQL query.

### Pattern: Best-effort operations with void return

```typescript
// src/server/services/feed.ts:397
await cacheSet(cacheKey, JSON.stringify(result), 60, requestId);
```

**No return value check needed.** If `cacheSet` fails, it logs a warning and returns. The feed result is still served from PostgreSQL. The consequence is a cache miss on the next request (acceptable for performance optimization).

### Pattern: Collection operations with empty fallback

```typescript
// src/server/services/feed.ts:350-358
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

**Empty set fallback:** If Redis fails, no tombstone filtering occurs. Soft-deleted tweets may appear in feeds until the next PostgreSQL query filters them out.

## Invariants

1. **I-FO1:** All calls to `cacheGet`, `cacheIncr` MUST check for null return before using the value.

2. **I-FO2:** Hardcoded fallback values (like `"1"` for version counters, empty Set for tombstones) MUST be semantically safe defaults that allow the feature to degrade gracefully.

3. **I-FO3:** `cacheSet`, `cacheDel` callers MUST NOT assume success. These operations are fire-and-forget with no return value checks.

4. **I-FO4:** Initialization logic that combines GET (check existence) + INCR (initialize) MUST use the INCR return value, not hardcode the expected result.

5. **I-FO5:** Collection operations that aggregate Redis data (SMEMBERS, LRANGE, MGET) MUST return empty collections on failure, never null or undefined.

## Gotchas

**Don't ignore cacheIncr return values.** The version initialization bug (ac116e7) happened because code assumed INCR always succeeds. Even if Redis is available 99.9% of the time, the 0.1% failure case still needs handling.

**Null from cacheGet means "unknown", not "zero" or "false".** Distinguish between "key does not exist" (legitimate cache miss) and "Redis failed" (degraded operation). Both return null, but the semantic difference matters for debugging.

**Empty collections from fail-open wrappers silently degrade features.** Empty tombstone set means deleted tweets leak into feeds. Empty replay buffer means SSE clients miss recent events. This is acceptable for performance features but document the degradation.

**cacheSet failure is silent but observable.** If `cacheSet` fails, the next request triggers a cache miss and rebuilds the data. Monitor cache hit rates to detect persistent Redis failures.

**Version counter initialization is not idempotent if INCR fails.** If the first `cacheIncr` fails and returns null, we write the cache with hardcoded version "1". If a later request retries `cacheIncr` and it succeeds, the counter becomes 1, but the cached page was already written with version "1" so no cache miss occurs. This is harmless because the versions align, but the counter was initialized by a retry, not the first attempt.

**Fail-open wrappers log at WARN level, not ERROR.** This signals degraded operation, not service failure. ERROR level is reserved for fail-closed operations like auth rate limiting where the request is rejected.

**No automatic retry in application code.** The ioredis client retries up to 3 times with exponential backoff (src/server/redis.ts:15-19). If all retries fail, the wrapper returns null. The application does not retry on top of this — callers use the fallback value immediately.
