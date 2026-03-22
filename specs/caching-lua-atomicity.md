# Lua Scripts for Atomic Redis Operations

## What

Redis Lua scripts execute atomically on the server, preventing race conditions in read-modify-write operations. Used for rate limiting (ZREMRANGEBYSCORE + ZCARD + ZADD) and unread count decrement (GET + DECR with floor at 0).

## Where

- `src/server/redis.ts:119-180` — `authRateLimitCheck` Lua script for sliding-window rate limiting
- `src/server/redis.ts:373-393` — `decrUnreadCount` Lua script for floored decrement

## How It Works

### Sliding-Window Rate Limiting

The `authRateLimitCheck` function uses a Lua script to atomically:
1. Remove expired entries from sorted set (`ZREMRANGEBYSCORE`)
2. Count remaining entries (`ZCARD`)
3. Check if limit exceeded
4. Add new entry if allowed (`ZADD`)
5. Set expiry on the key (`EXPIRE`)

Without Lua, concurrent requests could both read count < limit before either writes, bypassing the rate limit.

```typescript
// src/server/redis.ts:131-163
const luaScript = `
  local key = KEYS[1]
  local now = ARGV[1]
  local windowStart = ARGV[2]
  local limit = ARGV[3]
  local windowSeconds = ARGV[4]
  local member = ARGV[5]

  redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)
  local count = redis.call('ZCARD', key)

  if count >= tonumber(limit) then
    return {0, 0}
  end

  redis.call('ZADD', key, now, member)
  redis.call('EXPIRE', key, windowSeconds)

  return {1, tonumber(limit) - count - 1}
`;

const result = (await redis.eval(
  luaScript,
  1, // number of keys
  key,
  now.toString(),
  windowStart.toString(),
  limit.toString(),
  windowSeconds.toString(),
  member
)) as [number, number];
```

The script returns `[allowed: 0|1, remaining: number]` as a tuple. If `allowed === 1`, the request was added to the rate limit window.

### Floored Decrement

The `decrUnreadCount` function uses Lua to decrement a counter without going negative:

```typescript
// src/server/redis.ts:376-384
const lua = `
  local key = KEYS[1]
  local val = redis.call('GET', key)
  if val and tonumber(val) > 0 then
    return redis.call('DECR', key)
  end
  return 0
`;
await redis.eval(lua, 1, `notification:unread:${userId}`);
```

Without Lua, a plain `DECR` could produce negative counts if concurrent `markRead` calls race.

### Execution Model

Redis Lua scripts:
- Execute **atomically** — no other commands interleave during script execution
- Run on **server side** — no network round-trips between script steps
- Accept `KEYS` (key names) and `ARGV` (arguments) arrays
- Return values to client via `redis.eval()`

Pattern:

```typescript
const result = await redis.eval(
  luaScript,      // script source
  numKeys,        // KEYS array length
  ...keysAndArgs  // KEYS[1..N], ARGV[1..M]
) as ReturnType;
```

## Invariants

**I1**: Lua scripts MUST be idempotent when possible. Rate limit script adds a unique member (`${now}:${random}`) to handle retries safely.

**I2**: Lua scripts MUST NOT call commands that block or have variable execution time (e.g., `KEYS *`, `SCAN`, `BLPOP`). Use bounded operations only.

**I3**: Keys modified by Lua MUST be passed in `KEYS` array (not `ARGV`) for Redis Cluster routing. Even though this project uses single-instance Redis, follow best practice.

**I4**: Lua return values are coerced to Redis protocol types. Use explicit casts in TypeScript: `as [number, number]` for tuples, `as number` for integers.

**I5**: Error handling: if Lua script throws (e.g., `redis.error_reply("message")`), `redis.eval()` throws in Node. Wrap in try/catch if graceful degradation is needed.

## Gotchas

**G1**: Lua scripts do NOT automatically retry on network failure. The `authRateLimitCheck` wrapper rethrows errors to fail-closed (reject request on Redis outage). Other uses should wrap in fail-open logic.

**G2**: DECR/INCR alone can race. Example: two `markRead` calls decrement unread count from 1 → 0 → -1. Lua floors at 0.

**G3**: Avoid large Lua scripts (>100 lines). Redis blocks during script execution. Long-running scripts stall all clients.

**G4**: Lua scripts are NOT cached by `redis.eval()`. For frequently-called scripts, use `redis.script('LOAD', script)` to get SHA hash, then call `redis.evalsha(sha, ...)` to save bandwidth. Not implemented here (premature optimization).

**G5**: Lua number precision: Redis uses double-precision floats in Lua. For large integers (e.g., timestamps in milliseconds), convert to string via `tostring()` if precision matters.

**G6**: Random member suffix in rate limit script (`Math.random().toString(36).slice(2, 8)`) prevents sorted set member collisions if two requests have identical timestamps. Without suffix, `ZADD` would update existing member instead of adding new entry, breaking the count.

**G7**: `windowSeconds` for `EXPIRE` must match the sliding window duration. Mismatched TTLs leak keys or evict active rate limit windows prematurely.
