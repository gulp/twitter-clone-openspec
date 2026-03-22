# Redis Connection Resilience

## What

Redis client singleton with automatic reconnection, exponential backoff retry strategy, and dev-mode hot-reload safety. All Redis operations share a single persistent connection that recovers from transient failures without application restart.

## Where

- Redis client initialization: `src/server/redis.ts:1-24`
- Retry strategy configuration: `src/server/redis.ts:15-19`
- Singleton pattern: `src/server/redis.ts:8-23`
- Wrapper retry behavior: `src/server/redis.ts:36-467` (all wrappers)

## How It Works

### Singleton Pattern

Redis client is initialized once and reused across all requests:

```typescript
// src/server/redis.ts:8-10
const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};
```

```typescript
// src/server/redis.ts:12-20
export const redis =
  globalForRedis.redis ??
  new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });
```

In development, the instance is cached in `globalThis` to survive hot module reloads:

```typescript
// src/server/redis.ts:22-23
if (env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
```

### Retry Strategy

`ioredis` automatically retries failed commands with exponential backoff:

```typescript
// src/server/redis.ts:16-19
retryStrategy(times) {
  const delay = Math.min(times * 50, 2000);
  return delay;
}
```

**Backoff schedule:**
- Attempt 1: immediate (0ms)
- Attempt 2: 50ms delay
- Attempt 3: 100ms delay
- Attempt 4: 150ms delay
- After attempt 40+: capped at 2000ms

**Maximum retries:** `maxRetriesPerRequest: 3` means each command gets up to 4 total attempts (1 initial + 3 retries) before failing.

### Connection States

`ioredis` maintains internal connection state machine:

1. **Connecting** — initial TCP handshake to Redis server
2. **Connected** — ready to accept commands
3. **Reconnecting** — lost connection, attempting to restore
4. **Disconnecting** — graceful shutdown in progress
5. **End** — connection permanently closed

Commands issued during `reconnecting` state are queued and executed when connection restores. Commands issued during `end` state throw immediately.

### Wrapper Interaction

Wrappers do NOT implement their own retry logic — they rely on `ioredis` retries:

```typescript
// src/server/redis.ts:36-48
export async function cacheGet(key: string, requestId?: string): Promise<string | null> {
  try {
    return await redis.get(key); // ioredis retries up to 3 times
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "cache",
      operation: "GET",
      key,
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return null; // Only logs after all retries exhausted
  }
}
```

Wrappers catch the error **after** all retries have failed, then apply fail-open/fail-closed policy.

### Dev Mode Hot Reload

Next.js dev server uses Fast Refresh (HMR). Without singleton caching, every module reload would create a new Redis connection:

```typescript
// src/server/redis.ts:22-23
if (env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
```

This ensures only one Redis client exists per dev server process, even as files are edited.

## Invariants

1. **Exactly one Redis client per process** — singleton pattern prevents connection pool exhaustion
2. **Retries happen at ioredis layer** — wrappers never call `redis.*` in a loop
3. **Retry delay grows linearly** — 50ms per attempt, capped at 2s to prevent thundering herd
4. **Max 4 attempts total** — 1 initial + 3 retries (`maxRetriesPerRequest: 3`)
5. **Dev singleton survives HMR** — `globalForRedis.redis` reuse prevents new connections on file save
6. **Commands queue during reconnect** — requests don't fail immediately when connection drops
7. **Connection state is transparent** — application code doesn't check `redis.status`

## Gotchas

1. **Wrapper catch blocks trigger AFTER retries** — When you see a logged error, it means 4 attempts failed (initial + 3 retries), not 1
2. **2-second retry cap prevents indefinite delay** — Even if Redis is down for minutes, individual commands fail within ~6.5 seconds (0 + 50ms + 100ms + 150ms + 2s + 2s + 2s)
3. **Dev mode singleton can mask connection leaks** — In production each process gets exactly one client; in dev the same client is reused even if code would create duplicates
4. **No explicit connection.close() in app code** — Redis client lives for entire process lifetime, no manual cleanup
5. **Queued commands during reconnect can delay responses** — If connection drops mid-request, command waits in queue until reconnect succeeds or maxRetriesPerRequest exhausted
6. **env.REDIS_URL drives connection target** — No runtime reconfiguration; changing Redis host requires process restart
7. **retryStrategy return value controls behavior** — Return `null` or `false` to abort retries; return number to set delay. Current implementation never aborts (always returns a number)
