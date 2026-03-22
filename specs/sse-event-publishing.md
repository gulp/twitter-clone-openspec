# SSE Event Publishing

## What

Atomic event publishing to user SSE streams using Redis Pub/Sub with sequence numbers and replay buffers. Events are published with a Lua script that guarantees atomicity between PUBLISH, sequence assignment, and replay buffer updates to prevent lost events on process crashes.

## Where

- `src/server/services/sse-publisher.ts:79-110` — publishToUser function with Lua script execution
- `src/server/services/sse-publisher.ts:120-161` — publishToFollowers batch publishing
- `src/server/services/sse-publisher.ts:169-229` — High-level event publishing functions (new tweet, notification, deletion)
- `scripts/sse-lua/publish.lua:1-49` — Atomic Lua script for Redis operations
- `src/app/api/sse/route.ts:109-111` — Redis Pub/Sub subscription setup
- `src/app/api/sse/route.ts:181-206` — Event message handling

## How It Works

### Event Types

Three event types are published to SSE streams:

```typescript
// src/server/services/sse-publisher.ts:24-27
export interface SSEEvent {
  type: "new-tweet" | "notification" | "tweet_deleted";
  data: Record<string, unknown>;
}
```

**new-tweet** — Sent to all followers when a user creates a tweet:
```typescript
// src/server/services/sse-publisher.ts:174-180
{
  type: "new-tweet",
  data: {
    tweetId,
    authorUsername: username,
  }
}
```

**notification** — Sent to a single user when they receive a notification:
```typescript
// src/server/services/sse-publisher.ts:201-209
{
  type: "notification",
  data: {
    notification: {
      id, type, actorId, tweetId, createdAt
    }
  }
}
```

**tweet_deleted** — Sent to all followers when a user deletes a tweet:
```typescript
// src/server/services/sse-publisher.ts:222-226
{
  type: "tweet_deleted",
  data: {
    tweetId
  }
}
```

### Atomic Publishing with Lua

Publishing uses a Lua script to guarantee atomicity across six Redis operations:

```lua
# scripts/sse-lua/publish.lua:27-46
local seq = redis.call('INCR', seqKey)                    -- 1. Increment sequence
local event = cjson.decode(eventJson)
event.seq = seq
local eventWithSeq = cjson.encode(event)                   -- 2. Add seq to event
redis.call('PUBLISH', channel, eventWithSeq)               -- 3. Publish to Pub/Sub
redis.call('LPUSH', replayKey, eventWithSeq)               -- 4. Add to replay buffer
redis.call('LTRIM', replayKey, 0, 199)                     -- 5. Trim to 200 entries
redis.call('EXPIRE', replayKey, 300)                       -- 6. Set 5-minute TTL
return seq
```

Called from TypeScript:

```typescript
// src/server/services/sse-publisher.ts:86-90
const seq = (await redis.eval(script, 3, channel, seqKey, replayKey, eventJson)) as number;
```

### Redis Keys

Three key patterns per user:

- `sse:user:{userId}` — Pub/Sub channel for real-time delivery
- `sse:seq:{userId}` — Monotonic sequence counter (INCR)
- `sse:replay:{userId}` — Replay buffer (LIST, max 200 entries, 5-minute TTL)

### Publishing to Followers

Fan-out pattern for tweet events:

```typescript
// src/server/services/sse-publisher.ts:120-151
export async function publishToFollowers(authorId: string, event: SSEEvent) {
  // 1. Query followers from database
  const followers = await prisma.follow.findMany({
    where: { followingId: authorId },
    select: { followerId: true },
  });

  // 2. Publish to all followers in parallel (best-effort)
  const results = await Promise.allSettled(
    followerIds.map((followerId) => publishToUser(followerId, event))
  );

  // 3. Count successes but don't fail on individual errors
  const succeeded = results.filter((r) => r.status === "fulfilled").length;
}
```

### Fallback Behavior

When Redis is unavailable (tests only), falls back to in-memory EventEmitter:

```typescript
// src/server/services/sse-publisher.ts:99-109
} catch (error) {
  log.warn("SSE publishToUser failed, falling back to in-memory", {
    userId,
    eventType: event.type,
    error: error instanceof Error ? error.message : String(error),
  });

  // Fallback to in-memory EventEmitter (tests only)
  inMemoryPublisher.publish(userId, event);
  return null;
}
```

## Invariants

1. **Atomicity**: PUBLISH + LPUSH + LTRIM + EXPIRE execute as a single atomic operation via Lua script
2. **Sequence monotonicity**: Sequence numbers for a given user are strictly increasing (Redis INCR)
3. **Replay buffer size**: Always capped at 200 entries via LTRIM 0 199
4. **Replay buffer TTL**: Always 5 minutes (300 seconds)
5. **Best-effort delivery**: publishToFollowers continues on individual failures (Promise.allSettled)
6. **Event structure**: All events have `seq` field added by Lua script before PUBLISH

## Gotchas

1. **Lua script must be loaded from filesystem** — Script at `scripts/sse-lua/publish.lua` is loaded once and cached. If the file is missing, publishToUser throws immediately (src/server/services/sse-publisher.ts:61).

2. **Sequence numbers are NOT global** — Each user has their own sequence counter (`sse:seq:{userId}`). Sequences are only meaningful within a single user's stream.

3. **Replay buffer is newest-first** — Replay buffer uses LPUSH so newest events are at index 0. The SSE route reverses the list before replaying (src/app/api/sse/route.ts:139).

4. **In-memory fallback is tests only** — Production code expects Redis to be available. In-memory EventEmitter fallback is for test environments where Redis might not be running.

5. **publishToFollowers does NOT fail on partial errors** — Uses Promise.allSettled so a single follower publish failure doesn't block the rest. Check logs for warnings about individual failures.

6. **Event JSON must be valid** — The Lua script uses `cjson.decode` which will fail if the event JSON is malformed. Always validate event structure before calling publishToUser.

7. **Sequence counter never resets** — `sse:seq:{userId}` persists indefinitely (no TTL). Old sequence numbers can be very large. Clients must handle arbitrary sequence values.
