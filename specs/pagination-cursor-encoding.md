# Cursor Encoding and Pagination Patterns

## What

All paginated endpoints use **opaque cursor-based pagination** with base64url-encoded JSON payloads. Cursors encode the sort key fields needed for stable keyset pagination and are never parsed by clients. Standard pattern: request `limit + 1` items, pop the extra, encode the last item as `nextCursor`.

## Where

- `src/lib/validators.ts:49-53` — Shared `paginationSchema` (cursor optional, limit default 20 max 100)
- `src/lib/utils.ts:26-48` — Standard time-ordered cursor encoding (`encodeCursor`, `decodeCursor`)
- `src/server/services/feed.ts:14-23` — Custom feed cursor (`FeedCursor` with effectiveAt)
- `src/server/services/feed.ts:424-448` — Feed cursor encoding (`parseFeedCursor`, `encodeFeedCursor`)
- `src/server/trpc/routers/search.ts:54-102` — Search-specific cursors (rank-based, follower-based)
- `src/server/trpc/routers/engagement.ts:497-511` — Composite cursor parsing (`parseLikeCursor`)
- `src/server/trpc/routers/tweet.ts:374-426` — Prisma ID-based cursor (getReplies, getUserTweets)

## How It Works

### Standard Time-Ordered Pagination

Most endpoints order by `(createdAt DESC, id DESC)` and use the shared cursor utilities:

```typescript
// src/lib/utils.ts:34-40
export function encodeCursor(item: { createdAt: Date; id: string }): string {
  const payload: CursorPayload = {
    ts: item.createdAt.toISOString(),
    id: item.id,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

// src/lib/utils.ts:46-48
export function decodeCursor(cursor: string): CursorPayload {
  return JSON.parse(Buffer.from(cursor, "base64url").toString());
}
```

**Pagination flow** (example from tweet.getUserReplies):

```typescript
// src/server/trpc/routers/tweet.ts:537-564
const replies = await prisma.tweet.findMany({
  where: { authorId: userId, deleted: false, parentId: { not: null } },
  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  take: limit + 1,  // CRITICAL: request one extra for peek-ahead
  cursor: cursor ? { id: cursor } : undefined,  // Prisma cursor uses ID
  select: { /* ... */ },
});

let nextCursor: string | null = null;
if (replies.length > limit) {
  const nextItem = replies.pop();  // Remove peek item
  nextCursor = nextItem?.id ?? null;  // Prisma uses raw ID as cursor
}

return { items: replies, nextCursor };
```

**Note:** Prisma's built-in cursor pagination uses raw IDs, not base64-encoded payloads. This works when ordering by `(createdAt DESC, id DESC)` because the cursor field is the last-resort tie-breaker.

### Feed Pagination (Custom Effective Time)

Home feed orders by `effectiveAt` (retweet createdAt OR original tweet createdAt), not raw `createdAt`. Requires custom cursor:

```typescript
// src/server/services/feed.ts:15-23
export interface FeedCursor {
  effectiveAt: Date;
  tweetId: string;
}

// src/server/services/feed.ts:426-437
function parseFeedCursor(cursor: string): FeedCursor {
  const decoded = Buffer.from(cursor, "base64url").toString("utf-8");
  const parsed = JSON.parse(decoded);
  return {
    effectiveAt: new Date(parsed.effectiveAt),
    tweetId: parsed.tweetId,
  };
}

// src/server/services/feed.ts:442-448
function encodeFeedCursor(cursor: FeedCursor): string {
  const json = JSON.stringify({
    effectiveAt: cursor.effectiveAt.toISOString(),
    tweetId: cursor.tweetId,
  });
  return Buffer.from(json, "utf-8").toString("base64url");
}
```

**Raw SQL cursor WHERE clause:**

```typescript
// src/server/services/feed.ts:230-232
const cursorWhere = parsedCursor
  ? Prisma.sql`WHERE ("effectiveAt", "tweetId") < (${parsedCursor.effectiveAt}, ${parsedCursor.tweetId})`
  : Prisma.empty;
```

PostgreSQL tuple comparison for keyset pagination: `(effectiveAt, tweetId) < (cursorEffectiveAt, cursorTweetId)` with `ORDER BY effectiveAt DESC, tweetId DESC`.

### Search Pagination (Multi-Field Sort Keys)

Tweet search orders by `(rank DESC, createdAt DESC, id DESC)`. Cursor includes all three fields:

```typescript
// src/server/trpc/routers/search.ts:59-77
const tweetSearchCursorSchema = z
  .string()
  .optional()
  .transform((cursor) => {
    if (!cursor) return null;
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
    return {
      rank: parsed.rank as number,
      ts: new Date(parsed.ts),
      id: parsed.id as string,
    };
  });
```

**Cursor WHERE clause** (raw SQL):

```typescript
// src/server/trpc/routers/search.ts:150-157
WHERE t.search_vector @@ query
  AND t.deleted = false
  AND (
    ${cursor === null}::boolean OR
    ts_rank(t.search_vector, query) < ${cursor?.rank ?? 0}::numeric OR
    (ts_rank(t.search_vector, query) = ${cursor?.rank ?? 0}::numeric AND (
      t."createdAt" < ${cursor?.ts ?? new Date()}::timestamptz OR
      (t."createdAt" = ${cursor?.ts ?? new Date()}::timestamptz AND t.id < ${cursor?.id ?? ""}::text)
    ))
  )
```

User search orders by `(followerCount DESC, id DESC)`:

```typescript
// src/server/trpc/routers/search.ts:85-102
const userSearchCursorSchema = z
  .string()
  .optional()
  .transform((cursor) => {
    if (!cursor) return null;
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
    return {
      followerCount: parsed.followerCount as number,
      id: parsed.id as string,
    };
  });
```

### Engagement Pagination (Composite Keys)

getLikers and getUserLikes use the `Like` table's composite primary key `(userId, tweetId)` directly:

```typescript
// src/server/trpc/routers/engagement.ts:411-425
const likes = await prisma.like.findMany({
  where: { tweetId },
  orderBy: { createdAt: "desc" },
  take: limit + 1,
  cursor: cursor ? { userId_tweetId: parseLikeCursor(cursor) } : undefined,
  include: { user: { select: publicUserSelect } },
});

let nextCursor: string | null = null;
if (likes.length > limit) {
  const nextItem = likes.pop();
  nextCursor = nextItem ? `${nextItem.userId}:${nextItem.tweetId}` : null;
}
```

**Cursor format:** `userId:tweetId` (colon-separated, **not** base64-encoded):

```typescript
// src/server/trpc/routers/engagement.ts:502-510
function parseLikeCursor(cursor: string): { userId: string; tweetId: string } {
  const [userId, tweetId] = cursor.split(":");
  if (!userId || !tweetId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid cursor" });
  }
  return { userId, tweetId };
}
```

## Invariants

1. **Cursors are opaque.** Clients receive and send cursor strings but never parse or construct them. Wire format can change without breaking clients.
2. **Always order by compound key ending in ID.** Every paginated query must include `id DESC` as the final tie-breaker to ensure stable, deterministic ordering.
3. **Peek-ahead pattern.** Request `limit + 1` items, pop the extra if found, encode the last returned item as `nextCursor`. Never encode the popped item.
4. **Base64url encoding is standard.** All cursors except engagement use base64url JSON. URL-safe, no padding.
5. **Cursor validation fails with BAD_REQUEST.** Invalid base64, malformed JSON, or missing fields → `TRPCError` with code `BAD_REQUEST`.
6. **Null cursor means first page.** Absence of cursor starts pagination from the beginning (no WHERE clause filter).
7. **Cursor payload matches ORDER BY.** For `ORDER BY rank DESC, createdAt DESC, id DESC`, cursor must contain `{ rank, ts, id }` — all sort key fields.

## Gotchas

1. **Prisma cursor uses the ID field, not the encoded cursor.** When using `prisma.model.findMany({ cursor: { id: cursor } })`, pass the raw ID string directly, not a base64-encoded payload. Prisma's cursor pagination expects the unique identifier of the last item.

2. **Feed pagination uses effectiveAt, not createdAt.** Home feed sorts by `effectiveAt` (retweet time OR original tweet time) to interleave original tweets and retweets chronologically. Do not use standard `encodeCursor`/`decodeCursor` for feed — use `encodeFeedCursor`/`parseFeedCursor`.

3. **Engagement router uses legacy colon-separated format.** `getLikers` and `getUserLikes` encode cursors as `userId:tweetId` without base64. This is an exception to the base64url standard and should not be replicated in new endpoints.

4. **Search cursor WHERE clauses require NULL guards.** When building raw SQL with `Prisma.sql`, include `${cursor === null}::boolean OR` to handle first-page requests without cursor. PostgreSQL type casts are required for parameter binding.

5. **Always pop before encoding nextCursor.** The pagination pattern is:
   - Fetch `limit + 1` items
   - If length > limit, pop the extra
   - Encode the **last item in the returned array** (not the popped item)
   - Wrong: `nextCursor = encodeCursor(popped)`
   - Right: `nextCursor = encodeCursor(items[items.length - 1])`

6. **Cursor hash for cache keys is distinct from wire cursor.** Feed caching uses `hashCursor()` to create deterministic cache keys from cursor payloads. This SHA-256 hash is for internal use only — never send it to clients.

7. **Do not trust limit from clients without validation.** `paginationSchema` caps limit at 100. Without this cap, clients could request millions of rows and OOM the server.

8. **Cursor validation errors must not leak internal state.** On invalid cursor, return generic `"Invalid cursor"` message. Never expose deserialization errors or field names to clients (potential info leak).
