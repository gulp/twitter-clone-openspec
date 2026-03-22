# Rate Limiting with Fail-Open/Fail-Closed Policies

## What

Redis-backed sliding-window rate limiter prevents abuse of auth endpoints and general API operations. Uses atomic Lua scripts to prevent race conditions. Implements dual failure policies: fail-closed for security-critical auth flows, fail-open for degradable API reads.

## Where

- `src/server/services/rate-limiter.ts:39-121` — checkRateLimit() with Lua script implementation
- `src/server/services/rate-limiter.ts:129-154` — Preset helpers (auth, tweet, general API)
- `src/server/trpc/routers/auth.ts:52-72` — Rate limit enforcement in register endpoint
- `src/server/trpc/routers/auth.ts:158-178` — Rate limit enforcement in requestReset endpoint
- `src/server/redis.ts:119-180` — authRateLimitCheck() wrapper with fail-closed policy

## How It Works

Rate limiting uses Redis sorted sets with timestamp-based members. The Lua script atomically removes expired entries, counts current entries, checks against limit, and adds the new entry if allowed:

```typescript
// src/server/services/rate-limiter.ts:53-81
const luaScript = `
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local windowStart = tonumber(ARGV[2])
  local limit = tonumber(ARGV[3])
  local windowSeconds = tonumber(ARGV[4])
  local member = ARGV[5]

  -- Remove expired entries
  redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)

  -- Get current count
  local count = redis.call('ZCARD', key)

  if count >= limit then
    -- Rate limit exceeded
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local oldestTimestamp = tonumber(oldest[2] or now)
    local retryAfter = math.ceil((oldestTimestamp + windowSeconds * 1000 - now) / 1000)
    return {0, retryAfter > 0 and retryAfter or 1}
  end

  -- Add new entry
  redis.call('ZADD', key, now, member)
  redis.call('EXPIRE', key, windowSeconds)

  return {1, 0}
`;
```

Rate limit presets define different policies:

```typescript
// src/server/services/rate-limiter.ts:20-24
export const RATE_LIMITS = {
  AUTH_IP: { limit: 5, windowSeconds: 60, failClosed: true }, // 5/min per IP
  TWEET_CREATE: { limit: 30, windowSeconds: 3600, failClosed: false }, // 30/hour per user
  GENERAL_API: { limit: 100, windowSeconds: 60, failClosed: false }, // 100/min per user
} as const;
```

Failure handling differs by policy:

```typescript
// src/server/services/rate-limiter.ts:98-120
if (failClosed) {
  // FAIL CLOSED: reject request on Redis failure (security-critical paths)
  log.error("Rate limiter Redis failure (fail closed)", {
    feature: "rate-limit",
    scope,
    identifier,
    error: errorMessage,
  });
  throw new Error("Rate limiting unavailable");
}

// FAIL OPEN: allow request on Redis failure (graceful degradation)
log.warn("Rate limiter Redis failure (fail open)", {
  feature: "rate-limit",
  scope,
  identifier,
  error: errorMessage,
});
return { allowed: true };
```

Auth endpoints convert the "Rate limiting unavailable" exception to INTERNAL_SERVER_ERROR:

```typescript
// src/server/trpc/routers/auth.ts:63-72
} catch (error) {
  // Convert "Rate limiting unavailable" to INTERNAL_SERVER_ERROR
  if (error instanceof Error && error.message === "Rate limiting unavailable") {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Service temporarily unavailable",
    });
  }
  throw error;
}
```

## Invariants

1. **Auth endpoints (register, login, requestReset) use IP-based rate limiting** — 5 requests/minute per IP
2. **Auth rate limiting fails closed** — Redis unavailable = reject all auth requests with 500
3. **Tweet creation uses user-based rate limiting** — 30 tweets/hour per userId
4. **Tweet rate limiting fails open** — Redis unavailable = allow tweet creation (degraded mode)
5. **Lua script is atomic** — no race condition where concurrent requests both pass count check
6. **Sorted set keys expire after window duration** — automatic cleanup via Redis EXPIRE
7. **Members include timestamp + random suffix** — uniqueness guaranteed even for concurrent same-millisecond requests

## Gotchas

- **failClosed=true throws, failClosed=false returns {allowed: true}** — caller must check both exception type and return value
- **IP extraction uses x-forwarded-for split on comma** (`ctx.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()` in auth.ts:28) — assumes reverse proxy sets this header correctly. If no proxy, falls back to x-real-ip.
- **retryAfter is computed from oldest entry** — tells client how many seconds until the oldest request in the window expires and a slot opens up.
- **Member format is `${now}:${random}`** (`${now}:${Math.random().toString(36).slice(2, 8)}` in rate-limiter.ts:49) — timestamp alone is not unique if two requests arrive in same millisecond.
- **Auth endpoints check rate limit BEFORE database queries** — prevents attackers from using rate-limited endpoints to cause database load.
- **Fail-closed errors surface as "Service temporarily unavailable"** — generic message prevents revealing Redis outage to attackers.
- **ZCARD counts all non-expired entries** — Lua script removes expired entries first, so count is always accurate.
- **Window is sliding, not fixed** — if limit is 5/min and you make 5 requests at :00, you can make another at :01 after the :00 request expires.
