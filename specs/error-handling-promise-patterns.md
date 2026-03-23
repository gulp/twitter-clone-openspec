# Promise Rejection Patterns: all() vs allSettled()

## What

The codebase uses three distinct patterns for handling parallel async operations, each with different failure semantics:

1. **Fail-fast** (`Promise.all()` unwrapped) — All operations must succeed or entire mutation fails
2. **Fail-open group** (`Promise.all()` with try/catch) — Individual failures logged but operation continues
3. **Best-effort partial success** (`Promise.allSettled()`) — Track individual successes/failures, never reject

Choosing the wrong pattern can cause mutations to fail unnecessarily (fail-fast where fail-open is needed) or silently drop operations (fail-open where fail-fast is needed).

## Where

**Fail-fast (Promise.all unwrapped):**
- `src/server/trpc/routers/tweet.ts:143-152` — MENTION notifications on tweet creation
- `src/server/trpc/routers/tweet.ts:156-163` — REPLY notification on reply creation
- `src/server/trpc/routers/tweet.ts:166-173` — QUOTE notification on quote tweet

**Fail-open group (Promise.all with try/catch):**
- `src/server/services/feed.ts:475-483` — Bump feed versions for all followers (cache operation)

**Best-effort partial success (Promise.allSettled):**
- `src/server/services/sse-publisher.ts:138-146` — Publish SSE event to all followers
- `src/app/api/health/route.ts:28-46` — Health check for Redis + PostgreSQL

## How It Works

### 1. Fail-Fast Pattern (Promise.all unwrapped)

**Use when:** All operations are critical to business logic. If one fails, the entire mutation should fail.

```typescript
// src/server/trpc/routers/tweet.ts:143-152
// Fire MENTION notifications (self-suppression handled in createNotification)
await Promise.all(
  mentionedUserIds.map((mentionedUserId) =>
    createNotification({
      recipientId: mentionedUserId,
      actorId: userId,
      type: "MENTION",
      tweetId: tweet.id,
    })
  )
);
```

**Behavior:**
- If **any** `createNotification()` throws → `Promise.all()` rejects immediately
- Remaining promises may still be executing (but results are ignored)
- Mutation fails, tweet creation transaction rolls back
- tRPC returns error to client

**When to use:**
- Operations are part of the core mutation contract (e.g., notifications tied to tweet creation)
- Partial success is worse than complete failure
- All operations target the same data source (DB, not cross-service)

**Tradeoff:** User's tweet creation fails if notification service is down. This is the current behavior per plan (no explicit retry or queueing).

### 2. Fail-Open Group Pattern (Promise.all with try/catch)

**Use when:** Operations are best-effort cache invalidations or side effects that shouldn't block the primary mutation.

```typescript
// src/server/services/feed.ts:475-483
try {
  // Fetch all followers
  const followers = await prisma.follow.findMany({
    where: { followingId: userId },
    select: { followerId: true },
  });

  // Bump version for each follower (fail-fast within try block)
  await Promise.all(
    followers.map((follower) => cacheIncr(`feed:version:${follower.followerId}`))
  );
} catch (error) {
  log.warn("Failed to bump feed version for followers (fail open)", {
    userId,
    error: error instanceof Error ? error.message : String(error),
  });
  // Function returns normally — caller continues
}
```

**Behavior:**
- If **any** `cacheIncr()` throws → `Promise.all()` rejects, caught by try/catch
- Error logged as warning
- Function returns normally (no re-throw)
- Caller continues as if operation succeeded

**When to use:**
- Cache invalidations where stale cache is acceptable
- Non-critical side effects (analytics, logging)
- Operations that will auto-heal (next cache read rebuilds version)

**Tradeoff:** Silent partial failures. If 1 out of 100 `cacheIncr` calls fails, you don't know which 99 succeeded. Use when granular failure tracking isn't needed.

### 3. Best-Effort Partial Success Pattern (Promise.allSettled)

**Use when:** You need to track individual successes/failures and want maximum throughput despite partial failures.

```typescript
// src/server/services/sse-publisher.ts:138-146
// Publish to all followers in parallel (best-effort)
const results = await Promise.allSettled(
  followerIds.map((followerId) => publishToUser(followerId, event))
);

const succeeded = results.filter((r) => r.status === "fulfilled").length;

log.info("SSE event published to followers", {
  event: event.type,
  total: followerIds.length,
  succeeded,
  failed: followerIds.length - succeeded,
});
```

**Behavior:**
- `Promise.allSettled()` **never rejects** — always resolves with results array
- Each result is `{ status: "fulfilled", value: ... }` or `{ status: "rejected", reason: ... }`
- Caller inspects results to count successes/failures
- Can log aggregated metrics (total vs succeeded)

**When to use:**
- Fan-out operations where individual failures are acceptable (SSE push notifications)
- Health checks across multiple services
- Batch operations where partial success is valuable
- Need to differentiate "all failed" from "some failed" from "all succeeded"

**Tradeoff:** More verbose than Promise.all. Requires manual result inspection. Can't easily access individual failure reasons (need to iterate results array).

### Health Check Example

```typescript
// src/app/api/health/route.ts:28-46
const [redisResult, dbResult] = await Promise.allSettled([
  (async () => {
    await redis.ping();
    return "ok";
  })(),
  (async () => {
    await prisma.$queryRaw`SELECT 1`;
    return "ok";
  })(),
]);

const health = {
  redis: redisResult.status === "fulfilled" ? redisResult.value : "error",
  database: dbResult.status === "fulfilled" ? dbResult.value : "error",
};

const allHealthy = health.redis === "ok" && health.database === "ok";

return NextResponse.json(health, {
  status: allHealthy ? 200 : 503,
});
```

**Why allSettled here:**
- Want to report Redis status even if PostgreSQL is down (and vice versa)
- HTTP 503 if **any** service is down, but response shows which ones failed
- Monitoring systems can parse partial failures

**Alternative (Promise.all):**
- If Redis is down, health check throws → no information about database
- Monitoring sees generic 500 error, can't differentiate failure modes

## Invariants

**I1:** CRITICAL business logic MUST use unwrapped `Promise.all()` to ensure transactional failure (all-or-nothing).

**I2:** Cache invalidation and non-critical side effects SHOULD use `Promise.all()` wrapped in try/catch with `log.warn()`.

**I3:** Fan-out operations (SSE push, multi-service health checks) MUST use `Promise.allSettled()` to prevent one failure from blocking others.

**I4:** `Promise.allSettled()` results MUST be inspected to count or log failures. Never ignore the results array.

**I5:** Fail-open patterns (try/catch around Promise.all) MUST log failures at `warn` level with sufficient context (operation, count, error message).

**I6:** Never use `Promise.all()` with side effects across different failure domains (DB + Redis + external API) without considering blast radius.

## Gotchas

### Promise.all Short-Circuits

**Behavior:** `Promise.all([p1, p2, p3])` rejects as soon as **first** promise rejects.

**Trap:** Remaining promises keep executing but results are lost.

```typescript
// WRONG: Assume only failed notification is skipped
await Promise.all(
  [user1, user2, user3].map((u) => sendEmail(u))  // user2 fails
);
// → Rejects immediately, but sendEmail(user3) may still be running
// → user3 email may or may not send (race condition)
```

**Right:**
```typescript
// Option A: Fail-fast is correct (all emails must send or retry entire batch)
await Promise.all([...]);

// Option B: Partial success is acceptable
const results = await Promise.allSettled([...]);
const failed = results.filter(r => r.status === "rejected");
if (failed.length > 0) {
  log.warn("Some emails failed", { count: failed.length });
}
```

### Try/Catch Hides Individual Errors

**Fail-open pattern loses granularity:**

```typescript
try {
  await Promise.all(
    [1, 2, 3, 4, 5].map(async (id) => {
      if (id === 3) throw new Error("ID 3 failed");
      return cacheIncr(`key:${id}`);
    })
  );
} catch (error) {
  log.warn("Cache update failed", { error: error.message });
  // → Logs "ID 3 failed" but you don't know which other IDs succeeded
}
```

**If you need per-item tracking:**
```typescript
const results = await Promise.allSettled(
  [1, 2, 3, 4, 5].map(async (id) => {
    if (id === 3) throw new Error("ID 3 failed");
    return cacheIncr(`key:${id}`);
  })
);

results.forEach((result, index) => {
  if (result.status === "rejected") {
    log.warn("Cache update failed for item", {
      id: index + 1,
      error: result.reason,
    });
  }
});
```

### allSettled Never Rejects = Silent Failures

**Trap:** Forgetting to check results array.

```typescript
// WRONG: allSettled succeeds even if all operations failed
await Promise.allSettled(followerIds.map(sendNotification));
// → Function returns, no error thrown, but ZERO notifications sent
```

**Right:**
```typescript
const results = await Promise.allSettled(followerIds.map(sendNotification));
const succeeded = results.filter(r => r.status === "fulfilled").length;

if (succeeded === 0 && followerIds.length > 0) {
  log.error("All notifications failed", { total: followerIds.length });
  // Optionally throw or set alerting threshold
}
```

### Concurrent Notifications + DB Transaction

**Scenario:** Tweet creation is wrapped in Prisma transaction. Notifications fire after transaction commits.

**Current code:**
```typescript
// src/server/trpc/routers/tweet.ts:143-152
const tweet = await prisma.tweet.create({ data: { ... } });

// After tweet created, fire notifications
await Promise.all(
  mentionedUserIds.map((id) => createNotification({ ... }))
);
```

**Risk:** If `createNotification()` throws, tweet is already committed (not rolled back).

**Trade-off:** Acceptable per plan — notifications are logged, can be retried manually or via admin tool. Alternative would be transactional outbox pattern (not implemented in v1).

### Redis Bulk Operations with Partial Failure

**feed.ts cache version bump:**

```typescript
await Promise.all(
  followers.map((follower) => cacheIncr(`feed:version:${follower.followerId}`))
);
```

**If one follower's `cacheIncr` fails:**
- Promise.all rejects inside try/catch
- Log says "Failed to bump feed version for followers" (plural)
- Can't tell if 0, 1, or N-1 followers got the bump

**Impact:** Some followers' feeds remain cached with stale version → next tweet doesn't appear until cache expires (60s TTL) or manual refetch.

**Mitigation:** 60s TTL auto-heals. For critical use cases, consider chunked `Promise.allSettled()` with retry logic.

## Testing

### Test Fail-Fast Behavior

```typescript
it("should rollback tweet creation if notification fails", async () => {
  // Mock createNotification to throw on second call
  vi.spyOn(notificationService, "createNotification")
    .mockResolvedValueOnce(undefined)  // First mention succeeds
    .mockRejectedValueOnce(new Error("Notification service down"));

  // Attempt to create tweet with 2 mentions
  await expect(
    caller.tweet.create({
      content: "Hello @user1 @user2",
      // ...
    })
  ).rejects.toThrow();

  // Tweet should NOT exist in database
  const tweet = await prisma.tweet.findFirst({
    where: { content: "Hello @user1 @user2" },
  });
  expect(tweet).toBeNull();
});
```

### Test Fail-Open Behavior

```typescript
it("should log warning but continue if feed version bump fails", async () => {
  const logSpy = vi.spyOn(log, "warn");

  // Mock cacheIncr to throw
  vi.spyOn(redis, "cacheIncr").mockRejectedValue(new Error("Redis down"));

  // Should not throw
  await bumpFeedVersionForFollowers("user123");

  // Should log warning
  expect(logSpy).toHaveBeenCalledWith(
    "Failed to bump feed version for followers (fail open)",
    expect.objectContaining({ userId: "user123" })
  );
});
```

### Test Best-Effort with Metrics

```typescript
it("should publish to all available followers and log metrics", async () => {
  const logSpy = vi.spyOn(log, "info");

  // Mock publishToUser to fail for follower2
  vi.spyOn(ssePublisher, "publishToUser")
    .mockResolvedValueOnce(undefined)    // follower1: success
    .mockRejectedValueOnce(new Error("Connection closed"))  // follower2: fail
    .mockResolvedValueOnce(undefined);   // follower3: success

  await publishToFollowers(["follower1", "follower2", "follower3"], event);

  // Should log 2 out of 3 succeeded
  expect(logSpy).toHaveBeenCalledWith(
    "SSE event published to followers",
    expect.objectContaining({
      total: 3,
      succeeded: 2,
      failed: 1,
    })
  );
});
```

## Decision Tree

**Choose Promise.all (fail-fast) if:**
- All operations must succeed for consistency (e.g., critical notifications tied to user action)
- Operations are part of DB transaction
- Partial success is worse than retrying entire batch

**Choose Promise.all + try/catch (fail-open) if:**
- Operations are cache invalidations or performance optimizations
- Failures will auto-heal (TTL expiration, next cache miss)
- Don't need per-item failure tracking

**Choose Promise.allSettled (best-effort) if:**
- Fan-out to multiple independent recipients (SSE, emails)
- Need to count or log individual failures
- Some successes are better than all failures
- Operations are across different failure domains (multi-service)

## Related Specs

- `error-handling-redis-failure-policy.md` — Fail-open vs fail-closed for Redis operations
- `error-handling-trpc-codes.md` — Error codes for mutation failures
- `sse-event-publishing.md` — SSE fan-out using Promise.allSettled
- `caching-feed-versioning.md` — Feed version bump using fail-open Promise.all
