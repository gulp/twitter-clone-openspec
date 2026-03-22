# Prisma Race Condition Handling

## What

Concurrent operations on unique constraints and foreign keys produce Prisma error codes P2002 (unique violation) and P2025 (record not found). These are handled explicitly to provide idempotency and avoid exposing race conditions as errors to users.

## Where

P2002 handling (unique constraint violations):
- `src/server/trpc/routers/auth.ts:126-137` — concurrent registration race
- `src/server/trpc/routers/social.ts:77-90` — concurrent follow race
- `src/server/trpc/routers/engagement.ts:76-91` — concurrent like race
- `src/server/trpc/routers/engagement.ts:212-227` — concurrent retweet race

P2025 handling (record not found):
- `src/server/trpc/routers/social.ts:159-165` — concurrent unfollow race
- `src/server/trpc/routers/engagement.ts:137-143,274-280` — concurrent unlike/undoRetweet

## How It Works

Prisma throws structured errors with a `code` field. The application checks for specific codes and converts them to idempotent success responses.

### P2002: Unique Constraint Violation

When two requests try to create the same relationship simultaneously (e.g., follow, like), Prisma throws P2002 on the unique index. The second request treats this as success since the desired state is already achieved.

```typescript
// src/server/trpc/routers/social.ts:60-90
try {
  await prisma.$transaction([
    prisma.follow.create({
      data: { followerId, followingId },
    }),
    prisma.user.update({
      where: { id: followerId },
      data: { followingCount: { increment: 1 } },
    }),
    prisma.user.update({
      where: { id: followingId },
      data: { followerCount: { increment: 1 } },
    }),
  ]);
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
    return { success: true }; // Already followed (concurrent request)
  }

  // Log unexpected errors before re-throwing
  log.error("Failed to follow user", {
    followerId,
    followingId,
    error: error instanceof Error ? error.message : String(error),
    requestId: ctx.requestId,
  });
  throw error;
}
```

**Why this works:** The unique constraint `@@unique([followerId, followingId])` ensures only one Follow record exists. If P2002 fires, the relationship exists, so returning success is correct.

**Critical detail:** Registration also checks `meta.target` field to distinguish which field caused P2002:

```typescript
// src/server/trpc/routers/auth.ts:126-137
catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
    const target = (error as { meta?: { target?: string[] } }).meta?.target;
    if (target?.includes("email")) {
      throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });
    }
    if (target?.includes("username")) {
      throw new TRPCError({ code: "CONFLICT", message: "Username already taken" });
    }
    throw new TRPCError({ code: "CONFLICT", message: "Email or username already in use" });
  }
  throw error;
}
```

This is used when the pre-check passes (no existing user) but a concurrent request wins the race.

### P2025: Record Not Found

When two requests try to delete the same relationship simultaneously, Prisma throws P2025 on the second delete. The application treats this as success since the relationship is already gone.

```typescript
// src/server/trpc/routers/engagement.ts:122-143
try {
  await prisma.$transaction([
    prisma.like.delete({
      where: { userId_tweetId: { userId, tweetId } },
    }),
    prisma.tweet.update({
      where: { id: tweetId },
      data: { likeCount: { decrement: 1 } },
    }),
  ]);
} catch (error) {
  // P2025: record not found (concurrent unlike won the race)
  if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
    return { success: true };
  }
  throw error;
}
```

**Why pre-check exists:** Before the transaction, code checks `findUnique` to see if the relationship exists (`src/server/trpc/routers/engagement.ts:107-118`). If not found, returns success immediately. This avoids the transaction entirely for the common case and reduces lock contention.

The P2025 catch is the safety net for the narrow race window between the pre-check and the delete.

## Invariants

1. **I-R1:** All relationship mutations (follow, like, retweet) MUST handle P2002 by returning idempotent success, never TRPCError.
2. **I-R2:** All relationship deletions (unfollow, unlike, undoRetweet) MUST handle P2025 by returning idempotent success.
3. **I-R3:** P2002/P2025 are the ONLY Prisma error codes silently converted to success. All other codes must be logged and re-thrown or converted to TRPCError.
4. **I-R4:** When handling P2002 in registration, MUST inspect `meta.target` to return field-specific error messages.
5. **I-R5:** Unexpected Prisma errors (not P2002/P2025) MUST be logged with `requestId` before re-throwing (see `src/server/trpc/routers/social.ts:82-89`, `src/server/trpc/routers/engagement.ts:83-90`).

## Gotchas

**Don't rely on pre-checks alone.** The pattern is: pre-check for early exit, then transaction, then P2002 catch. Omitting the catch means race conditions surface as 500 errors to users.

**Count updates inside transaction.** Unlike/unfollow decrements counts inside the same transaction as the delete. If P2025 fires, the transaction rolls back, so counts stay accurate. If you decrement outside the transaction, P2025 means the count was decremented twice.

**P2025 only for deletes, not for failed foreign key lookups.** If `prisma.tweet.update({ where: { id: missingTweetId } })` runs and the tweet doesn't exist, Prisma throws P2025. This is NOT a race condition — it's a NOT_FOUND error. Only catch P2025 when you've already confirmed the record exists via pre-check.

**Type narrowing is verbose but required.** The check `error && typeof error === "object" && "code" in error` is necessary because Prisma's TypeScript types don't narrow `error` to `PrismaClientKnownRequestError` automatically. The codebase uses this pattern consistently rather than importing and using `instanceof PrismaClientKnownRequestError`.

**Registration converts P2002 to CONFLICT, others to success.** This is the only place P2002 doesn't return `{ success: true }`. Registration pre-checks uniqueness, but concurrent requests can still race. The CONFLICT error is intentional — the client needs to know which field to change.
