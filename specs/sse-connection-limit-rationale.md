# SSE Connection Limit Rationale

## What

Server-side connection limit of 5 concurrent SSE connections per user to prevent resource exhaustion while allowing reasonable multi-device and multi-tab usage. Enforced via Redis SET tracking with fail-open degradation on Redis failure.

## Where

- Limit enforcement: `src/app/api/sse/route.ts:81-92`
- Connection tracking: `src/server/redis.ts:240-275` (sseAddConnection, sseGetConnections, sseRemoveConnection)
- Limit constant: Hardcoded as `>= 5` check (line 83)

## How It Works

### Connection Limit Check

Before accepting a new SSE connection, server queries Redis to count existing connections:

```typescript
// src/app/api/sse/route.ts:81-92
// Check connection limit (max 5 per user)
const existingConnections = await sseGetConnections(userId);
if (existingConnections.length >= 5) {
  return new Response('event: error\ndata: {"message":"Too many connections"}\n\n', {
    status: 429,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

**Connection tracking:**
```typescript
// src/server/redis.ts:240-254
export async function sseAddConnection(userId: string, connectionId: string): Promise<void> {
  try {
    const key = `sse:connections:${userId}`;
    await redis.sadd(key, connectionId);
    // Set expiry so stale connections are cleaned up after server crashes.
    await redis.expire(key, 120);
  } catch (error) {
    log.warn("Redis operation failed", { feature: "sse", operation: "sseAddConnection" });
  }
}
```

Each connection gets unique ID: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}` (src/app/api/sse/route.ts:95)

### Why 5 Connections?

**Typical user scenarios:**

1. **Multi-device usage**
   - Desktop browser: 1 connection
   - Mobile phone: 1 connection
   - Tablet: 1 connection
   - Total: 3 devices = 3 connections

2. **Multi-tab browsing**
   - User opens app in 2-3 browser tabs (e.g., home feed + notifications + profile)
   - Each tab opens separate SSE connection (browser EventSource creates new connection per instance)
   - Total: 3 tabs = 3 connections

3. **Development/debugging**
   - Developer with prod account open in browser + mobile app + testing
   - 5-connection limit allows reasonable dev workflow without constant 429 errors

**Why not higher?**

- Each SSE connection holds:
  - 1 Redis Pub/Sub subscriber (1 TCP connection to Redis)
  - 1 HTTP response stream (server memory for buffering)
  - 1 heartbeat setInterval (30s timer)
  - 1 entry in activeConnections Set (in-memory tracking)

- 100k active users × 10 connections each = 1M Redis subscribers + 1M open HTTP streams → resource exhaustion

- 5 connections per user = generous for legitimate use, restrictive enough to prevent abuse

**Why not lower?**

- 1-2 connections too restrictive (users with multiple devices get locked out)
- 3-4 connections marginal (doesn't account for accidentally-left-open tabs)

**Security considerations:**

- Prevents malicious user from opening thousands of connections to DoS the SSE endpoint
- Each connection consumes Redis + server resources even if idle (heartbeat overhead)
- Limit is per-user (authenticated), not per-IP (would be trivial to bypass with multiple accounts)

---

### Typical Connection Count Distribution

**Expected distribution (based on common usage patterns):**

| Connections | Use Case | % of Users (estimate) |
|-------------|----------|----------------------|
| 0 | Logged out or inactive | 70% |
| 1 | Single device, single tab | 20% |
| 2-3 | Multi-tab or multi-device | 8% |
| 4-5 | Power user (desktop + mobile + leftover tabs) | 1.5% |
| >5 | Rejected with 429 | 0.5% (accidental or malicious) |

**At scale (100k active users):**
- 30k users with 1 connection = 30k SSE streams
- 8k users with 2-3 connections = ~20k SSE streams
- 1.5k users with 4-5 connections = ~7k SSE streams
- **Total:** ~57k concurrent SSE connections (avg 1.9 connections per user)

**Peak scenario (e.g., viral event, all users online):**
- If 50% of users hit 5-connection limit: 100k × 0.5 × 5 + 100k × 0.5 × 1.5 = 325k connections
- Each connection = 1 Redis subscriber (~50 KB overhead) + HTTP stream (~10 KB buffer) = ~60 KB
- **Total memory:** 325k × 60 KB = ~19 GB for SSE infrastructure

---

### Limit Enforcement Edge Cases

#### Race Condition (Non-Atomic Check)

Current implementation has a small race window:

```typescript
const existingConnections = await sseGetConnections(userId);  // Time T
if (existingConnections.length >= 5) { ... }                  // Time T+5ms
await sseAddConnection(userId, connectionId);                  // Time T+10ms
```

Two requests arriving simultaneously can both see `length=4`, both proceed, resulting in 6 total connections.

**Impact:** Low severity (worst case: 1-2 extra connections briefly, cleaned up on next heartbeat failure or connection close)

**Mitigation (not implemented):** Lua script for atomic check-and-add:
```lua
local count = redis.call('SCARD', key)
if count >= 5 then
  return {err = 'Too many connections'}
end
redis.call('SADD', key, connectionId)
return {ok = 'Connection added'}
```

#### Fail-Open on Redis Error

```typescript
export async function sseAddConnection(userId: string, connectionId: string): Promise<void> {
  try {
    await redis.sadd(key, connectionId);
  } catch (error) {
    log.warn("Redis operation failed", { operation: "sseAddConnection" });
    // NO THROW — fail open
  }
}
```

If Redis is down, connection tracking fails silently → **unlimited connections allowed** (fail-open policy)

**Rationale:** SSE is critical for user experience. Better to allow unlimited connections temporarily than reject all SSE requests when Redis is unavailable.

#### Stale Connections (Zombie Cleanup)

If server crashes mid-connection, Redis SET retains stale connectionIds until TTL expires (120s).

**Scenario:**
- User has 5 connections
- Server crashes, all connections drop
- Redis SET still shows 5 connections for next 2 minutes
- User reconnects immediately → 429 Too Many Connections

**Mitigation:** 120-second TTL is refreshed on every heartbeat (30s interval). Stale connections expire within 2 minutes of server crash.

**Impact:** Users may get transient 429 errors for ~2 minutes after server restart.

---

## Invariants

1. **Limit is 5 connections per user** — Hardcoded constant, not configurable
2. **Limit is per-user, not per-IP** — Tied to authenticated session userId
3. **6th connection gets 429 Too Many Connections** — Immediate rejection at line 84-91
4. **Connection tracking is fail-open** — Redis errors allow unlimited connections
5. **Stale connections auto-expire after 120 seconds** — TTL cleaned up even if server crashes
6. **Heartbeat refreshes TTL every 30 seconds** — Active connections never expire

## Gotchas

1. **Hardcoded limit** — Cannot be configured per-user or via environment variable. Must edit code to change.
2. **Race condition allows 6+ connections briefly** — Two concurrent requests can bypass check
3. **Fail-open degrades limit** — Redis outage allows unlimited connections (memory exhaustion risk)
4. **ConnectionId collision possible** — `Date.now() + Math.random()` has ~1 in 2 billion collision per ms
5. **Stale connections block reconnect** — After server crash, user may hit 429 for up to 120 seconds
6. **No per-connection resource tracking** — Can't distinguish between idle and active connections when enforcing limit
7. **Browser tabs share no coordination** — Each tab independently opens SSE connection; no localStorage-based connection pooling
8. **429 response is SSE event, not HTTP error** — Client sees `event: error\ndata: {...}` and may misinterpret as transient error, triggering reconnect loop
9. **No gradual degradation** — Either full SSE (up to 5 connections) or 429 rejection; no option to share connection across tabs
10. **Cleanup on close is best-effort** — If server process is SIGKILL'd, cleanup() never runs; relies on TTL expiration

## Recommendations (Not Implemented)

1. **Make limit configurable** — Environment variable `SSE_MAX_CONNECTIONS_PER_USER=5`
2. **Atomic check-and-add** — Lua script to prevent race condition
3. **Per-user limit tiers** — Verified users get 10 connections, normal users get 5
4. **Connection pooling** — Client-side localStorage coordination to share SSE across tabs
5. **Graceful degradation** — After limit hit, fallback to polling instead of rejecting
6. **Connection priority** — Allow new connection to evict oldest idle connection
7. **Better error message** — Include `retryAfter` in 429 response (e.g., "Try again in 120 seconds")
8. **Metrics** — Track connection count distribution (how many users hit limit)
