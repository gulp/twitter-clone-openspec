# Caching TTL Strategy

## What

Time-to-live (TTL) values for different Redis cached data types, balancing freshness requirements against database load. Different data types have different staleness tolerances based on user expectations and mutation frequency.

## Where

- Feed pages: `src/server/services/feed.ts:397` — 60s
- SSE replay buffer: `src/server/redis.ts:404` — 300s (5 min)
- Session allow-list: `src/server/auth.ts:261` — 2,592,000s (30 days)
- User suggestions: `src/server/trpc/routers/social.ts:357` — 300s (5 min)
- Tombstones set: `src/server/trpc/routers/tweet.ts:259` — 60s
- Rate limit windows: `src/server/redis.ts:149` — dynamic (matches window duration)

## How It Works

### Feed Pages (60s)

Cached feed pages expire after 60 seconds:

```typescript
// From src/server/services/feed.ts:397
await cacheSet(cacheKey, JSON.stringify(result), 60, requestId);
```

**Rationale:** Feeds change frequently (new tweets, retweets, deletes). 60s balances:
- User expectation: refresh doesn't need to be instant (unlike Twitter's real-time imperative)
- DB load: prevents home timeline query (complex UNION + dedup) on every request
- Invalidation cost: version bumping invalidates across all followers (O(N) Redis ops)

Feeds also have **version-based invalidation** (see `caching-feed-versioning.md`), so the 60s TTL is a safety net for cases where version bumps fail.

### SSE Replay Buffer (300s / 5 min)

Replay buffers for SSE reconnection expire after 5 minutes:

```typescript
// From src/server/redis.ts:402-404
await redis.lpush(key, eventData);
await redis.ltrim(key, 0, 199); // Keep max 200 entries
await redis.expire(key, 300); // 5-minute TTL
```

**Rationale:** Clients reconnecting after brief disconnects (network blip, tab backgrounded) can replay missed events. 5 minutes covers:
- Typical mobile network interruptions (subway tunnel, elevator)
- Browser tab suspension in mobile Safari/Chrome
- Brief server restarts

After 5 minutes, the client re-fetches from the database instead of replaying. The buffer is capped at 200 entries to prevent unbounded memory growth for high-volume users.

### Session Allow-List (30 days)

Session JTI allow-list entries expire after 30 days:

```typescript
// From src/server/auth.ts:261
await sessionSet(token.jti, token.sub as string, 30 * 24 * 60 * 60);
```

**Rationale:** Matches JWT expiration (30 days). The allow-list is a performance optimization:
- **Fast path:** Redis lookup confirms session validity (no DB query)
- **Fallback:** On cache miss, validate against `User.sessionVersion` in PostgreSQL

Sessions remain valid for 30 days unless explicitly invalidated via:
- Password change → increments `sessionVersion` (all JWTs become invalid)
- Manual logout → deletes specific JTI from allow-list

### User Suggestions (300s / 5 min)

Cached "who to follow" suggestions expire after 5 minutes:

```typescript
// From src/server/trpc/routers/social.ts:357
await cacheSet(cacheKey, JSON.stringify(result), 300);
```

**Rationale:** Suggestions change infrequently (only when follow graph changes). 5 minutes is short enough that:
- New suggestions appear within reasonable time after follow/unfollow
- Cache prevents expensive mutual-connections query (multi-level JOIN) on every request

Suggestions are also **invalidated on follow/unfollow** (cache key is deleted), so 300s is a fallback TTL.

### Tombstones Set (60s)

Deleted tweet IDs in the tombstones set expire after 60 seconds:

```typescript
// From src/server/trpc/routers/tweet.ts:258-259
await redis.sadd("tombstones:tweets", tweetId);
await redis.expire("tombstones:tweets", 60);
```

**Rationale:** Filters deleted tweets from cached feed pages during the 60s feed TTL window. After 60s:
- All cached feed pages referencing the deleted tweet expire
- No need to maintain tombstone set indefinitely

The tombstones set uses a **global key** (`tombstones:tweets`), not per-user. Each `SADD` resets the 60s TTL for the entire set.

### Rate Limit Windows (Dynamic)

Rate limit windows expire based on the configured window duration:

```typescript
// From src/server/redis.ts:149
redis.call('EXPIRE', key, windowSeconds)
```

**Rationale:** Each rate limit scope (e.g., login attempts, password resets) has its own window:
- Login: 900s (15 min) — `src/server/services/rate-limiter.ts:22`
- Password reset request: 3600s (1 hour) — `src/server/trpc/routers/auth.ts:170`

The Lua script sets TTL equal to the window duration, ensuring the sorted set is cleaned up after the window expires.

## Invariants

1. **TTL ≤ staleness tolerance** — Each TTL is chosen such that stale data is acceptable for that duration. Feeds tolerate 60s staleness; suggestions tolerate 300s.

2. **Session TTL = JWT expiration** — The session allow-list TTL (30 days) exactly matches the JWT `exp` claim. This prevents allow-list entries from expiring before the JWT itself.

3. **Feed TTL = tombstone TTL** — Both are 60s. This ensures deleted tweets are filtered from cached feeds for the entire cache lifetime.

4. **Replay buffer TTL > typical reconnect latency** — 300s is sufficient for brief network interruptions but short enough to prevent unbounded memory usage.

5. **No infinite TTLs** — All cached data has an expiration except:
   - `feed:version:{userId}` counters (monotonic, write-only, never read after invalidation)
   - `tombstones:tweets` SET members (but the SET itself has 60s TTL)

6. **Rate limit TTL = window duration** — The window naturally expires when the TTL elapses, preventing stale rate limit state.

## Gotchas

**EXPIRE resets TTL for the entire key** — When adding a new tweet ID to `tombstones:tweets`, the entire SET's TTL resets to 60s. This is intentional: the set should persist as long as any cached feed page might reference any deleted tweet.

**Session allow-list TTL is best-effort** — If Redis fails or restarts, sessions fall back to `sessionVersion` check in PostgreSQL. The allow-list is purely an optimization, not required for correctness.

**Feed cache can serve stale data for up to 60s after version bump** — Version bumps invalidate cache keys, but if Redis INCR fails (network partition), the old cached page remains valid for its TTL. This is acceptable because:
- Fail-open policy prioritizes availability over perfect consistency
- 60s staleness is within user tolerance (not a real-time system)

**Replay buffer size limit is per-user** — The 200-entry cap applies to each user's replay buffer separately. A user with 1000 followers posting rapidly doesn't exhaust the replay buffer for other users.

**cacheSet with no TTL → key never expires** — The `ttlSeconds` parameter is optional (src/server/redis.ts:55). Only `feed:version:{userId}` keys intentionally omit TTL. All other cached data must specify a TTL to prevent unbounded Redis memory growth.

**Tombstone TTL extends on every deletion** — Deleting a tweet calls `EXPIRE tombstones:tweets 60`, resetting the TTL even if the set already existed. During high delete volume, the tombstones set can persist indefinitely (each delete extends the TTL). This is safe because:
- The set only grows with unique tweet IDs (SADD is idempotent)
- Memory usage is bounded by total tweet count
- The set is read on every cache hit (constant cost, low latency)

**Suggestions cache invalidation is eager** — Follow/unfollow immediately deletes the cache key (src/server/trpc/routers/social.ts:110, :178). The 300s TTL only applies when the cache is NOT invalidated (e.g., new mutual connections appear without follow graph changes).
