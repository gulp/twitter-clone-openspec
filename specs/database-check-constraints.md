# Database CHECK Constraints

## What

PostgreSQL CHECK constraints enforce data integrity invariants at the database layer, providing a last line of defense against bugs in application logic. Four constraints guard against negative counts, soft-delete inconsistency, and empty tweets.

## Where

All constraints are defined in `prisma/migrations/20260322201544_init/migration.sql:239-246`.

Application code does not reference these constraints by name — they are enforced automatically by PostgreSQL on INSERT/UPDATE operations.

## How It Works

### 1. User_counts_nonneg (line 239-240)

```sql
ALTER TABLE "User" ADD CONSTRAINT "User_counts_nonneg"
  CHECK ("followerCount" >= 0 AND "followingCount" >= 0 AND "tweetCount" >= 0);
```

**Purpose:** Prevents negative follower/following/tweet counts caused by concurrent decrement races or double-unfollow bugs.

**Enforced on:** User table INSERT/UPDATE operations.

**Error behavior:** PostgreSQL raises `23514` (check_violation) if constraint fails. Prisma surfaces this as `P2034` (`TransactionWriteConflict`) or uncaught database error depending on driver version.

### 2. Tweet_counts_nonneg (line 241-242)

```sql
ALTER TABLE "Tweet" ADD CONSTRAINT "Tweet_counts_nonneg"
  CHECK ("likeCount" >= 0 AND "retweetCount" >= 0 AND "replyCount" >= 0);
```

**Purpose:** Prevents negative engagement counts caused by concurrent unlike/unretweet races or double-decrement bugs.

**Enforced on:** Tweet table INSERT/UPDATE operations.

**Error behavior:** Same as User_counts_nonneg — raises `23514`.

### 3. Tweet_deleted_consistency (line 243-244)

```sql
ALTER TABLE "Tweet" ADD CONSTRAINT "Tweet_deleted_consistency"
  CHECK (("deleted" = false AND "deletedAt" IS NULL) OR ("deleted" = true AND "deletedAt" IS NOT NULL));
```

**Purpose:** Enforces soft-delete state machine: either both flags are false/NULL (active tweet) or both are true/timestamp (deleted tweet). Prevents inconsistent states like `deleted=true` but `deletedAt=NULL` (timestamp missing) or `deleted=false` but `deletedAt` set (zombie undelete).

**Enforced on:** Tweet table INSERT/UPDATE operations.

**Error behavior:** Raises `23514` if soft-delete state is inconsistent.

**Application pattern:** Soft-delete always sets both fields in same transaction:
```typescript
// src/server/trpc/routers/tweet.ts:253-259
prisma.tweet.update({
  where: { id: tweetId },
  data: {
    deleted: true,
    deletedAt: new Date(),
  },
})
```

### 4. Tweet_content_or_media (line 245-246)

```sql
ALTER TABLE "Tweet" ADD CONSTRAINT "Tweet_content_or_media"
  CHECK (char_length(content) > 0 OR cardinality("mediaUrls") > 0);
```

**Purpose:** Ensures every tweet has either text content or media attachments (or both). Prevents empty tweets caused by client-side validation bypass or race conditions between content clearing and media upload.

**Enforced on:** Tweet table INSERT/UPDATE operations.

**PostgreSQL functions used:**
- `char_length()`: Returns number of characters (not bytes) in `content` string. Empty string returns 0.
- `cardinality()`: Returns array length. Empty `String[]` returns 0.

**Error behavior:** Raises `23514` if both content is empty AND mediaUrls array is empty.

**Application validation:** No Zod validator enforces content-or-media at input layer. The CHECK constraint is the sole enforcement mechanism. Content length is validated separately (`src/lib/validators.ts:16`: `tweetContentSchema = z.string().max(280)`), but empty content + empty mediaUrls is allowed through to DB where constraint fires.

## Invariants

**I1:** User counts (followerCount, followingCount, tweetCount) are always >= 0. Application decrements that would violate this fail at database commit.

**I2:** Tweet counts (likeCount, retweetCount, replyCount) are always >= 0. Application decrements that would violate this fail at database commit.

**I3:** Tweet soft-delete state is always consistent: `(deleted=false ∧ deletedAt=NULL) ∨ (deleted=true ∧ deletedAt≠NULL)`. No partial soft-deletes.

**I4:** Every tweet has non-empty content OR non-empty mediaUrls array (or both). No completely empty tweets can exist.

**I5:** CHECK constraints are schema-level invariants verified on EVERY row modification. They cannot be disabled by application code or bypassed via direct SQL without `SET CONSTRAINTS` (which requires superuser).

**I6:** Constraint violations return PostgreSQL error code `23514` (`check_violation`). Prisma may map this to `P2034` or surface as generic database error depending on driver.

## Gotchas

**G1: Transaction rollback on constraint violation**

If a CHECK constraint fails, the entire transaction is rolled back. For multi-step transactions (e.g., unlike + decrement count + bump feed version), a constraint violation at step 2 undoes step 1.

Example: Concurrent unlikes cause double-decrement attempt:
```typescript
// Thread A: likeCount = 1 → 0 (succeeds)
// Thread B: likeCount = 1 → 0 (races with A, sees stale count)
// Thread B: tries to decrement 0 → -1 → CHECK constraint fires → transaction rolled back
```

Application code must handle `P2034` or `23514` errors gracefully (see `error-handling-prisma-race-conditions.md`).

**G2: Constraint names are not exposed in Prisma schema**

CHECK constraints are raw SQL (migration file only). Prisma schema.prisma has no syntax for declaring CHECK constraints, so they are invisible to `prisma generate` and IDE autocomplete. Developers must read migration files to discover constraints.

**G3: String length vs byte length**

`char_length(content) > 0` counts Unicode characters, not bytes. Empty string `""` has `char_length = 0`. String with only whitespace `"   "` has `char_length = 3` (allowed by constraint, but rejected by Zod validator at input layer).

**G4: Array cardinality for empty vs NULL**

`cardinality("mediaUrls")` returns:
- `0` for empty array `[]`
- `NULL` for SQL NULL value (not possible with Prisma `String[]` default `[]`)

The constraint uses `OR`, so `NULL` array would still pass if content is non-empty. However, Prisma's `@default([])` ensures mediaUrls is never NULL.

**G5: No automatic error recovery**

Unlike application-layer validation (which can retry or prompt user for correction), CHECK constraint violations are hard failures. The transaction is aborted, and application must handle the error explicitly. No "soft" validation warnings.

**G6: Migration ordering matters**

CHECK constraints are added AFTER all tables/columns/indexes are created (lines 239-246 at end of migration). If added earlier, they would fail on table creation because columns don't exist yet.

**G7: Renaming columns requires constraint updates**

If a column referenced by a CHECK constraint is renamed (e.g., `followerCount` → `followers_count`), the constraint must be manually updated in a new migration. Prisma does not auto-update CHECK constraints during renames.

**G8: Performance impact is negligible**

CHECK constraints are evaluated in-memory by PostgreSQL during row updates. Simple arithmetic checks (`>= 0`, `char_length() > 0`) add <1μs overhead per row. No index scans or table locks.

**G9: Cannot reference other tables**

PostgreSQL CHECK constraints are row-level only. They cannot reference other tables (use foreign key constraints or triggers for cross-table validation). For example, you cannot add a CHECK constraint that verifies `authorId EXISTS IN User`.

**G10: Constraint violations during bulk operations**

Bulk updates (`updateMany`) fail atomically if ANY row violates a constraint. Use `Promise.allSettled()` with individual `update()` calls if partial success is acceptable (see `error-handling-promise-patterns.md`).
