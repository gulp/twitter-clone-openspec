# $queryRaw Patterns for Raw SQL Queries

## What

Prisma's `$queryRaw` is used for SQL features not supported by the query builder: full-text search (tsvector), CTEs (WITH clauses), DISTINCT ON, UNION, and row-value comparisons. All raw SQL uses `Prisma.sql` tagged templates for safe parameter interpolation (never string concatenation).

## Where

**Full-text search:**
- `src/server/trpc/routers/search.ts:133-165` — Tweet search with ts_rank scoring

**Feed assembly with UNION + DISTINCT ON:**
- `src/server/services/feed.ts:234-274` — Home timeline CTE with deduplication

**Who-to-follow suggestions:**
- `src/server/trpc/routers/social.ts:317-371` — Mutual follow graph traversal with CTE

**User search:**
- `src/server/trpc/routers/search.ts:272-308` — ILIKE pattern matching with OR conditions

## How It Works

### When to Use $queryRaw

**Use raw SQL for:**
1. **Full-text search** — PostgreSQL `tsvector`, `ts_rank`, `@@` operator
2. **CTEs (WITH clauses)** — Complex multi-step queries with temporary result sets
3. **DISTINCT ON** — Keep first row per group (not supported by Prisma)
4. **UNION / UNION ALL** — Combine results from multiple SELECT statements
5. **Row-value comparisons** — `(col1, col2) < (val1, val2)` for keyset pagination
6. **PostgreSQL-specific functions** — `plainto_tsquery`, `ts_rank`, `to_tsvector`

**Use Prisma query builder for:**
- Simple CRUD operations (`findMany`, `create`, `update`, `delete`)
- Basic filtering (`where`, `orderBy`, `take`, `skip`)
- Relations (`include`, `select`)
- Transactions (`prisma.$transaction`)
- Type safety without manual type definitions

### Safe Parameter Interpolation

**CRITICAL: Always use `Prisma.sql` tagged template for user input.**

```typescript
// ✅ CORRECT: Prisma.sql escapes parameters
const tweets = await prisma.$queryRaw<Tweet[]>(
  Prisma.sql`
    SELECT * FROM "Tweet"
    WHERE content LIKE ${searchQuery}
  `
);

// ❌ WRONG: String interpolation = SQL injection vulnerability
const tweets = await prisma.$queryRaw<Tweet[]>(
  `SELECT * FROM "Tweet" WHERE content LIKE '${searchQuery}'`
);
```

**How Prisma.sql works:**
```typescript
// Input:
Prisma.sql`SELECT * FROM "Tweet" WHERE id = ${tweetId}`

// Becomes parameterized query:
// SQL: SELECT * FROM "Tweet" WHERE id = $1
// Params: [tweetId]
```

### Full-Text Search Example

```typescript
// src/server/trpc/routers/search.ts:133-165
const tweets = await prisma.$queryRaw<
  Array<{
    id: string;
    content: string;
    // ... other fields
    rank: number;
  }>
>(
  Prisma.sql`
    SELECT t.id, t.content, t."authorId", t."parentId", t."mediaUrls",
           t."createdAt", t."likeCount", t."retweetCount", t."replyCount",
           ts_rank(t.search_vector, query) AS rank
    FROM "Tweet" t, plainto_tsquery('english', ${query}) query
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
    ORDER BY rank DESC, t."createdAt" DESC, t.id DESC
    LIMIT ${limit + 1}
  `
);
```

**Key patterns:**
- **tsvector column:** `search_vector` is a generated column (see Prisma schema)
- **plainto_tsquery:** Converts user input to text search query (handles stemming, stop words)
- **@@ operator:** Full-text match operator
- **ts_rank:** Relevance scoring function (higher = better match)
- **Type casting:** `${cursor === null}::boolean` for type safety
- **Peek-ahead:** `LIMIT ${limit + 1}` to detect if more results exist

### CTE with UNION and DISTINCT ON

```typescript
// src/server/services/feed.ts:234-274
const sql = Prisma.sql`
  WITH followed AS (
    SELECT "followingId" FROM "Follow" WHERE "followerId" = ${userId}
  ),
  feed_items AS (
    -- Original tweets by followed users
    SELECT t.id AS "tweetId", t."createdAt" AS "effectiveAt",
           NULL::text AS "retweeterId"
    FROM "Tweet" t
    WHERE t."authorId" IN (SELECT "followingId" FROM followed)
      AND t.deleted = false AND t."parentId" IS NULL
    UNION ALL
    -- Retweets by followed users
    SELECT rt."tweetId", rt."createdAt" AS "effectiveAt",
           rt."userId" AS "retweeterId"
    FROM "Retweet" rt
    WHERE rt."userId" IN (SELECT "followingId" FROM followed)
      AND EXISTS (
        SELECT 1 FROM "Tweet" t
        WHERE t.id = rt."tweetId" AND t.deleted = false
      )
  ),
  deduped AS (
    SELECT DISTINCT ON ("tweetId") *
    FROM feed_items
    ORDER BY "tweetId", "effectiveAt" DESC, "retweeterId" DESC NULLS LAST
  )
  SELECT * FROM deduped
  ${cursorWhere}
  ORDER BY "effectiveAt" DESC, "tweetId" DESC
  LIMIT ${limit + 1};
`;

const rows = await prisma.$queryRaw<RawFeedItem[]>(sql);
```

**Key patterns:**
- **CTE (`WITH` clauses):** Break complex query into readable steps
- **UNION ALL:** Combine original tweets and retweets (no dedup at this stage)
- **DISTINCT ON:** Keep most recent retweet per tweet (PostgreSQL-specific)
- **Type casting:** `NULL::text` for type consistency across UNION branches
- **Dynamic WHERE:** `${cursorWhere}` can be `Prisma.empty` (empty SQL fragment) or condition
- **Explicit type:** `RawFeedItem[]` interface defined inline

### Type Definitions

**Always provide explicit TypeScript types:**

```typescript
// Define result shape
type RawFeedItem = {
  tweetId: string;
  effectiveAt: Date;
  retweeterId: string | null;
};

// Type the query result
const rows = await prisma.$queryRaw<RawFeedItem[]>(sql);
```

**Why explicit types:**
- Prisma can't infer types from raw SQL
- Without type annotation, result is `any`
- Type errors at usage sites instead of query definition
- IDE autocomplete and refactoring breaks

**Column name mapping:**
```typescript
// SQL uses snake_case for table columns
SELECT t.id AS "tweetId", t."createdAt" AS "effectiveAt"

// TypeScript uses camelCase
type RawFeedItem = {
  tweetId: string;    // ← matches SQL alias
  effectiveAt: Date;  // ← matches SQL alias
};
```

### Type Casting in SQL

**PostgreSQL requires explicit casts for parameterized queries:**

```typescript
// Boolean cast
${cursor === null}::boolean

// Numeric cast
${cursor?.rank ?? 0}::numeric

// Timestamp cast
${cursor?.ts ?? new Date()}::timestamptz

// Text cast
${cursor?.id ?? ""}::text

// NULL cast with type
NULL::text
```

**Why cast:**
- Prisma sends parameters as strings (protocol limitation)
- PostgreSQL needs type hints for operators and comparisons
- Without cast: `ERROR: could not determine data type of parameter $1`

**Fallback values:**
- Use `??` operator for nullable values
- Provide type-appropriate defaults (0 for numbers, "" for strings, new Date() for timestamps)

### Empty SQL Fragments

**Use `Prisma.empty` for conditional clauses:**

```typescript
const cursorWhere = parsedCursor
  ? Prisma.sql`WHERE ("effectiveAt", "tweetId") < (${parsedCursor.effectiveAt}, ${parsedCursor.tweetId})`
  : Prisma.empty;

const sql = Prisma.sql`
  SELECT * FROM feed_items
  ${cursorWhere}
  ORDER BY "effectiveAt" DESC
`;
```

**Behavior:**
- If `parsedCursor` exists: `WHERE ("effectiveAt", "tweetId") < (...)`
- If null: empty string (no WHERE clause)

**Why not string concatenation:**
```typescript
// ❌ WRONG: Breaks Prisma.sql type safety
const sql = Prisma.sql`SELECT * FROM items` +
  (cursor ? ` WHERE id < ${cursor}` : '');

// ✅ CORRECT: Use Prisma.empty
const whereSql = cursor
  ? Prisma.sql`WHERE id < ${cursor}`
  : Prisma.empty;
const sql = Prisma.sql`SELECT * FROM items ${whereSql}`;
```

### Row-Value Comparisons

**Keyset pagination for multi-column ordering:**

```typescript
// Cursor: { effectiveAt: Date, tweetId: string }
WHERE ("effectiveAt", "tweetId") < (${cursor.effectiveAt}, ${cursor.tweetId})
```

**Lexicographic comparison:**
- Compare first column (`effectiveAt`)
- If equal, compare second column (`tweetId`)
- Equivalent to: `effectiveAt < cursor.effectiveAt OR (effectiveAt = cursor.effectiveAt AND tweetId < cursor.tweetId)`

**Why row-value syntax:**
- More concise than expanded boolean logic
- PostgreSQL optimizes row comparisons for index usage
- Matches index order (`(effectiveAt DESC, tweetId DESC)`)

## Invariants

**I1:** All user input in raw SQL MUST use `Prisma.sql` tagged template, never string interpolation.

**I2:** All `$queryRaw` calls MUST have explicit TypeScript type annotation: `$queryRaw<ResultType[]>`.

**I3:** Column names in SELECT aliases MUST match TypeScript interface property names (e.g., `"tweetId"` not `"tweet_id"`).

**I4:** PostgreSQL-specific types MUST be cast explicitly: `::boolean`, `::numeric`, `::timestamptz`, `::text`.

**I5:** Dynamic WHERE clauses MUST use `Prisma.empty` for the "no condition" case, not empty strings.

**I6:** UNION branches MUST have matching column types (use `NULL::type` for type consistency).

**I7:** Raw SQL queries MUST NOT expose `hashedPassword`, `sessionVersion`, or other sensitive fields (follow publicUserSelect pattern).

## Gotchas

### Date Handling

**Prisma sends JavaScript Date objects as ISO 8601 strings:**
```typescript
Prisma.sql`WHERE "createdAt" < ${new Date()}`
// → WHERE "createdAt" < '2024-01-15T10:30:00.000Z'::timestamptz
```

**PostgreSQL parses the string correctly if cast to `timestamptz`:**
```typescript
// ✅ CORRECT: Explicit cast
${new Date()}::timestamptz

// ⚠️ IMPLICIT: Works but less clear
${new Date()}  // PostgreSQL infers timestamp type from column
```

### Prisma.sql is Immutable

**Cannot concatenate Prisma.sql fragments with `+`:**
```typescript
// ❌ WRONG: Type error
const sql = Prisma.sql`SELECT * ` + Prisma.sql`FROM "Tweet"`;

// ✅ CORRECT: Use template literal interpolation
const fromClause = Prisma.sql`FROM "Tweet"`;
const sql = Prisma.sql`SELECT * ${fromClause}`;
```

### $queryRaw Returns Array, Not Single Object

**Even for single-row queries:**
```typescript
const result = await prisma.$queryRaw<User[]>(
  Prisma.sql`SELECT * FROM "User" WHERE id = ${userId}`
);

// ✅ CORRECT: Access first element
const user = result[0];

// ❌ WRONG: Treating result as single object
const user = result;  // Type error
```

### Column Name Quoting

**PostgreSQL is case-sensitive with quoted identifiers:**
```sql
-- ✅ CORRECT: Matches Prisma schema
SELECT "userId", "createdAt" FROM "Follow"

-- ❌ WRONG: Column not found
SELECT userId, createdAt FROM Follow
```

**Prisma schema uses PascalCase for table names, camelCase for columns:**
- Table: `"Tweet"` (quoted)
- Column: `"createdAt"` (quoted)
- Alias: `"effectiveAt"` (quoted to match TypeScript)

### $queryRaw Doesn't Auto-Hydrate Relations

**Unlike Prisma queries, raw SQL returns flat rows:**
```typescript
// Prisma query builder: auto-hydrates author
const tweets = await prisma.tweet.findMany({
  include: { author: true },
});
// → tweets[0].author is populated

// $queryRaw: returns flat columns
const tweets = await prisma.$queryRaw<Tweet[]>(
  Prisma.sql`SELECT * FROM "Tweet"`
);
// → tweets[0] has authorId (string), no author object

// Must manually hydrate:
const authorIds = [...new Set(tweets.map(t => t.authorId))];
const authors = await prisma.user.findMany({
  where: { id: { in: authorIds } },
});
const authorMap = new Map(authors.map(a => [a.id, a]));
tweets.forEach(t => t.author = authorMap.get(t.authorId));
```

### Performance: Raw SQL Doesn't Use Prisma Query Cache

**Prisma's in-memory result cache applies only to query builder methods.**

Raw SQL bypasses cache:
```typescript
// First call: hits database
const result1 = await prisma.$queryRaw<User[]>(
  Prisma.sql`SELECT * FROM "User" WHERE id = ${userId}`
);

// Second call: hits database again (no cache)
const result2 = await prisma.$queryRaw<User[]>(
  Prisma.sql`SELECT * FROM "User" WHERE id = ${userId}`
);
```

Use Redis or application-level caching for frequently-executed raw queries.

### DISTINCT ON Ordering Matters

**`DISTINCT ON (cols)` keeps first row per group:**
```sql
SELECT DISTINCT ON ("tweetId") *
FROM feed_items
ORDER BY "tweetId", "effectiveAt" DESC
```

**Order of operations:**
1. Sort by `"tweetId"` (grouping column) then `"effectiveAt" DESC`
2. Keep first row per `"tweetId"` (most recent `effectiveAt`)

**If ORDER BY doesn't match DISTINCT ON columns:**
```sql
-- ❌ WRONG: DISTINCT ON column must appear first in ORDER BY
SELECT DISTINCT ON ("tweetId") *
FROM feed_items
ORDER BY "effectiveAt" DESC, "tweetId"
-- ERROR: SELECT DISTINCT ON expressions must match initial ORDER BY expressions
```

## Testing

### Verify SQL Injection Protection

```typescript
it("should escape user input in $queryRaw", async () => {
  const maliciousQuery = "'; DROP TABLE \"User\"; --";

  // Should not throw or drop table
  const result = await prisma.$queryRaw<Tweet[]>(
    Prisma.sql`
      SELECT * FROM "Tweet"
      WHERE content LIKE ${maliciousQuery}
    `
  );

  // Verify database still intact
  const userCount = await prisma.user.count();
  expect(userCount).toBeGreaterThan(0);
});
```

### Verify Type Safety

```typescript
it("should enforce result type", async () => {
  // Type annotation prevents accidental misuse
  const tweets = await prisma.$queryRaw<Tweet[]>(
    Prisma.sql`SELECT * FROM "Tweet"`
  );

  // TypeScript enforces Tweet shape
  expect(tweets[0]).toHaveProperty("id");
  expect(tweets[0]).toHaveProperty("content");

  // @ts-expect-error - nonexistent property
  tweets[0].nonExistentField;
});
```

### Verify Row-Value Pagination

```typescript
it("should paginate correctly with row-value comparison", async () => {
  // Create test data with known ordering
  const cursor = { effectiveAt: new Date("2024-01-15"), tweetId: "abc123" };

  const result = await prisma.$queryRaw<FeedItem[]>(
    Prisma.sql`
      SELECT "tweetId", "effectiveAt"
      FROM feed_items
      WHERE ("effectiveAt", "tweetId") < (${cursor.effectiveAt}, ${cursor.tweetId})
      ORDER BY "effectiveAt" DESC, "tweetId" DESC
      LIMIT 10
    `
  );

  // All results should be before cursor
  result.forEach((item) => {
    expect(
      item.effectiveAt < cursor.effectiveAt ||
      (item.effectiveAt.getTime() === cursor.effectiveAt.getTime() && item.tweetId < cursor.tweetId)
    ).toBe(true);
  });
});
```

## Related Specs

- `security-input-validation.md` — Zod validation before passing to $queryRaw
- `pagination-cursor-encoding.md` — Cursor structure for row-value comparisons
- `error-handling-validation.md` — Handling $queryRaw query errors
- `caching-feed-assembly.md` — Feed CTE query detailed explanation
