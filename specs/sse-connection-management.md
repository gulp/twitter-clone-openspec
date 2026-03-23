# SSE Connection Management and Reconnect

## What

SSE connections use client-side exponential backoff reconnect (max 30s), server-side connection tracking with 5-connection-per-user limit, Last-Event-ID replay for missed events, 30-second heartbeat to detect stale connections, and SIGTERM draining for zero-downtime deployments. Connection tracking uses Redis SET with 120-second TTL refreshed on every heartbeat.

## Where

- `src/hooks/use-sse.ts:41-259` — Client-side reconnect hook with exponential backoff
- `src/hooks/use-sse.ts:76-117` — Reconnect logic and fallback to polling
- `src/app/api/sse/route.ts:59-98` — Connection limit enforcement (max 5 per user)
- `src/app/api/sse/route.ts:129-158` — Last-Event-ID replay from Redis buffer
- `src/app/api/sse/route.ts:160-178` — Heartbeat interval setup
- `src/app/api/sse/route.ts:40-57` — SIGTERM handler for graceful shutdown
- `src/server/redis.ts:240-309` — SSE connection tracking functions

## How It Works

### Client-Side Reconnect with Exponential Backoff

The React hook handles connection failures with progressive backoff:

```typescript
// src/hooks/use-sse.ts:99-116
es.onerror = () => {
  setIsConnected(false);
  es.close();

  reconnectAttemptsRef.current += 1;

  // After 3 consecutive failures, fall back to polling
  if (reconnectAttemptsRef.current >= 3) {
    setIsFallback(true);
    return;
  }

  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
  const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 30000);

  reconnectTimeoutRef.current = setTimeout(() => {
    connect();
  }, delay);
};
```

**Backoff schedule:**
- Attempt 1: 1s delay
- Attempt 2: 2s delay
- Attempt 3: 4s delay (then switches to polling fallback)

**Successful connection resets counter:**

```typescript
// src/hooks/use-sse.ts:93-96
es.onopen = () => {
  setIsConnected(true);
  reconnectAttemptsRef.current = 0; // Reset on successful connection
  setIsFallback(false);
};
```

### Polling Fallback

After 3 consecutive SSE failures, the hook falls back to polling `notification.unreadCount` every 30 seconds:

```typescript
// src/hooks/use-sse.ts:58-62
trpc.notification.unreadCount.useQuery(undefined, {
  enabled: isFallback && status === "authenticated",
  refetchInterval: 30000, // Poll every 30s
});
```

This ensures clients with restrictive firewalls or proxies that block SSE can still receive notifications, albeit with higher latency.

**Periodic SSE retry:** The hook retries SSE connection every 5 minutes when in fallback mode:

```typescript
// src/hooks/use-sse.ts:251-267
const startFallbackRetry = useCallback(() => {
  // Clear any existing retry timer
  if (fallbackRetryTimeoutRef.current) {
    clearTimeout(fallbackRetryTimeoutRef.current);
  }

  // Retry SSE connection after 5 minutes
  fallbackRetryTimeoutRef.current = setTimeout(() => {
    // Reset attempts to give fresh 3-attempt window
    reconnectAttemptsRef.current = 0;
    setIsFallback(false);
    connect();
  }, 5 * 60 * 1000); // 5 minutes
}, [connect]);
```

This allows clients to automatically recover from transient network issues (e.g., moving from corporate wifi that blocks SSE to mobile network) without requiring a page refresh.

### Connection Limit Enforcement

The server limits each user to 5 concurrent SSE connections:

```typescript
// src/app/api/sse/route.ts:81-92
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

**Connection tracking:** Each connection gets a unique ID and is added to a Redis SET:

```typescript
// src/app/api/sse/route.ts:94-98
const connectionId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
await sseAddConnection(userId, connectionId);
```

Redis tracking functions (fail-open):

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

### Last-Event-ID Replay

The browser automatically sends `Last-Event-ID` header on reconnect. The server replays missed events:

```typescript
// src/app/api/sse/route.ts:129-158
const lastEventId = req.headers.get("Last-Event-ID");
if (lastEventId) {
  try {
    const lastSeq = Number.parseInt(lastEventId, 10);
    if (!Number.isNaN(lastSeq)) {
      // Fetch replay buffer from Redis
      const replayBuffer = await redis.lrange(`sse:replay:${userId}`, 0, 199);

      // Replay buffer is newest-first (LPUSH), reverse for chronological order
      for (const event of replayBuffer.reverse()) {
        try {
          const parsed = JSON.parse(event);
          if (parsed.seq > lastSeq) {
            const sseEvent = `id: ${parsed.seq}\nevent: ${parsed.type}\ndata: ${JSON.stringify(parsed.data)}\n\n`;
            controller.enqueue(encoder.encode(sseEvent));
          }
        } catch {
          // Skip malformed replay event
        }
      }
    }
  } catch (error) {
    console.warn("[SSE] Replay failed:", { userId, lastEventId, error });
  }
}
```

**Replay window:** Up to 200 events or 5 minutes (whichever is smaller). Events outside this window are lost — clients must reload the page or query the API.

### Heartbeat Mechanism

Server sends heartbeat comments every 30 seconds to detect broken connections:

```typescript
// src/app/api/sse/route.ts:160-178
heartbeatInterval = setInterval(() => {
  if (isClosed) return;

  try {
    controller.enqueue(encoder.encode(": heartbeat\n\n"));

    // Refresh Redis TTL so stale connections auto-expire on crash
    sseRefreshConnectionTTL(userId).catch(() => {});

    log.info("SSE heartbeat", {
      userId,
      activeConnections: activeConnections.size,
    });
  } catch (error) {
    // Write failed - connection broken
    cleanup();
  }
}, 30000);
```

**TTL refresh:** Each heartbeat extends the Redis connection tracking TTL to 120 seconds. This ensures crashed server processes don't leave zombie connections in Redis indefinitely.

```typescript
// src/server/redis.ts:298-308
export async function sseRefreshConnectionTTL(userId: string): Promise<void> {
  try {
    await redis.expire(`sse:connections:${userId}`, 120);
  } catch (error) {
    log.warn("Redis operation failed", { operation: "sseRefreshConnectionTTL" });
  }
}
```

### SIGTERM Graceful Shutdown

On deployment or scale-down, the server sends `server_restart` event to all active connections:

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

**Client handling:**

```typescript
// src/hooks/use-sse.ts:225-234
es.addEventListener("server_restart", () => {
  // Server is restarting, reconnect after a short delay
  setIsConnected(false);
  es.close();

  reconnectTimeoutRef.current = setTimeout(() => {
    connect();
  }, 2000);
});
```

Clients reconnect after 2 seconds (with Last-Event-ID replay) while old server pod finishes draining. This prevents lost events during deployments.

## Invariants

1. **Max 5 connections per user.** Enforced server-side with Redis SET. 6th connection attempt returns 429 Too Many Connections.

2. **Connection TTL is 120 seconds.** Redis SET expires 120s after last heartbeat. Stale connections from crashed servers auto-expire without manual cleanup.

3. **Heartbeat every 30 seconds.** Server sends `: heartbeat\n\n` comment and refreshes Redis TTL. Client does not process heartbeat — it's for connection liveness only.

4. **Exponential backoff capped at 30 seconds.** Client reconnect delay never exceeds 30s. Formula: `Math.min(1000 * 2^attempts, 30000)`.

5. **Polling fallback after 3 failures.** Client switches to 30-second polling of `notification.unreadCount` after 3 consecutive SSE connection failures. Retries SSE every 5 minutes to recover from transient network issues.

6. **Replay buffer is best-effort.** Last-Event-ID replay succeeds only if:
   - Client was offline < 5 minutes
   - Client missed < 200 events
   - Replay buffer key has not expired in Redis

7. **SIGTERM drains before new requests rejected.** On SIGTERM, server sends `server_restart` to active connections first, THEN rejects new connections with 503.

8. **Connection tracking is fail-open.** Redis errors in `sseAddConnection`/`sseRemoveConnection` are logged but do not fail the request. Connection limit enforcement degrades gracefully (allows unlimited connections on Redis outage).

## Gotchas

1. **Browser EventSource auto-reconnects with Last-Event-ID.** The browser automatically includes `Last-Event-ID: <last-seq>` header on reconnect. No client-side code needed for basic replay — just ensure the hook doesn't clear `eventSourceRef.current` immediately on error.

2. **Heartbeat write failure is terminal.** If `controller.enqueue()` throws during heartbeat, the connection is broken (client closed without notifying server). Call `cleanup()` immediately to release resources.

3. **Connection limit check is racy without atomic check-and-add.** Current implementation queries `sseGetConnections()`, checks length, then calls `sseAddConnection()`. Two concurrent requests can both see length=4 and both proceed. Consider Lua script for atomic check+add if strict limit required.

4. **TTL refresh can fail silently.** Heartbeat calls `sseRefreshConnectionTTL().catch(() => {})` — Redis errors are swallowed. If refresh fails repeatedly, connection will expire from Redis but remain active in-memory until next heartbeat write fails.

5. **activeConnections Set is in-process only.** SIGTERM handler only drains connections held by the current process. If multiple pods are terminating, each only drains its own. Load balancer must drain traffic before sending SIGTERM.

6. **Last-Event-ID is a string, not a number.** `req.headers.get("Last-Event-ID")` returns a string. Must parse with `parseInt(lastEventId, 10)` and check `!Number.isNaN()`. Leading zeros or non-numeric values will parse as NaN.

7. **Replay buffer reversal is required.** Redis `LPUSH` creates newest-first list. Server must `.reverse()` before replaying or clients receive events in wrong order (newest first instead of oldest first).

8. **Cleanup must be idempotent.** `cleanup()` function is called from multiple places (error handler, cancel handler, SIGTERM handler). Must guard with `if (isClosed) return` to prevent double-close errors.

9. **Connection ID collision is possible.** `Date.now()` + `Math.random().toString(36).slice(2, 9)` has ~1 in 2 billion collision probability per millisecond. For high-traffic users with 5 connections, birthday paradox increases risk. Consider UUIDv7 for production.

10. **SIGTERM timeout is not enforced.** Handler sends `server_restart` and closes streams, but does not set a deadline. If some connections are stuck (e.g., slow write buffer flush), they can delay process exit indefinitely. K8s `terminationGracePeriodSeconds` will SIGKILL after timeout.

11. **New connections during shutdown return 503.** After SIGTERM, `shutdownInitiated=true` causes all new SSE requests to return 503 immediately. Client sees this as connection error and triggers reconnect backoff — may cause thundering herd after deployment.
