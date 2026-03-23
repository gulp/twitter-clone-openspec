# SQL Injection Prevention in Raw Queries

## What

This spec documents safe patterns for using Prisma's `$queryRaw` API to prevent SQL injection vulnerabilities. All raw SQL queries in the codebase use parameterized values — either through `Prisma.sql` tagged templates or `$queryRaw` template literals, both of which automatically escape user input.

## Where

Raw SQL queries appear in 5 locations:

- `src/server/services/feed.ts:278` — feed assembly UNION query
- `src/server/trpc/routers/auth.ts:258` — password reset token SELECT FOR UPDATE
- `src/server/trpc/routers/social.ts:379` — follow suggestions mutual connections query
- `src/server/trpc/routers/search.ts:133` — full-text search with ts_rank
- `src/server/trpc/routers/search.ts:272` — user search with ILIKE pattern matching

## How It Works

### Pattern 1: Prisma.sql Tagged Template (Preferred)

The **safest** pattern uses `Prisma.sql` tagged templates. Prisma automatically parameterizes all interpolated values:

```typescript
// src/server/trpc/routers/search.ts:147-151
const tweets = await prisma.$queryRaw<TweetRow[]>(
  Prisma.sql`
    SELECT t.id, t.content, t."authorId", ts_rank(t.search_vector, query) AS rank
    FROM "Tweet" t, plainto_tsquery('english', ${query}) query
    WHERE t.search_vector @@ query
  `
);
```

**Safety guarantee:** `${query}` is sent as a parameterized value (`$1`, `$2`, etc.) to PostgreSQL. User input CANNOT inject SQL.

**Example with ILIKE pattern concatenation:**
```typescript
// src/server/trpc/routers/search.ts:286-292
Prisma.sql`
  SELECT id, username, "displayName"
  FROM "User"
  WHERE username ILIKE '%' || ${query} || '%'
     OR "displayName" ILIKE '%' || ${query} || '%'
`
```

The `||` concatenation operator is SQL syntax — `${query}` is still parameterized as `$1`.

### Pattern 2: Bare Template Literal (Use with Caution)

`$queryRaw` with **bare template literals** (no `Prisma.sql` tag) also parameterizes values, but is less explicit:

```typescript
// src/server/trpc/routers/social.ts:394-402
const suggestions = await prisma.$queryRaw<UserRow[]>`
  WITH followed AS (
    SELECT "followingId" FROM "Follow" WHERE "followerId" = ${userId}
  )
  SELECT u.id, u.username
  FROM "User" u
  WHERE u.id != ${userId}
`;
```

**Safety guarantee:** Prisma treats `${userId}` as a parameterized placeholder. This is documented in [Prisma's raw database access guide](https://www.prisma.io/docs/orm/prisma-client/queries/raw-database-access/raw-queries#queryraw).

**Why use bare template literals?**
- Simpler syntax for single-parameter queries
- All 3 uses in the codebase pass only **user session IDs** (from `ctx.session.user.id`), not user-controlled input
- Token hash in src/server/trpc/routers/auth.ts:263 is SHA-256 hex string, not user input

### Pattern 3: Prisma.sql with Dynamic SQL Construction (NOT USED)

This project **does NOT** use `Prisma.raw()` or `Prisma.join()` for dynamic SQL construction. All queries have static structure.

**NEVER do this:**
```typescript
// ❌ DANGEROUS: raw string concatenation
const table = input.tableName; // user input
const query = `SELECT * FROM "${table}"`;
await prisma.$queryRawUnsafe(query); // SQL injection vulnerability
```

## Invariants

**I1. All user input is parameterized**
No user-controlled string is ever concatenated into SQL strings. All interpolated values use `${...}` within template literals.

**I2. $queryRawUnsafe is prohibited**
The codebase never uses `$queryRawUnsafe`. Grep confirms zero matches:
```bash
$ grep -r 'queryRawUnsafe' src/
# (no results)
```

**I3. Prisma.sql for complex queries**
Queries with user input in pattern matching (ILIKE, tsquery) use `Prisma.sql` tagged templates for maximum explicitness.

**I4. Bare template literals only for trusted IDs**
Bare `$queryRaw` template literals are only used with:
- Session user IDs from `ctx.session.user.id` (authenticated, server-controlled)
- SHA-256 token hashes (deterministic, no user control)

**I5. No dynamic table/column names**
All table names and column names are hardcoded strings. No user input determines schema structure.

## Gotchas

**G1. Template literal ≠ string concatenation**
```typescript
// ✅ SAFE: Prisma parameterizes ${userId}
await prisma.$queryRaw`SELECT * FROM "User" WHERE id = ${userId}`;

// ❌ UNSAFE: Manual concatenation bypasses parameterization
const query = `SELECT * FROM "User" WHERE id = '${userId}'`;
await prisma.$queryRawUnsafe(query);
```

**G2. Prisma.sql is required for ILIKE wildcard patterns**
User input in ILIKE patterns must use `Prisma.sql`:
```typescript
// ✅ SAFE: Prisma.sql parameterizes ${query}
Prisma.sql`WHERE username ILIKE '%' || ${query} || '%'`

// ⚠️ Less explicit (but still safe if using $queryRaw template literal):
`WHERE username ILIKE '%' || ${query} || '%'`
```

The latter works because Prisma parameterizes `${query}`, but `Prisma.sql` is clearer.

**G3. CTEs and subqueries are still safe**
Complex queries with CTEs (Common Table Expressions) and subqueries remain safe as long as all interpolated values use `${...}` syntax:
```typescript
// src/server/trpc/routers/social.ts:394-404
await prisma.$queryRaw`
  WITH followed AS (
    SELECT "followingId" FROM "Follow" WHERE "followerId" = ${userId}
  ),
  mutual AS (
    SELECT f."followingId" AS "suggestedUserId", COUNT(*) AS "mutualCount"
    FROM "Follow" f
    WHERE f."followerId" IN (SELECT "followingId" FROM followed)
      AND f."followingId" != ${userId}
    GROUP BY f."followingId"
  )
  SELECT u.id FROM "User" u JOIN mutual m ON u.id = m."suggestedUserId"
`;
```

Both `${userId}` instances are parameterized separately.

**G4. Prisma auto-escapes double quotes in identifiers**
Table and column names with double quotes (e.g., `"User"`, `"followerId"`) are static SQL — never interpolated. Prisma does not parameterize identifiers, only values.

**G5. Type annotations do not affect safety**
```typescript
const tweets = await prisma.$queryRaw<TweetRow[]>`SELECT ...`;
```

The `<TweetRow[]>` type hint only affects TypeScript type-checking. It does NOT bypass parameterization.

## Validation Against Plan

**§1.11 Full-Text Search Setup (plan lines 302-303):**
> "Use `Prisma.sql` tagged template to prevent injection (NEVER string interpolation)"

✅ Implemented: `src/server/trpc/routers/search.ts:147` uses `Prisma.sql` for tsquery.

**§1.22 Search Pagination (plan lines 444-450):**
> "CRITICAL: Use Prisma.sql template for all user input (I8)"

✅ Implemented: Both tweet search (line 147) and user search (line 286) use `Prisma.sql`.

**§8 Security Model (plan lines 1505-1531):**
> "SQL injection: Raw FTS queries — Prisma.sql templates (no string interp)"

✅ Implemented: Zero uses of string concatenation with user input.

## Related Specs

- `database-queryraw-patterns.md` — When to use raw SQL vs Prisma query builder
- `security-input-validation.md` — Zod validation at API boundaries (first line of defense)
- `error-handling-subsystem-failure-policies.md` — PostgreSQL connection failure handling
