# SSE Replay Buffer Exhaustion

## What

The SSE replay buffer stores the last 200 events per user with a 5-minute TTL. When the buffer fills (>200 events) or expires (no events for 5 minutes), older events are lost. Clients that reconnect after exhaustion miss notifications, relying on polling fallback or full feed refresh to catch up.

## Where

- Lua script: `scripts/sse-lua/publish.lua:42-46` — LTRIM to 200 entries, 5-minute EXPIRE
- Replay logic: `src/app/api/sse/route.ts:129-158` — Last-Event-ID handling
- Client reconnect: `src/hooks/use-sse.ts:81-84` — EventSource auto-reconnect
- Fallback polling: `src/hooks/use-sse.ts:178-195` — 30s refresh on connection failure

## How It Works

### Buffer Storage (Per-User Redis List)

Each user has a Redis LIST key `sse:replay:{userId}` that stores recent events:

```lua
-- scripts/sse-lua/publish.lua:40-46
redis.call('LPUSH', replayKey, eventWithSeq)  -- Add newest event to head
redis.call('LTRIM', replayKey, 0, 199)        -- Keep only 200 most recent
redis.call('EXPIRE', replayKey, 300)          -- Reset 5-minute TTL
```

**Key properties:**
- LPUSH adds events to list head (newest first)
- LTRIM immediately removes events beyond index 199 (keeps 0-199, 200 events total)
- EXPIRE resets TTL to 300s on every new event
- If no events for 5 minutes, entire list expires (Redis DEL)

### Replay on Reconnect

When client reconnects with `Last-Event-ID: <seq>`, server replays missed events:

```typescript
// src/app/api/sse/route.ts:129-158
const lastEventId = req.headers.get("Last-Event-ID");
if (lastEventId) {
  const lastSeq = Number.parseInt(lastEventId, 10);
  const replayBuffer = await redis.lrange(`sse:replay:${userId}`, 0, 199);

  // Replay buffer is newest-first, reverse for chronological order
  for (const event of replayBuffer.reverse()) {
    const parsed = JSON.parse(event);
    if (parsed.seq > lastSeq) {
      // Send event to client
      controller.enqueue(`id: ${parsed.seq}\nevent: ${parsed.type}\ndata: ${JSON.stringify(parsed.data)}\n\n`);
    }
  }
}
```

**Replay algorithm:**
1. Fetch entire buffer (0-199 indices, up to 200 events)
2. Reverse list to get chronological order (oldest → newest)
3. Filter events where `seq > lastSeq` (missed events)
4. Send filtered events to client before live stream starts

### Exhaustion Scenario 1: Buffer Overflow (>200 Events)

**Timeline:**
1. User disconnects at seq 1000
2. 250 events published while disconnected (seq 1001-1250)
3. LTRIM keeps only seq 1051-1250 (200 most recent)
4. Events 1001-1050 are lost (trimmed)
5. User reconnects with `Last-Event-ID: 1000`
6. Replay sends events 1051-1250 (only 200 events)
7. **Gap:** Events 1001-1050 permanently missed

**Client-side impact:**
- Notifications list incomplete (50 missed notifications)
- Feed may show tweets the user "should have seen" via SSE
- No error indication (client doesn't know events were dropped)

**Mitigation:**
- Client polling fallback queries `/api/trpc/notification.list` on reconnect
- Full feed refresh via tRPC query on connection restore
- UI: No UX indication of missed events (graceful degradation)

### Exhaustion Scenario 2: TTL Expiration (5-Minute Idle)

**Timeline:**
1. User disconnects at seq 1000
2. No events published for 6 minutes (low-activity account)
3. Redis EXPIRE triggers, `sse:replay:{userId}` key deleted
4. User reconnects with `Last-Event-ID: 1000`
5. `redis.lrange()` returns empty array (key doesn't exist)
6. Replay sends nothing
7. **Gap:** All events since seq 1000 missed (if any were published before expiration)

**Example:** User goes offline for 4 minutes 59 seconds, receives 10 events, then reconnects → replay works. User goes offline for 5 minutes 1 second → replay buffer expired, no history.

**Client-side impact:**
- Potentially zero notifications after 5+ minute disconnect
- Feed refresh required to see new content
- Unread count may be stale until refresh

**Mitigation:**
- 5-minute TTL is generous for typical mobile app backgrounding (~1-2 minutes)
- Client auto-refreshes on reconnect (see "Fallback Polling" below)
- Notification unread count cached in Redis (`notification:unread:{userId}`) survives longer than replay buffer

### Exhaustion Scenario 3: High-Volume User (Burst >200 Events)

**Timeline:**
1. User is a celebrity with 1M followers
2. User posts a tweet
3. `publishToFollowers()` publishes `new_tweet` event to all 1M followers
4. One follower is offline during publish
5. Follower receives 200+ events (their feed, mentions, likes, retweets)
6. Only last 200 events survive in replay buffer
7. Follower reconnects → misses early events

**Real-world example:** Elon Musk posts, 100M followers each get notification. Offline user comes back online → buffer only has last 200 events (mix of Musk + other followed accounts). Musk's tweet notification may be pushed out of buffer by other activity.

**Mitigation:**
- Notification deduplication (`dedupeKey` unique constraint) prevents duplicate SSE events
- High-priority notifications (direct mentions) published first (not implemented in v1)
- Client polls `/api/trpc/notification.list` to fetch full history

### Client Fallback Polling

When SSE connection fails or replay is incomplete, client falls back to polling:

```typescript
// src/hooks/use-sse.ts:178-195
if (reconnectAttempts >= 3) {
  setIsFallback(true);
  pollingInterval = setInterval(() => {
    queryClient.invalidateQueries({ queryKey: ["feed"] });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }, 30000); // 30s poll interval
}
```

**Fallback triggers:**
- SSE connection fails 3+ times
- Browser EventSource error
- Network unreachable

**Polling behavior:**
- Invalidate tRPC queries every 30s
- React Query refetches feed + notifications
- No SSE overhead, pure HTTP polling

**Exit polling:** Client retries SSE connection every minute (exponential backoff capped at 60s).

## Invariants

1. **Buffer size capped at 200** — LTRIM enforces strict limit (events 200+ immediately dropped)
2. **TTL resets on every event** — Active users never see expiration (as long as events published <5min intervals)
3. **FIFO eviction** — Oldest events trimmed first (LPUSH + LTRIM 0-199 = newest at index 0)
4. **Replay is read-only** — Replaying events does NOT remove them from buffer (LRANGE doesn't mutate)
5. **No gap detection** — Client cannot distinguish "replay complete" from "events lost"
6. **Replay happens once** — On connection start only, not continuously
7. **Sequence numbers monotonic per-user** — `sse:seq:{userId}` increments forever (no wrap-around)

## Gotchas

### ❌ DON'T: Assume replay always succeeds

```typescript
// WRONG: Assume all missed events are in replay buffer
const lastSeq = getLastSeenSeq();
reconnect();
// ← If >200 events or >5min passed, some events are lost
```

**Correct approach:** Refresh data via tRPC on reconnect:

```typescript
// CORRECT: Invalidate queries to refetch
eventSource.addEventListener("open", () => {
  queryClient.invalidateQueries({ queryKey: ["feed"] });
  queryClient.invalidateQueries({ queryKey: ["notifications"] });
});
```

### ❌ DON'T: Increase buffer size to 10,000 "to be safe"

**Problem:** Redis memory usage scales with buffer size × active users:
- 200 events × 10k users × 1KB/event = 2GB Redis memory
- 10,000 events × 10k users × 1KB/event = 100GB Redis memory (expensive)

**Correct approach:** Keep buffer small, rely on database queries for full history.

### Edge Case: Seq Number Gaps After Buffer Overflow

**Scenario:**
1. Client receives event seq=1000, disconnects
2. Events 1001-1250 published (250 events)
3. LTRIM keeps 1051-1250
4. Client reconnects, replays 1051-1250
5. Client's sequence jumps from 1000 → 1051 (50-event gap)

**Client-side detection:**

```typescript
// DETECT: seq jump > 1 indicates missed events
if (event.seq > lastSeq + 1) {
  console.warn(`Missed ${event.seq - lastSeq - 1} events`);
  // Optionally invalidate queries here
}
```

**Current implementation:** Client does NOT detect gaps (no check for `seq > lastSeq + 1`).

### Edge Case: Race Between Expire and New Event

**Scenario:**
1. Last event published at T=0s (EXPIRE set to T+300s)
2. User idle for 4 minutes 59 seconds
3. At T=299s, new event published
4. EXPIRE command in Lua script resets TTL to T+599s
5. **No data loss**

**Why it works:** EXPIRE is inside atomic Lua script. If script executes, TTL is reset BEFORE Redis can expire the key.

**Edge case failure:**
1. Last event at T=0s
2. User idle exactly 5 minutes
3. At T=300s, Redis expires key (async operation)
4. At T=300.001s, new event tries to LPUSH
5. LPUSH creates new key (LTRIM operates on 1-element list)
6. **Result:** Replay buffer now only has 1 event (newest), all prior history lost

**Probability:** Very low (requires event publish within milliseconds of expiration).

### TTL Does NOT Extend on Read

```typescript
// LRANGE does NOT reset TTL
const buffer = await redis.lrange(`sse:replay:${userId}`, 0, 199);
// ← TTL unchanged, buffer can expire mid-replay
```

**Consequence:** If user reconnects after 4min 59s idle, fetches replay buffer, then another user publishes event at 5min 1s, the key might expire between LRANGE and new LPUSH. Not a data loss (new event creates new buffer), but replay shows no history.

### Replay Buffer vs. Notification Unread Count

**Separate systems:**
- Replay buffer: 200 events, 5min TTL
- Unread count: single INTEGER (`notification:unread:{userId}`), no TTL (persists indefinitely)

**Inconsistency scenario:**
1. User has 50 unread notifications (Redis `notification:unread:{userId} = 50`)
2. User goes offline for 6 minutes
3. Replay buffer expires (5min TTL)
4. User reconnects, sees "50 unread" indicator (from Redis)
5. Replay sends 0 events (buffer expired)
6. **UX:** "50 unread" but no new notifications in list

**Mitigation:**
- Client queries `/api/trpc/notification.list` on reconnect
- Unread count is advisory (not authoritative — DB is source of truth)
- Notification list query respects `read: false` filter

### LTRIM Index Off-by-One Gotcha

```lua
redis.call('LTRIM', replayKey, 0, 199)  -- Keeps indices 0-199 (200 elements)
```

**NOT:**
```lua
redis.call('LTRIM', replayKey, 0, 200)  -- Would keep indices 0-200 (201 elements)
```

LTRIM uses inclusive range. `0, 199` means "keep first 200 elements" (indices 0 through 199).

## Related Specs

- `sse-event-publishing.md` — Lua script atomicity, sequence number generation
- `sse-connection-management.md` — Client reconnect with Last-Event-ID, exponential backoff
- `sse-graceful-shutdown.md` — SIGTERM draining doesn't clear replay buffer
- `caching-ttl-strategy.md` — TTL values (replay buffer: 5m, unread count: ∞, feed cache: 60s)
