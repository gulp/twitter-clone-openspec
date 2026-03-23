# SSE Replay Buffer Exhaustion and Event Loss

## What

SSE replay buffer mechanics when clients reconnect after missing more than 200 events or after the 5-minute TTL expiration. Documents event loss scenarios, client recovery behavior, and the trade-offs between buffer size, TTL, and memory usage.

## Where

- Replay buffer size/TTL: `scripts/sse-lua/publish.lua:28-29` (LTRIM to 200, EXPIRE to 300s)
- Replay logic: `src/app/api/sse/route.ts:129-158` (Last-Event-ID handling)
- Client reconnect: `src/hooks/use-sse.ts:76-117` (exponential backoff + polling fallback)
- Buffer storage: Redis LIST at key `sse:replay:{userId}`

## How It Works

### Replay Buffer Lifecycle

Each user has a dedicated replay buffer: `sse:replay:{userId}` (Redis LIST, newest-first via LPUSH).

**On every published event** (Lua script atomicity):
```lua
# scripts/sse-lua/publish.lua:27-30
LPUSH sse:replay:{userId} {event_with_seq}  # Prepend new event
LTRIM sse:replay:{userId} 0 199              # Keep only newest 200
EXPIRE sse:replay:{userId} 300               # Reset TTL to 5 minutes
```

### Buffer Exhaustion Scenarios

#### Scenario 1: Client Offline for <5 Minutes, <200 Events

**Setup:**
- Client disconnects at seq 1000
- Server publishes events 1001–1050 (50 events)
- Client reconnects after 2 minutes

**Replay flow:**
```typescript
// src/app/api/sse/route.ts:129-149
const lastEventId = "1000";  // From Last-Event-ID header
const replayBuffer = await redis.lrange(`sse:replay:${userId}`, 0, 199);
// replayBuffer = ["seq:1050...", "seq:1049...", ..., "seq:1001..."]

for (const event of replayBuffer.reverse()) {
  const parsed = JSON.parse(event);
  if (parsed.seq > 1000) {  // 1001–1050
    controller.enqueue(`id: ${parsed.seq}\nevent: ${parsed.type}\ndata: {...}\n\n`);
  }
}
```

**Result:** ✅ **Full recovery** — All 50 missed events replayed in order.

---

#### Scenario 2: Client Offline for <5 Minutes, >200 Events

**Setup:**
- Client disconnects at seq 1000
- Server publishes events 1001–1250 (250 events)
- Buffer trimmed after each event: keeps seq 1051–1250, discards 1001–1050
- Client reconnects after 3 minutes

**Buffer state:**
```
sse:replay:{userId} = [1250, 1249, 1248, ..., 1052, 1051]  // 200 events
```

**Replay flow:**
```typescript
const lastEventId = "1000";  // Client expects events after 1000
const replayBuffer = await redis.lrange(`sse:replay:${userId}`, 0, 199);

// Events 1001–1050 NOT in buffer (trimmed)
// Events 1051–1250 ARE in buffer

for (const event of replayBuffer.reverse()) {
  const parsed = JSON.parse(event);
  if (parsed.seq > 1000) {  // 1051–1250 replayed
    // ...
  }
}
```

**Result:** ⚠️ **Partial loss** — Events 1001–1050 (oldest 50) lost. Client receives 1051–1250, leaving a 50-event gap. Client UI shows inconsistent state (missing tweets, missing notifications).

**Client behavior:**
- No error indication (client doesn't know events were lost)
- Feed may have gaps (e.g., tweet #1025 referenced in a reply but not visible)
- User must refresh page to restore consistency

---

#### Scenario 3: Client Offline for >5 Minutes, Any Number of Events

**Setup:**
- Client disconnects at seq 1000
- Server publishes 100 events (1001–1100)
- After 5 minutes of inactivity (no new events), buffer expires

**Redis state:**
```
sse:replay:{userId} = (nil)  # Key expired, buffer gone
```

**Replay flow:**
```typescript
const lastEventId = "1000";
const replayBuffer = await redis.lrange(`sse:replay:${userId}`, 0, 199);
// replayBuffer = []  (empty, key doesn't exist)

// No events to replay
```

**Result:** ⚠️ **Total loss** — All missed events lost. Client receives no replay events.

**Client behavior:**
- Receives only NEW events published after reconnect
- Old feed state is stale (missing all tweets/notifications from offline period)
- User MUST refresh page to load missing content via API

---

#### Scenario 4: Buffer Expires Mid-Disconnect

**Setup:**
- Client disconnects at seq 1000
- Server publishes event 1001 at T+0 (buffer TTL set to T+300s)
- Server publishes event 1002 at T+301s (buffer TTL reset to T+601s)
- Client reconnects at T+550s (before new TTL expires)

**Buffer state at T+550s:**
```
sse:replay:{userId} = [1002]  # Only event 1002; 1001 was in old buffer that expired
```

**Replay flow:**
```typescript
const lastEventId = "1000";
const replayBuffer = await redis.lrange(`sse:replay:${userId}`, 0, 199);
// replayBuffer = ["seq:1002..."]

for (const event of replayBuffer.reverse()) {
  const parsed = JSON.parse(event);
  if (parsed.seq > 1000) {  // Only 1002 replayed
    // ...
  }
}
```

**Result:** ⚠️ **Partial loss** — Event 1001 lost (was in expired buffer). Client receives 1002, creating 1-event gap.

**Why:** Each `PUBLISH` call resets TTL for the CURRENT buffer. If buffer expired before the next event, the new event starts a NEW buffer (old events discarded).

---

### Replay Buffer Memory Cost

**Per-user buffer:** ~10-20 KB (200 events × 50-100 bytes per event)

**Example event size:**
```json
{
  "seq": 1234567890,
  "type": "new-tweet",
  "data": {"tweetId": "cuid...", "authorUsername": "alice"}
}
```

Serialized: ~90 bytes

**Total memory (10k active users):**
```
10,000 users × 15 KB avg = 150 MB
```

**Redis memory overhead:**
- LIST structure: ~24 bytes per entry
- Key overhead: ~50 bytes
- Total per buffer: ~18 KB (200 events × 90 bytes + 200 × 24 bytes + 50 bytes)

**At scale (100k users):** ~1.8 GB just for replay buffers

---

### Why 200 Events and 5 Minutes?

**200 event limit:**
- Handles moderate disconnects (network blip, tab backgrounded)
- Prevents unbounded memory growth
- Typical user sees <200 events in 5 minutes (unless following high-volume accounts)

**5-minute TTL:**
- Balances memory usage vs replay window
- Auto-cleans buffers for idle users (inactive users don't accumulate events forever)
- Long enough to cover temporary network issues, short enough to prevent stale data

**Trade-offs:**
- **Larger buffer** → more memory, better replay coverage
- **Longer TTL** → more Redis keys persisted, higher memory baseline
- **Shorter TTL** → faster expiration, more frequent total loss

---

## Invariants

1. **Buffer size capped at 200 events** — LTRIM guarantees newest 200 kept, oldest discarded (FIFO)
2. **TTL resets on every event** — Each PUBLISH resets TTL to 300s from current time
3. **Buffer expiration is absolute** — 5 minutes with NO new events = buffer deleted
4. **Replay is best-effort, not guaranteed** — Client MAY lose events if offline too long or too many events published
5. **No error on event loss** — Client doesn't know events were lost; silently skips gap
6. **Buffer uses LPUSH (newest-first)** — Server must reverse list before replaying (src/app/api/sse/route.ts:134)
7. **Empty buffer (expired or never created) returns empty list** — No error thrown, just []

## Gotchas

1. **No gap detection** — Client receives seq 1050 after seq 1000 with no indication that 1001–1049 were lost
2. **TTL reset is per-event, not per-user** — If user has 5 followers and all publish simultaneously, buffer gets 5 TTL resets (one per `PUBLISH`)
3. **Buffer disappears silently** — No Redis notification when buffer expires; client reconnects to find empty buffer
4. **Replay order is critical** — Forgot to `.reverse()` → events delivered newest-first, breaking causality (replies before original tweets)
5. **Malformed events skipped silently** — If `JSON.parse(event)` fails during replay, that event is skipped (src/app/api/sse/route.ts:142 empty catch block)
6. **Polling fallback doesn't fix gaps** — After 3 SSE failures, client switches to polling `unreadCount` only; doesn't backfill missed tweets
7. **No per-event TTL** — All 200 events in buffer share same TTL; can't have "last 50 events for 30 minutes, next 150 for 5 minutes"
8. **Concurrent LTRIM is safe (atomic Lua)** — Multiple followers publishing to same user won't corrupt buffer (each `publish.lua` is atomic)
9. **Idle users keep expired buffers** — If user goes offline before buffer expires, buffer sits in Redis until TTL expires (not reclaimed immediately on disconnect)
10. **Reconnect within heartbeat window (30s) doesn't use replay** — Browser EventSource stays connected; Last-Event-ID only sent on CLOSE + RECONNECT
11. **High-traffic users hit 200 limit faster** — Celebrity with 10k active followers may exhaust buffer in <1 minute during viral tweet
12. **Buffer size is per-user, not per-connection** — User with 5 open tabs shares single replay buffer; all tabs get same replay events

## Client Recovery Strategies

When events are lost, client has three options:

**1. Silent degradation (current implementation)**
- Accept gaps, rely on user refresh
- Simple, no additional server load
- Poor UX for users with unreliable networks

**2. Gap detection + API backfill (not implemented)**
```typescript
// Hypothetical: detect seq gap and query API
if (lastSeq && newSeq > lastSeq + 1) {
  const gap = newSeq - lastSeq - 1;
  console.warn(`SSE gap detected: ${gap} events lost`);
  // Fetch missed content via API
  await trpc.feed.getHome.query({ limit: gap });
}
```

**3. Full reload (manual)**
- User refreshes page → all feeds re-query → consistent state
- Highest UX cost (loses scroll position, form state)
- Only option for >200 event loss

## Recommendations (Not Implemented)

1. **Increase buffer to 500 events** for high-traffic accounts (at cost of 2.5× memory)
2. **Increase TTL to 10 minutes** to cover longer disconnects (at cost of ~2× memory baseline)
3. **Add gap detection** on client — show "N new tweets" banner when seq gap detected
4. **Expose replay metadata** — include `replayBufferSize` in connection response so client knows coverage
5. **Per-account buffer sizing** — Verified users get 1000-event buffer, normal users get 200
6. **Redis Streams instead of LIST** — better replay semantics, consumer groups, exact-once delivery
7. **Persistent replay buffer** — Store replay buffer to disk (Redis AOF), survive Redis restarts
8. **Client-side sequence tracking** — Store last received seq in localStorage, detect gaps across page reloads
