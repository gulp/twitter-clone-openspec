# Rate Limiter Retry-After Calculation

## What

Retry-After calculation logic in Redis-based sliding-window rate limiter using atomic Lua script. Computes time (in seconds) until oldest request expires from the window, allowing the next request to proceed.

## Where

- Lua script retry logic: `src/server/services/rate-limiter.ts:69-73`
- HTTP 429 response: `src/server/trpc/routers/auth.ts:60, 166`
- Rate limit check: `src/server/services/rate-limiter.ts:39-121`

## How It Works

### Sliding Window Rate Limiting

Rate limiter uses Redis ZSET (sorted set) with timestamps as scores:

```
Key: rate:{scope}:{identifier}
Members: "timestamp:randomId" (e.g., "1710000000:abc123")
Scores: timestamp in milliseconds
```

**Example (5 requests/minute limit):**
```
rate:auth:ip:192.168.1.1 = {
  "1710000000:a1b2c3" → score 1710000000,
  "1710000015:d4e5f6" → score 1710000015,
  "1710000030:g7h8i9" → score 1710000030,
  "1710000045:j1k2l3" → score 1710000045,
  "1710000060:m4n5o6" → score 1710000060
}
```

At `now = 1710000061`, window is `[1710000061 - 60000, 1710000061] = [1710000001, 1710000061]`.

### Retry-After Calculation (Lua Script)

When rate limit exceeded (`count >= limit`), Lua script calculates retry delay:

```lua
# src/server/services/rate-limiter.ts:69-73
-- Get oldest entry to calculate retryAfter
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local oldestTimestamp = tonumber(oldest[2] or now)
local retryAfter = math.ceil((oldestTimestamp + windowSeconds * 1000 - now) / 1000)
return {0, retryAfter > 0 and retryAfter or 1}
```

**Step-by-step:**

1. **`ZRANGE key 0 0 WITHSCORES`** — Get oldest (lowest score) entry
   - Returns: `["timestamp:randomId", "score"]`
   - Example: `["1710000000:a1b2c3", "1710000000"]`

2. **`tonumber(oldest[2] or now)`** — Extract timestamp (oldest[2] is the score)
   - Fallback to `now` if ZSET is empty (edge case)
   - Example: `1710000000`

3. **`oldestTimestamp + windowSeconds * 1000`** — When oldest entry expires
   - Example: `1710000000 + 60 * 1000 = 1710060000`

4. **`(expiry - now) / 1000`** — Time until expiry (convert ms → seconds)
   - Example: `(1710060000 - 1710000061) / 1000 = 59.939 seconds`

5. **`math.ceil(...)`** — Round up to nearest second
   - Example: `math.ceil(59.939) = 60 seconds`

6. **`retryAfter > 0 and retryAfter or 1`** — Ensure minimum 1 second
   - If calculation yields ≤0 (race condition edge case), return 1

**Return value:** `{0, retryAfter}` where `0` = not allowed, `retryAfter` = seconds to wait

---

### Example Walkthrough

**Scenario:** 5 requests/minute limit, all 5 slots filled

```
Current time: now = 1710000061 (in milliseconds)
Window: 60 seconds (60000 ms)

ZSET contents:
  1710000000:a1b2c3 → score 1710000000  ← oldest entry
  1710000015:d4e5f6 → score 1710000015
  1710000030:g7h8i9 → score 1710000030
  1710000045:j1k2l3 → score 1710000045
  1710000060:m4n5o6 → score 1710000060  ← newest entry

Count: 5 (equals limit)
```

**Calculation:**
```lua
oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
-- Returns: ["1710000000:a1b2c3", "1710000000"]

oldestTimestamp = 1710000000

retryAfter = math.ceil((1710000000 + 60000 - 1710000061) / 1000)
           = math.ceil((1710060000 - 1710000061) / 1000)
           = math.ceil(59939 / 1000)
           = math.ceil(59.939)
           = 60 seconds
```

**Result:** User must wait 60 seconds (when the oldest request from 1710000000 expires at 1710060000).

---

### Edge Cases

#### Edge Case 1: Empty ZSET (Should Never Happen)

If `ZCARD` returns `count >= limit` but `ZRANGE` finds no entries (race condition or Redis corruption):

```lua
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
-- Returns: {}

oldestTimestamp = tonumber(oldest[2] or now)
                = tonumber(nil or now)
                = now

retryAfter = math.ceil((now + windowSeconds * 1000 - now) / 1000)
           = math.ceil(windowSeconds * 1000 / 1000)
           = math.ceil(windowSeconds)
           = windowSeconds  (e.g., 60 seconds for 1-minute window)
```

**Result:** Returns full window duration as retry delay.

#### Edge Case 2: Oldest Entry is "Now" (Tight Race)

Request arrives exactly as oldest entry is being added:

```lua
now = 1710000000
oldestTimestamp = 1710000000  (just added)

retryAfter = math.ceil((1710000000 + 60000 - 1710000000) / 1000)
           = math.ceil(60000 / 1000)
           = math.ceil(60)
           = 60 seconds
```

**Result:** Returns full window duration (expected behavior).

#### Edge Case 3: Negative Retry-After (Clock Skew or Race)

If system clock moves backward or entry expires mid-calculation:

```lua
now = 1710060001
oldestTimestamp = 1710000000
expiry = 1710060000

retryAfter = math.ceil((1710060000 - 1710060001) / 1000)
           = math.ceil(-1 / 1000)
           = math.ceil(-0.001)
           = 0

return {0, retryAfter > 0 and retryAfter or 1}
       {0, 0 > 0 and 0 or 1}
       {0, 1}
```

**Result:** Returns minimum 1 second retry delay (guard against ≤0 values).

---

### HTTP 429 Response Format

tRPC routers return retry-after in error message (not as HTTP header):

```typescript
// src/server/trpc/routers/auth.ts:58-61
if (!rateLimit.allowed) {
  throw new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: `Too many requests. Try again in ${rateLimit.retryAfter} seconds.`,
  });
}
```

**Client receives:**
```json
{
  "error": {
    "code": "TOO_MANY_REQUESTS",
    "message": "Too many requests. Try again in 60 seconds."
  }
}
```

**Not implemented:** HTTP `Retry-After` header (standard for 429 responses).

---

## Invariants

1. **Retry-after is always ≥1 second** — `math.ceil()` + minimum 1-second guard
2. **Retry-after ≤ window duration** — Oldest entry can't be older than window
3. **Calculation is atomic** — Lua script runs without interruption
4. **Round up to whole seconds** — `math.ceil()` ensures no fractional delays
5. **Empty ZSET returns full window** — Fallback to `windowSeconds` if oldest entry missing
6. **Negative values coerced to 1** — Clock skew or race conditions don't return 0 or negative

## Gotchas

1. **Retry-after is in seconds, timestamps in milliseconds** — Must divide by 1000 (line 72)
2. **`math.ceil()` rounds up** — User told to wait 60s even if oldest expires in 59.1s
3. **No HTTP Retry-After header** — Retry delay only in error message JSON, not standard header
4. **Oldest entry defines retry time** — Not "time until window resets"; specific to oldest request
5. **Fallback to `now` is defensive** — Empty ZSET edge case should never happen (count check comes first)
6. **Clock skew can cause incorrect retry-after** — If Redis server clock ≠ app server clock, calculation off
7. **Minimum 1-second guard is last resort** — Prevents returning ≤0, but masks underlying timing issue
8. **Lua `tonumber()` returns `nil` on invalid input** — Fallback to `now` handles this
9. **`ZRANGE ... WITHSCORES` returns array** — `oldest[1]` = member, `oldest[2]` = score (timestamp)
10. **Retry-after precision is 1 second** — Sub-second precision lost (acceptable for rate limiting)

## Client Behavior

When client receives 429 error:

**Current implementation (auth router):**
```typescript
// User sees error message but no automatic retry
// Client must manually retry after delay
```

**Recommended (not implemented):**
```typescript
if (error.code === "TOO_MANY_REQUESTS") {
  const match = error.message.match(/Try again in (\d+) seconds/);
  const retryAfter = match ? parseInt(match[1], 10) : 60;
  
  // Show toast: "Rate limited. Retrying in {retryAfter}s..."
  setTimeout(() => mutation.mutate(input), retryAfter * 1000);
}
```

## Recommendations (Not Implemented)

1. **Add HTTP `Retry-After` header** — Standard for 429 responses (RFC 6585):
   ```typescript
   return new Response(JSON.stringify(error), {
     status: 429,
     headers: {
       "Retry-After": String(rateLimit.retryAfter),
       "Content-Type": "application/json"
     }
   });
   ```

2. **Return retry-after as number in tRPC response** — Easier for clients to parse:
   ```typescript
   throw new TRPCError({
     code: "TOO_MANY_REQUESTS",
     message: `Too many requests.`,
     data: { retryAfter: rateLimit.retryAfter }
   });
   ```

3. **Client-side automatic retry** — tRPC mutation wrapper with exponential backoff
4. **More granular retry calculation** — Use fractional seconds (0.1s precision) for high-throughput APIs
5. **Clock synchronization check** — Log warning if Redis timestamp diverges from app server by >1s
6. **Include window duration in error** — Help users understand "5 requests per minute" context
7. **Rate limit headers on all responses** — `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (Twitter/GitHub pattern)
