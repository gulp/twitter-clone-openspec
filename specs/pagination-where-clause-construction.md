# Pagination WHERE Clause Construction

## What

Compound cursor pagination requires a specific WHERE clause pattern that implements lexicographic comparison across multiple sort keys. Each cursor field maps to a disjunction of increasingly specific conditions that together enforce strict ordering without gaps or duplicates.

## Where

Implemented in three patterns across the codebase:

**Simple time-ordered (createdAt, id):**
- `src/lib/utils.ts:40-54` (cursor encoding/decoding)
- Used by: tweet timelines, notification lists, follower/following lists

**Search with rank (rank, createdAt, id):**
- `src/server/trpc/routers/search.ts:143-160` (tweet search)

**Follower count ordered (followerCount, id):**
- `src/server/trpc/routers/search.ts:281-296` (user search)

**Feed effectiveAt (effectiveAt, tweetId):**
- `src/server/services/feed.ts:230-232` (home timeline)

## How It Works

### Two-Field Compound Cursor (Most Common)

**Pattern:** `ORDER BY fieldA DESC, fieldB DESC` with cursor `{ fieldA, fieldB }`

```sql
-- src/server/trpc/routers/search.ts:289-293
WHERE (
  ${cursor === null}::boolean OR
  "followerCount" < ${cursor?.followerCount ?? 0}::int OR
  ("followerCount" = ${cursor?.followerCount ?? 0}::int AND id < ${cursor?.id ?? ""}::text)
)
ORDER BY "followerCount" DESC, id DESC
```

**Breakdown:**
1. `cursor === null` — first page, no WHERE clause applies
2. `followerCount < cursor.followerCount` — all rows strictly less than cursor's first field
3. `followerCount = cursor.followerCount AND id < cursor.id` — tie-break with second field

**Why this works:**
- Rows are ordered by `(followerCount DESC, id DESC)`
- Last row on page: `{ followerCount: 100, id: "xyz" }`
- Next page starts with rows where:
  - `followerCount < 100` (lower follower count), OR
  - `followerCount = 100 AND id < "xyz"` (same follower count, earlier ID)

### Three-Field Compound Cursor (Search)

**Pattern:** `ORDER BY rank DESC, createdAt DESC, id DESC` with cursor `{ rank, ts, id }`

```sql
-- src/server/trpc/routers/search.ts:150-157
WHERE (
  ${cursor === null}::boolean OR
  ts_rank(t.search_vector, query) < ${cursor?.rank ?? 0}::numeric OR
  (ts_rank(t.search_vector, query) = ${cursor?.rank ?? 0}::numeric AND (
    t."createdAt" < ${cursor?.ts ?? new Date()}::timestamptz OR
    (t."createdAt" = ${cursor?.ts ?? new Date()}::timestamptz AND t.id < ${cursor?.id ?? ""}::text)
  ))
)
ORDER BY rank DESC, t."createdAt" DESC, t.id DESC
```

**Breakdown:**
1. `cursor === null` — first page
2. `rank < cursor.rank` — all rows with lower rank
3. `rank = cursor.rank AND createdAt < cursor.ts` — same rank, older timestamp
4. `rank = cursor.rank AND createdAt = cursor.ts AND id < cursor.id` — same rank and timestamp, tie-break on ID

**Nesting pattern:**
- Level 1: `fieldA < cursor.fieldA`
- Level 2: `fieldA = cursor.fieldA AND (fieldB < cursor.fieldB)`
- Level 3: `fieldA = cursor.fieldA AND fieldB = cursor.fieldB AND fieldC < cursor.fieldC`

### Feed Cursor (Prisma.sql with Composite)

**Pattern:** `ORDER BY effectiveAt DESC, tweetId DESC` with cursor `{ effectiveAt, tweetId }`

```typescript
// src/server/services/feed.ts:230-232
const cursorWhere = parsedCursor
  ? Prisma.sql`WHERE ("effectiveAt", "tweetId") < (${parsedCursor.effectiveAt}, ${parsedCursor.tweetId})`
  : Prisma.empty;
```

**PostgreSQL row comparison:**
- `(a, b) < (c, d)` is equivalent to `a < c OR (a = c AND b < d)`
- Cleaner syntax for two-field cursors
- Only works with Prisma.sql (not query builder)

### Cursor Null Handling

All WHERE clauses use the pattern:
```sql
WHERE (
  ${cursor === null}::boolean OR
  ...cursor conditions...
)
```

**Why `cursor === null` instead of omitting WHERE:**
- Prisma.sql does not support conditional query fragments
- Cannot use `Prisma.empty` inside a WHERE clause
- `${cursor === null}::boolean` evaluates to `true` on first page, making entire WHERE clause true (no filtering)
- On subsequent pages, evaluates to `false`, applying cursor conditions

### Peek-Ahead Pattern

All cursors fetch `LIMIT ${limit + 1}`:

```typescript
// src/server/trpc/routers/search.ts:200-212
let nextCursor: string | null = null;
if (tweets.length > limit) {
  const nextItem = tweets.pop(); // Remove the +1 item
  if (nextItem) {
    const cursorPayload = {
      rank: nextItem.rank,
      ts: nextItem.createdAt.toISOString(),
      id: nextItem.id,
    };
    nextCursor = Buffer.from(JSON.stringify(cursorPayload), "utf-8").toString("base64url");
  }
}
```

**Pattern:**
1. Query for `limit + 1` rows
2. If result length > limit → more pages exist
3. Pop the extra item
4. Encode the popped item as nextCursor
5. Return `{ items, nextCursor }`

**Why not count-based detection:**
- `SELECT COUNT(*) WHERE cursor conditions` doubles database load
- Peek-ahead is a single query
- Clients never need total count (infinite scroll pattern)

## Invariants

1. **Last field must be unique** — final tie-break field must guarantee total ordering (always use `id`)
2. **Cursor payload matches ORDER BY** — if `ORDER BY a, b, c`, cursor is `{ a, b, c }`
3. **Field order determines nesting** — innermost condition is the last field
4. **DESC ordering uses <, ASC uses >** — `ORDER BY x DESC` → `x < cursor.x`
5. **All fields must be non-nullable** — nullable fields break lexicographic comparison (coalesce to sentinel value if needed)
6. **Cursor encoding matches decoding** — `toISOString()` in encode, `new Date()` in decode
7. **Peek-ahead always fetches limit+1** — detects hasNextPage without separate COUNT query

## Gotchas

**Wrong comparison operator for DESC:**
```sql
-- WRONG: Uses > with DESC ordering
WHERE fieldA > ${cursor.fieldA}
ORDER BY fieldA DESC
-- Result: returns rows you've already seen

-- CORRECT: Uses < with DESC ordering
WHERE fieldA < ${cursor.fieldA}
ORDER BY fieldA DESC
-- Result: returns next page
```

**Missing tie-break on first field:**
```sql
-- WRONG: Only compares first field
WHERE followerCount < ${cursor.followerCount}
ORDER BY followerCount DESC, id DESC
-- Result: skips all rows with followerCount = cursor.followerCount

-- CORRECT: Handles equality case
WHERE followerCount < ${cursor.followerCount}
   OR (followerCount = ${cursor.followerCount} AND id < ${cursor.id})
ORDER BY followerCount DESC, id DESC
```

**Nullable fields in cursor:**
```sql
-- WRONG: NULL comparisons always return NULL (not true/false)
WHERE ("bannerUrl", id) < (${cursor.bannerUrl}, ${cursor.id})
ORDER BY "bannerUrl" DESC NULLS LAST, id DESC
-- Result: pages with NULL values are skipped

-- CORRECT: Coalesce to sentinel or use separate NULLS FIRST/LAST logic
WHERE ("bannerUrl" IS NULL AND id < ${cursor.id})
   OR ("bannerUrl" IS NOT NULL AND "bannerUrl" < ${cursor.bannerUrl})
ORDER BY "bannerUrl" DESC NULLS LAST, id DESC
```

**Cursor payload type mismatch:**
```typescript
// WRONG: Stores Date object in cursor (not JSON-serializable)
const cursorPayload = { ts: item.createdAt, id: item.id };

// CORRECT: Converts to ISO string
const cursorPayload = { ts: item.createdAt.toISOString(), id: item.id };
```

**Forgetting cursor === null guard:**
```sql
-- WRONG: First page (cursor = null) fails on null access
WHERE fieldA < ${cursor.fieldA}

-- CORRECT: Handles first page
WHERE (${cursor === null}::boolean OR fieldA < ${cursor.fieldA})
```

**Peek-ahead off-by-one:**
```typescript
// WRONG: Returns limit+1 items to client
const items = await query({ limit: limit + 1 });
return { items, nextCursor };

// CORRECT: Pops extra item before returning
if (items.length > limit) {
  const nextItem = items.pop();
  nextCursor = encodeCursor(nextItem);
}
return { items, nextCursor };
```

**ASC vs DESC mismatch:**
```sql
-- WRONG: ORDER BY ASC but WHERE uses <
WHERE createdAt < ${cursor.ts}
ORDER BY createdAt ASC, id ASC
-- Result: returns earlier pages, not later pages

-- CORRECT: ORDER BY ASC uses > in WHERE
WHERE createdAt > ${cursor.ts}
ORDER BY createdAt ASC, id ASC
```
