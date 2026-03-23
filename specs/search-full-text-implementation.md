# Full-Text Search Implementation

## What

PostgreSQL full-text search using a GENERATED tsvector column with GIN indexing
for fast, relevance-ranked tweet search. Uses English stemming and stop words to
match natural language queries against tweet content.

## Where

- **Migration**: `prisma/migrations/20260322201544_init/migration.sql` — creates
  `search_vector` column and GIN index
- **Query**: `src/server/trpc/routers/search.ts:131-165` — ts_rank scoring with
  cursor pagination
- **Schema**: Not in `prisma/schema.prisma` (tsvector added via raw SQL migration)

## How It Works

### 1. Generated Column Setup

The migration adds a tsvector column that auto-updates whenever tweet content changes:

```sql
ALTER TABLE "Tweet" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS "Tweet_search_vector_idx" ON "Tweet" USING GIN ("search_vector");
```

- `to_tsvector('english', ...)` — tokenizes content, applies English stemming
  (e.g., "running" → "run"), removes stop words ("the", "and", "is")
- `GENERATED ALWAYS` — column auto-recomputes on INSERT/UPDATE, no application logic needed
- `STORED` — precomputed and stored on disk (vs VIRTUAL)
- `GIN index` — inverted index for fast `@@` containment queries

### 2. Query Execution

Search query at `src/server/trpc/routers/search.ts:147-164`:

```typescript
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
```

- `plainto_tsquery('english', ${query})` — converts user input to tsquery,
  strips punctuation, applies same stemming as to_tsvector
- `@@` operator — checks if search_vector matches query (uses GIN index)
- `ts_rank(search_vector, query)` — relevance score (0.0–1.0), higher = better match
- Cursor pagination on `(rank DESC, createdAt DESC, id DESC)` — handles rank ties
  with timestamp + CUID tiebreaker

### 3. Ranking Algorithm (ts_rank)

`ts_rank()` computes relevance based on:
1. **Term frequency**: how often query terms appear in the document
2. **Document length normalization**: shorter documents rank higher for same term frequency
3. **Cover density**: proximity of matching terms (closer = higher rank)

Formula (simplified): `rank = tf / (tf + document_length_normalization)`

Tied ranks are common for short tweets → composite cursor required.

### 4. Cursor Structure

Search cursor encodes rank + timestamp + ID:

```typescript
// Encoding (src/server/trpc/routers/search.ts:211-230)
const nextCursor = base64url.encode(JSON.stringify({
  rank: tweets[limit].rank,
  ts: tweets[limit].createdAt,
  id: tweets[limit].id,
}));

// Decoding (src/server/trpc/routers/search.ts:59-106)
const cursor = JSON.parse(base64url.decode(input.cursor));
```

Composite key ensures stable pagination even with rank ties.

## Invariants

**I1**: Search vector auto-updates on content changes (GENERATED ALWAYS).
No application code needed to maintain index.

**I2**: English language only. Stemming rules apply (run/running/ran → run).
Stop words ("the", "and", "a") are ignored.

**I3**: Deleted tweets (`deleted = true`) are never returned in search results.

**I4**: Empty query strings are rejected at validation layer (`src/lib/validators.ts`),
never reach PostgreSQL.

**I5**: Rank ties are resolved by (createdAt DESC, id DESC) for deterministic ordering.

**I6**: GIN index covers all `@@` queries. Full table scans impossible for search
(barring index corruption or disabled indexes).

## Gotchas

**G1: No phrase search**
`plainto_tsquery` strips quotes and special characters. Searching for `"exact phrase"`
is equivalent to searching for `exact phrase` (AND of terms, not phrase match).

Use `phraseto_tsquery` if phrase search is needed (requires code change).

**G2: English stemming can surprise users**
- "run" matches "running", "ran", "runs"
- "better" matches "best", "good" (through synonym expansion in some configs, though
  default config does NOT expand synonyms — only stems)

User expectation: exact match. Actual: stemmed match.

**G3: Stop words are invisible**
Searching for "the best tweet" becomes "best tweet" (stop word removed).
Short queries with many stop words can become empty → no results.

**G4: Ranking can tie on short content**
Many tweets have identical rank for generic queries ("twitter", "post").
Cursor must encode (rank, ts, id) to avoid skipping results.

**G5: No multilingual support**
Non-English content is indexed with English stemming rules, causing poor results
for other languages. Would require language detection + per-row to_tsvector language.

**G6: Case-insensitive by default**
"Twitter" and "twitter" are identical after tokenization. Cannot search for
case-sensitive acronyms (e.g., "NASA" vs "nasa").

**G7: Migration-only column**
Prisma schema does NOT include `search_vector` (no TypeScript type). Column exists
only in raw SQL. Adding it to schema would break migrations (Prisma thinks it's new).

**G8: GIN index rebuild is slow**
If the index is dropped/corrupted, `CREATE INDEX` on large tables can take minutes.
Full `VACUUM` or index corruption requires downtime for rebuild.
