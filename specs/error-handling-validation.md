# Input Validation and Business Rule Errors

## What

Input validation happens in two stages: Zod schema validation (automatic via tRPC input), and business rule validation (manual checks in procedure body). Zod failures produce automatic BAD_REQUEST responses. Business rule violations throw explicit TRPCErrors with specific codes.

## Where

Zod schemas in `src/lib/validators.ts` validate structure and types.

Business rule checks scattered throughout routers:
- `src/server/trpc/routers/tweet.ts:48-54` — empty tweet check (I7)
- `src/server/trpc/routers/tweet.ts:63-84` — parent tweet existence and deletion checks
- `src/server/trpc/routers/engagement.ts:38-49,163-174` — target tweet existence/deletion
- `src/server/trpc/routers/engagement.ts:176-182` — self-retweet block (I6)
- `src/server/trpc/routers/social.ts:35-41` — self-follow block (I6)
- `src/server/trpc/routers/auth.ts:76-100` — username/email uniqueness checks

Authorization checks:
- `src/server/trpc/routers/tweet.ts:221-227` — ownership check for tweet deletion (I1.14)

## How It Works

### Zod Validation (Automatic)

tRPC procedures use `.input(schema)` to validate request payloads before the procedure runs:

```typescript
// src/server/trpc/routers/tweet.ts:36-43
create: protectedProcedure
  .input(
    z.object({
      content: tweetContentSchema.optional(),
      mediaUrls: z.array(z.string().url()).max(4).optional(),
      parentId: z.string().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
```

If Zod validation fails (e.g., invalid URL, content too long, wrong type), tRPC automatically throws BAD_REQUEST before the mutation runs. The application code never sees invalid input.

Key shared schemas from `src/lib/validators.ts`:
- `tweetContentSchema: z.string().min(1).max(280)` — 280 char limit
- `registerSchema` — email format, password length, username pattern
- `paginationSchema` — cursor/limit with defaults

### Business Rule Validation (Manual)

After Zod passes, the procedure checks business invariants:

**I7 — Tweet requires content or media:**

```typescript
// src/server/trpc/routers/tweet.ts:48-54
if (!content?.trim() && (!mediaUrls || mediaUrls.length === 0)) {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "Tweet must have text or media",
  });
}
```

Zod allows `optional()` for both fields, but the business rule requires at least one. This is a mutual exclusion constraint that Zod can't express cleanly, so it's checked in code.

**I6 — No self-engagement:**

```typescript
// src/server/trpc/routers/social.ts:35-41
if (followerId === followingId) {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "Cannot follow yourself",
  });
}
```

Zod doesn't have access to session context to validate "target user != current user", so this is always a runtime check.

**Foreign key validation:**

```typescript
// src/server/trpc/routers/tweet.ts:63-84
if (parentId) {
  const parent = await prisma.tweet.findUnique({
    where: { id: parentId },
    select: { id: true, deleted: true, authorId: true },
  });

  if (!parent) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Parent tweet not found",
    });
  }

  if (parent.deleted) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot reply to a deleted tweet",
    });
  }

  parentAuthorId = parent.authorId;
}
```

This validates the foreign key exists and meets business rules (not deleted). Prisma would throw a generic foreign key error if we just tried to create the reply with an invalid `parentId`, so explicit checks give better error messages.

### Authorization Validation

Authorization is distinct from input validation. It checks if the authenticated user has permission to perform the action on the target resource.

```typescript
// src/server/trpc/routers/tweet.ts:198-227
const tweet = await prisma.tweet.findUnique({
  where: { id: tweetId },
  select: { id: true, authorId: true, parentId: true, deleted: true },
});

if (!tweet) {
  throw new TRPCError({
    code: "NOT_FOUND",
    message: "Tweet not found",
  });
}

if (tweet.deleted) {
  // Already deleted, idempotent success
  return { success: true };
}

// Verify ownership (I1.14)
if (tweet.authorId !== userId) {
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "You can only delete your own tweets",
  });
}
```

NOT_FOUND vs FORBIDDEN distinction: missing resources are NOT_FOUND regardless of permissions. Existing resources that the user can't modify are FORBIDDEN.

## Invariants

1. **I-V1:** All tRPC procedures MUST use `.input(schema)` for structure/type validation. No manual parsing of raw input.
2. **I-V2:** Business rules that Zod can't express (cross-field dependencies, context-dependent checks) MUST be validated in procedure body with explicit TRPCError throws.
3. **I-V3:** Foreign key existence checks MUST happen before Prisma operations to provide clear error messages (NOT_FOUND vs generic FK error).
4. **I-V4:** Self-engagement checks (follow, retweet) MUST throw BAD_REQUEST, not FORBIDDEN. It's invalid input, not a permission issue.
5. **I-V5:** Authorization failures (user lacks permission on existing resource) MUST throw FORBIDDEN, not BAD_REQUEST.
6. **I-V6:** Deleted resources are NOT_FOUND to external queries, but BAD_REQUEST when trying to interact (e.g., reply to deleted tweet).

## Gotchas

**Don't re-validate what Zod already checked.** If Zod says `content: z.string().max(280)`, don't add `if (content.length > 280)` in the procedure. This creates drift between schema and code. Change the schema instead.

**Empty string passes Zod but may fail business rules.** `tweetContentSchema.optional()` allows omitting the field, but if present, Zod validates it. The `content?.trim()` check at `src/server/trpc/routers/tweet.ts:48` is necessary because Zod's `.min(1)` applies only if the field is present. For the "content OR media" rule, the procedure must check both.

**Uniqueness checks use `findUnique` before create, not try-catch alone.** `src/server/trpc/routers/auth.ts:76-100` checks email/username existence before attempting `user.create`. This provides clear CONFLICT messages. The P2002 catch is a safety net for concurrent registrations, not the primary path.

**Validation happens before side effects.** All input checks, business rule checks, and authorization checks occur before any database writes, Redis updates, or notification sends. This ensures failed requests don't leave partial state.

**Cursor validation is minimal.** Pagination cursors (`src/server/trpc/routers/social.ts:200-212`) split on `:` and check for presence of parts, then pass to Prisma. If the cursor is malformed but parses, Prisma returns empty results (cursor beyond end of list). This is safer than throwing errors for cursors the client generated.

**Media URL validation is delegated.** `src/server/trpc/routers/tweet.ts:56-59` calls `validateMediaUrls(mediaUrls, userId, "tweet")` which is defined in `src/server/trpc/routers/media.ts`. This function checks that the URLs are from the expected S3 bucket and match the user's upload session. If validation fails, it throws BAD_REQUEST.

**Don't use UNAUTHORIZED for missing resources in protected procedures.** The protected procedure middleware already threw UNAUTHORIZED if `!session.user`. Inside the procedure, use NOT_FOUND for missing resources, not UNAUTHORIZED.
