# Request ID Correlation

## What

Every HTTP request gets a unique UUIDv4 identifier (`requestId`) that flows through tRPC middleware → AsyncLocalStorage → Prisma queries → Redis operations. This enables tracing a single user action across all logs, correlating slow queries and errors back to the originating HTTP request.

## Where

- `src/server/trpc/index.ts:20` — requestId generation in tRPC context
- `src/server/trpc/index.ts:64-65` — AsyncLocalStorage propagation
- `src/server/db.ts:10` — AsyncLocalStorage declaration
- `src/server/db.ts:43` — requestId extraction in Prisma middleware
- `src/server/redis.ts:36-48` — requestId parameter in Redis wrappers

## How It Works

### Step 1: Generate requestId in tRPC context

Every incoming tRPC request gets a fresh UUIDv4:

```typescript
// src/server/trpc/index.ts:18-26
export async function createTRPCContext(opts: FetchCreateContextFnOptions) {
  const session = await getServerSession(authOptions);
  const requestId = randomUUID();

  return {
    session,
    requestId,
    req: opts.req,
  };
}
```

### Step 2: Propagate via AsyncLocalStorage

The tRPC logging middleware stores requestId in AsyncLocalStorage before executing the procedure:

```typescript
// src/server/trpc/index.ts:64-65
return requestContext.run({ requestId: ctx.requestId }, async () => {
  try {
    const result = await next();
    // ... logging with ctx.requestId
```

AsyncLocalStorage maintains the context across async boundaries without passing it as a parameter.

### Step 3: Prisma queries extract from AsyncLocalStorage

Prisma middleware reads requestId from the store and logs it with slow queries:

```typescript
// src/server/db.ts:42-56
async $allOperations({ model, operation, args, query }) {
  const startMs = Date.now();
  const ctx = requestContext.getStore();

  try {
    const result = await query(args);
    const latencyMs = Date.now() - startMs;

    // Log slow queries (>500ms) at WARN level
    if (latencyMs > 500) {
      log.warn("Slow Prisma query", {
        requestId: ctx?.requestId,
        model,
        operation,
        latencyMs,
      });
    }
```

### Step 4: Redis operations accept optional requestId

Redis wrapper functions accept requestId as the last parameter and include it in failure logs:

```typescript
// src/server/redis.ts:36-48
export async function cacheGet(key: string, requestId?: string): Promise<string | null> {
  try {
    return await redis.get(key);
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "cache",
      operation: "GET",
      key,
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return null;
  }
}
```

Callers pass `ctx.requestId` when available. If Redis operations are called outside tRPC context (e.g., SSE publisher), requestId may be undefined.

### Step 5: Structured log output

All logs include the requestId in JSON format:

```json
{
  "level": "warn",
  "msg": "Slow Prisma query",
  "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "model": "Tweet",
  "operation": "findMany",
  "latencyMs": 742,
  "ts": "2026-03-23T14:30:45.123Z"
}
```

External log aggregation tools (Datadog, CloudWatch, etc.) can group all logs with the same requestId to reconstruct the full execution trace.

## Invariants

1. **Every tRPC request MUST have a unique requestId** — generated once in `createTRPCContext`, never reused.

2. **AsyncLocalStorage MUST be initialized before executing the procedure** — the `requestContext.run()` call must wrap `next()`, not come after it.

3. **Prisma middleware MUST call `requestContext.getStore()`** — never assume the context exists; handle `ctx?.requestId` gracefully.

4. **Redis wrappers MUST accept requestId as optional** — not all Redis operations originate from tRPC (SSE publisher, background jobs).

5. **Logs MUST include requestId when available** — use `ctx.requestId` in tRPC middleware, `ctx?.requestId` in Prisma middleware, parameter in Redis wrappers.

## Gotchas

**AsyncLocalStorage caveat:** If you create a new Promise chain outside the AsyncLocalStorage context (e.g., `Promise.all()` with externally-defined promises), the context may be lost. Keep all async work within the `requestContext.run()` callback.

**Redis wrapper pattern:** Callers must explicitly pass `ctx.requestId` to Redis functions. Unlike Prisma queries (which automatically extract from AsyncLocalStorage), Redis wrappers use parameter passing for explicitness.

**Missing requestId in logs:** If a log has `requestId: undefined`, the operation occurred outside tRPC context. Valid for SSE publisher events, background jobs, or server startup tasks.

**Prisma client extensions:** The extended Prisma client (`prisma`) includes the middleware. The raw `basePrisma` client (used by NextAuth adapter) does NOT have requestId logging. This is intentional — NextAuth operations are not tRPC requests.

**Correlation across services:** requestId is local to the Node.js process. If your architecture grows to multiple services, propagate requestId via HTTP headers (e.g., `X-Request-ID`) for distributed tracing.
