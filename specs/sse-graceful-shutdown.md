# SSE Graceful Shutdown on SIGTERM

## What

The SSE endpoint implements graceful shutdown on `SIGTERM` by sending `server_restart` events to all active connections, allowing clients to reconnect cleanly without perceived downtime. This ensures zero-disruption deployments with rolling restarts.

## Where

- `src/app/api/sse/route.ts:40-57` — SIGTERM handler, drains active connections
- `src/app/api/sse/route.ts:70-79` — Rejects new connections during shutdown with 503
- `src/hooks/use-sse.ts:213-221` — Client reconnect handler for server_restart event

## How It Works

### Server-Side Drain

The SSE route registers a `SIGTERM` handler at module load time (process-level singleton):

```typescript
// src/app/api/sse/route.ts:40-57
let shutdownInitiated = false;
process.once("SIGTERM", () => {
  shutdownInitiated = true;
  console.log("[SSE] SIGTERM received, draining connections");

  // Send server_restart event to all active connections
  for (const conn of activeConnections) {
    try {
      conn.controller.enqueue("event: server_restart\ndata: {}\n\n");
      conn.controller.close();
    } catch (error) {
      // Connection already closed
    }
  }

  activeConnections.clear();
});
```

**Drain sequence:**
1. `shutdownInitiated` flag set (prevents new connections)
2. Iterate through `activeConnections` Map (userId+connectionId pairs)
3. Send SSE `server_restart` event to each controller
4. Close each stream via `controller.close()`
5. Clear the Map to release references
6. Errors silently caught (connection may already be dead)

### New Connection Rejection

Once `shutdownInitiated` is true, the GET handler returns 503 Service Unavailable:

```typescript
// src/app/api/sse/route.ts:70-79
if (shutdownInitiated) {
  return new Response("event: server_restart\ndata: {}\n\n", {
    status: 503,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

**Why 503 + SSE body:**
- Status 503 signals "temporary unavailability" (load balancers understand)
- SSE body `event: server_restart` triggers client reconnect logic
- Client receives structured event rather than generic HTTP error

### Client-Side Reconnect

The `use-sse` hook listens for `server_restart` and reconnects after 2s delay:

```typescript
// src/hooks/use-sse.ts:213-221
es.addEventListener("server_restart", () => {
  // Server is restarting, reconnect after a short delay
  setIsConnected(false);
  es.close();

  reconnectTimeoutRef.current = setTimeout(() => {
    connect();
  }, 2000);
});
```

**Reconnect flow:**
1. Event received → mark `isConnected = false` (UI shows disconnected state)
2. Close EventSource (clean up browser resources)
3. Wait 2000ms (allows new server instance to become ready)
4. Call `connect()` → re-establish SSE stream
5. On successful connection, UI returns to connected state

### Deployment Flow (Rolling Restart)

1. **Old pod receives SIGTERM** (Kubernetes/orchestrator initiation)
2. **Old pod sends `server_restart` events** to all connected clients (~10ms)
3. **Old pod closes streams** and stops accepting new SSE connections
4. **Clients wait 2s** (graceful delay)
5. **New pod is ready** (health check passes)
6. **Clients reconnect** → routed to new pod by load balancer
7. **Old pod exits** after drain period (Kubernetes default: 30s grace period)

**Result:** No SSE connection errors, no missed events (replay buffer handles gap).

## Invariants

1. **SIGTERM handler registered exactly once** — `process.once()` prevents duplicate handlers
2. **Drain completes before process exit** — all connections notified synchronously (no async database writes)
3. **New connections blocked during shutdown** — `shutdownInitiated` flag checked before authentication
4. **All active connections tracked** — `activeConnections` Map must contain every open stream
5. **Client reconnect delay ≥ pod startup time** — 2s assumes new pod ready in <2s (verify in prod)
6. **Errors during drain are swallowed** — controller.enqueue may fail for dead connections (acceptable)

## Gotchas

### ❌ DON'T: Rely on SIGTERM for data persistence

```typescript
// WRONG: Async database writes during SIGTERM
process.once("SIGTERM", async () => {
  await db.flushPendingEvents();  // ← May not complete
  process.exit(0);
});
```

Node.js may kill the process before async operations finish. SIGTERM is for **notification**, not persistence.

### ✅ DO: Keep drain synchronous

```typescript
// CORRECT: Synchronous stream close
process.once("SIGTERM", () => {
  for (const conn of activeConnections) {
    conn.controller.enqueue("event: server_restart\ndata: {}\n\n");
    conn.controller.close();  // Synchronous
  }
  activeConnections.clear();
});
```

All operations complete before handler returns.

### ❌ DON'T: Assume SIGTERM always fires

**Scenarios where SIGTERM is skipped:**
- `process.exit(0)` called (immediate exit, no cleanup)
- SIGKILL (kill -9) from orchestrator (ungraceful)
- Out-of-memory crash
- Uncaught exception without proper handling

**Mitigation:** Clients already have exponential backoff reconnect logic. Missed `server_restart` events degrade to standard reconnect flow (slower but functional).

### Edge Case: Connection Limit (5) During Rolling Restart

1. User has 5 connections to old pod
2. Old pod sends `server_restart`, closes streams
3. Client waits 2s, reconnects
4. **All 5 connections race to reconnect** to new pod
5. New pod may see burst of 5 concurrent connections (acceptable)

**Connection tracking is per-pod:** Each pod independently tracks its 5-connection limit. During restart, user may briefly exceed limit (old connections + new connections). This self-heals once old pod fully drains.

### Heartbeat Interaction

The SSE heartbeat (30s interval) runs independently:

```typescript
// Heartbeat doesn't check shutdownInitiated
const heartbeatInterval = setInterval(() => {
  controller.enqueue(": heartbeat\n\n");
}, 30000);
```

**During drain:**
- Heartbeat may fire while `server_restart` is being sent
- Not harmful (extra SSE comment line)
- `controller.close()` stops heartbeat automatically (clears interval via cleanup)

### Redis Pub/Sub Cleanup

**Critical:** SSE Redis subscriber is NOT cleaned up in SIGTERM handler:

```typescript
// src/app/api/sse/route.ts (subscriber created but not closed in drain)
const subscriber = await subscribeToSSE(userId, (event) => { /* ... */ });
```

Redis subscriber remains connected during drain. If pod exits before Redis connection cleanup, subscriber may leak for ~30s (Redis timeout).

**Mitigation:** Acceptable leak — Redis connection pool handles timeout. Subscriber is per-connection, not global, so impact is bounded by concurrent user count.

### Load Balancer Behavior

**Assumptions:**
- Load balancer respects 503 status (routes new requests to healthy pods)
- Load balancer doesn't prematurely close existing connections during 503

**If LB violates assumptions:**
- Clients may see abrupt disconnect instead of `server_restart` event
- Reconnect logic still works (exponential backoff triggers)
- Degraded UX but no data loss

### Kubernetes Termination Grace Period

Default grace period: 30 seconds

**Timeline:**
1. t=0s: SIGTERM sent
2. t=0.01s: Drain completes (all streams closed)
3. t=2s: Clients start reconnecting
4. t=30s: SIGKILL sent (if process still running)

**Current implementation:** Process may remain alive for full 30s after drain (Next.js server keeps running). This is wasteful but safe. Could optimize by calling `process.exit(0)` after drain completes.

### Client-Side State During Restart

**Before `server_restart` received:**
- `isConnected === true` (UI shows green indicator)

**After `server_restart` received:**
- `isConnected === false` (UI shows disconnected state)
- 2s delay (no connection)

**After reconnect succeeds:**
- `isConnected === true` (UI returns to normal)

**Total perceived downtime:** ~2 seconds (acceptable for deployment scenario).

## Related Specs

- `sse-connection-management.md` — Client reconnect with exponential backoff, Last-Event-ID replay
- `sse-event-publishing.md` — Replay buffer covers missed events during 2s reconnect window
- `caching-connection-resilience.md` — Redis connection resilience during pod restart
