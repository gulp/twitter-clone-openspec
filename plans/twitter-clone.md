# Twitter Clone — Clean-Room Implementation Plan

> Generated from openspec/ artifacts. This is the authoritative build plan.
> All existing code is deleted. Every file listed below must be created from scratch.

---

## Project Identity

| Field | Value |
|-------|-------|
| **Project** | Twitter Clone |
| **Target users** | Developers evaluating the stack; portfolio/demo audiences |
| **Problem** | Production-grade social media app demonstrating Next.js 14 + tRPC + Prisma patterns |
| **Constraints** | Single-server v1; no edit, DMs, video, ML ranking, or moderation |
| **Stack** | TypeScript · Next.js 14 (App Router) · PostgreSQL · Redis · S3/MinIO · Node 22+ |

## Goals

1. Feature-complete Twitter clone: auth, tweets, social graph, engagement, feed, search, notifications, media upload, real-time SSE.
2. Production-grade security: CSP nonces, CSRF origin checks, timing-safe auth, zero data leaks (`hashedPassword`, `email` on public endpoints).
3. Structured observability: JSON logs with request IDs, health checks, per-feature Redis failure telemetry.
4. Multi-agent parallelizable: explicit phase dependencies, per-task acceptance criteria, file-level ownership boundaries.
5. Correct under concurrency: atomic count updates via Prisma `{ increment: 1 }`, idempotent mutations, cache versioning.

## Non-Goals (v1)

- Tweet editing
- Direct messages
- Video / audio media
- ML-based feed ranking or personalization
- Content moderation / reporting / admin dashboard
- Email verification on registration (OAuth requires verified email from provider)
- Username changes post-creation
- Bookmarks
- Hashtags / trending topics (right sidebar shows placeholder only)
- Multi-server horizontal scaling (single-process SSE acceptable)
- Internationalization (i18n)
- Feature flags (greenfield — all features ship together)
- Native mobile apps

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
1. [Architecture Decisions & Gap Resolution](#1-architecture-decisions--gap-resolution)
2. [Directory Structure](#2-directory-structure)
3. [Prisma Schema (Reference Artifact)](#3-prisma-schema-reference-artifact)
4. [Redis Key Patterns](#4-redis-key-patterns)
5. [tRPC Router Structure](#5-trpc-router-structure)
6. [Phase Plan (Reordered for Parallelism)](#6-phase-plan)
7. [Risks & Mitigations](#7-risks--mitigations)
8. [Security Model](#8-security-model)
9. [Performance Targets & Observability](#9-performance-targets--observability)
10. [Error Handling Philosophy](#10-error-handling-philosophy)
11. [Deployment & Rollout](#11-deployment--rollout)

---

## Architecture Overview

### Component Diagram

```
┌──────────┐       ┌────────────────────────────────────┐       ┌─────────┐
│  Browser  │──────▶│  Next.js 14 (Node 22+)             │──────▶│ S3/MinIO│
│           │◀──────│                                    │       └─────────┘
│ tRPC hooks│       │  middleware.ts (CSP nonce, CSRF)    │          ▲
│ SSE client│       │  ┌────────────────────────────────┐│          │
│ S3 upload ├───────┼──┤ pre-signed PUT (direct upload) ├┼──────────┘
└──────────┘       │  └────────────────────────────────┘│
                    │  tRPC middleware chain:             │
                    │    auth → rate-limit → requestId    │
                    │  Routers:                           │
                    │    auth · user · tweet · feed       │
                    │    social · engagement · notification│
                    │    search · media                   │
                    │  Services:                          │
                    │    notification · mention · feed    │
                    │    email · sse-publisher · rate-limit│
                    └──────┬────────────────┬─────────────┘
                           │                │
                    ┌──────▼──────┐  ┌──────▼──────┐
                    │ PostgreSQL   │  │   Redis      │
                    │ (Prisma ORM) │  │  sessions    │
                    │ FTS (GIN)    │  │  feed cache  │
                    │ pg_trgm      │  │  rate-limit  │
                    │ CHECK constr │  │  SSE pub/sub │
                    │              │  │  replay buf  │
                    └──────────────┘  └──────────────┘
```

### Data Flows

**1. Authenticated mutation (e.g., `tweet.create`):**
```
Browser → POST /api/trpc/tweet.create
  → middleware.ts: verify Origin header, generate CSP nonce
  → tRPC context: extract JWT, verify signature + Redis jti allow-list + sessionVersion
  → rate-limiter middleware: check Redis sliding window
  → Zod input validation (tweetContentSchema)
  → Prisma transaction: INSERT tweet + INCREMENT author.tweetCount
  → parseMentions → createNotification (async, post-commit)
  → bump feed:version for author's followers (Redis INCR)
  → SSE publisher: Lua script → PUBLISH + LPUSH replay buffer per follower
  → return { tweet }
```

**2. Feed read with cache (`feed.home`):**
```
Browser → GET /api/trpc/feed.home?cursor=...
  → tRPC auth check
  → compare Redis feed:version:{userId} vs cached version
  → HIT:  deserialize page, filter against tombstones:tweets set, return
  → MISS: SETNX feed:{userId}:rebuilding (5s lock)
    → raw SQL UNION (original tweets + retweets from followed users)
    → DISTINCT ON dedup → hydrate with publicUserSelect
    → batch-check hasLiked/hasRetweeted (§1.16)
    → cache page in Redis (60s TTL), return { items, nextCursor }
  → Redis unavailable: fall through to PostgreSQL (degraded, not broken)
```

**3. SSE event lifecycle:**
```
Browser → GET /api/sse (EventSource with credentials)
  → auth check → Redis SUBSCRIBE user channel → hold connection
  → heartbeat every 30s → on event: write id:{seq}\nevent:{type}\ndata:{json}\n\n
  → on connection drop: unsubscribe, clean up
  → on SIGTERM: send event:server_restart, close all
  → client reconnects with Last-Event-ID → replay from buffer
```

### System Invariants

Non-negotiable. Every agent verifies compliance before closing a task.

| # | Invariant | Enforced by |
|---|-----------|-------------|
| I1 | `hashedPassword` and `sessionVersion` never appear in any API response | `publicUserSelect` / `selfUserSelect` in `db.ts` |
| I2 | `email` never appears on public endpoints (only self-scoped reads) | `publicUserSelect` excludes `email` |
| I3 | Denormalized counts updated atomically in same transaction as relationship write | Prisma `{ increment: 1 }` in transaction |
| I4 | Counts are never negative | PostgreSQL CHECK constraints (§1.21) |
| I5 | Deleted tweets return 404; never rendered in feeds or search | `deleted = false` filter everywhere; tombstone set for cached feeds |
| I6 | Self-actions blocked: no self-follow, self-retweet, self-notification | Explicit checks + `createNotification` self-suppression |
| I7 | All user input validated by Zod before business logic | tRPC `.input()` with schemas from `validators.ts` |
| I8 | All raw SQL uses parameterized queries (`Prisma.sql` tagged template) | No string interpolation in `$queryRaw` |
| I9 | Cookie-authenticated mutations reject mismatched `Origin` header | `middleware.ts` CSRF check (§1.20) |
| I10 | Auth errors never reveal whether an email/username exists | Generic messages; constant-time `requestReset` (§1.4) |

---

## 1. Architecture Decisions & Gap Resolution

The specs leave several things unspecified. These are the concrete decisions for each gap.

### 1.1 IDs: Prisma `cuid()`
All primary keys use Prisma's built-in `@default(cuid())`. Note: this generates CUID (not CUID2 from `@paralleldrive/cuid2`). CUIDs are URL-safe, roughly time-ordered, and avoid UUID display ugliness. Tweet IDs in URLs look like `/tweet/clx9abc123` rather than `/tweet/550e8400-e29b-...`.

### 1.2 Cursor-Based Pagination Pattern
Every paginated endpoint uses the same shape:
```typescript
type PaginatedInput = { cursor?: string; limit?: number }  // limit defaults to 20
type PaginatedOutput<T> = { items: T[]; nextCursor: string | null }
```
Cursors are **opaque base64url-encoded** payloads. Clients must never parse or construct them — this decouples the wire format from sort internals and lets us change the backing query without breaking pagination.

For any list ordered by time, the canonical sort key is `(createdAt DESC, id DESC)`, and the cursor payload is `{ ts, id }`. For lists ordered by another field (e.g., search rank), the cursor must include all tie-break fields needed for stable total ordering.

**Compound cursor encoding/decoding:**
```typescript
type CursorPayload = { ts: string; id: string };

// Encode: last item in page → opaque cursor string
const encodeCursor = (item: { createdAt: Date; id: string }): string =>
  Buffer.from(JSON.stringify({ ts: item.createdAt.toISOString(), id: item.id }))
    .toString('base64url');

// Decode: opaque cursor → WHERE clause components
const decodeCursor = (cursor: string): CursorPayload =>
  JSON.parse(Buffer.from(cursor, 'base64url').toString());

// SQL WHERE for cursor-based pagination:
// WHERE ("createdAt" < $cursorTs)
//    OR ("createdAt" = $cursorTs AND id < $cursorId)
// ORDER BY "createdAt" DESC, id DESC
```

### 1.3 Engagement Counts: Denormalized Columns
The spec mentions "increment/decrement counts" for likes, retweets, replies, followers, following. We store these as denormalized integer columns on Tweet (`likeCount`, `retweetCount`, `replyCount`) and User (`followerCount`, `followingCount`, `tweetCount`). Updates happen in the same Prisma transaction as the relationship creation/deletion, using Prisma's atomic `{ increment: 1 }` / `{ decrement: 1 }` operators. Never read a count into memory and write back `count + 1` — that races under concurrency.

**Count reconciliation:** Denormalized counts can drift due to edge-case failures. Add a `scripts/reconcile-counts.ts` script that recomputes all counts from source-of-truth tables (`SELECT COUNT(*) FROM "Like" WHERE "tweetId" = ?`). Run periodically or on-demand. Not in critical path — purely operational.

### 1.4 Password Reset Token Storage
The spec says "1-hour one-time link." We store tokens in a `PasswordResetToken` model with `token` (hashed with SHA-256, the raw token goes in the email), `userId`, `expiresAt`. The token is a `crypto.randomBytes(32).toString('hex')`.

Only one active (unused, unexpired) reset token may exist per user at a time. Issuing a new reset token marks all prior unused tokens for that user as used. The `requestReset` endpoint must always return a generic success response regardless of whether the email exists, to prevent account enumeration.

**Timing-attack prevention:** The `requestReset` handler MUST NOT await the email send. Use fire-and-forget (`void sendResetEmail(...)`) so the response returns in constant time regardless of whether a user was found. Additionally, enforce a minimum response delay of 200ms (via `await sleep(200)` before returning) to flatten any residual timing signal from the DB lookup.

**Session invalidation on reset:** completing a reset increments `User.sessionVersion`, which invalidates all active JWTs (see §1.10).

### 1.5 Email Sending
Specs mention sending password reset emails but do not specify a provider. Decision: use `nodemailer` with a configurable SMTP transport. For local dev, use Ethereal (fake SMTP). The email service is a thin abstraction (`src/server/services/email.ts`) so it can be swapped for SendGrid/SES later. Email sends MUST be fire-and-forget from request handlers — never block the HTTP response on SMTP negotiation.

### 1.6 OAuth Username Generation
When a user signs in via OAuth for the first time, we need to generate a username (the spec says accounts are auto-created). Decision: generate the user's CUID primary key first, then derive the username from the OAuth display name — lowercase, strip non-alphanumeric, truncate to 9 chars, append `_` plus the first 6 characters of the CUID (e.g., `johndoe_abc123`).

**Collision handling:** The CUID prefix guarantees mathematical uniqueness on the first insert — zero retries, zero `P2002` exception handling needed. Do not use a `catch P2002` retry loop; it thrashes the DB connection pool under adversarial conditions.

**v1 decision:** Auto-generate username, no onboarding step. Users can see their profile and change displayName/bio but username is immutable per spec. Only auto-create an account when the OAuth provider supplies a verified email; reject sign-in otherwise.

### 1.7 Rate Limiting
Not mentioned in specs but needed. Decision: Redis-based sliding window rate limiter as tRPC middleware. Rates:
- Auth endpoints (register, login, password reset): 5 requests/minute per IP
- Tweet creation: 30 tweets/hour per user
- General API: 100 requests/minute per user

**Implementation constraints:**
1. Use both IP-based and principal-based keys for sensitive flows (`ip`, `email`, `userId`) so attackers cannot rotate one dimension cheaply.
2. Client IP extraction is configuration, not guesswork. Only trust `x-forwarded-for` when running behind a known reverse proxy; otherwise use the direct socket address.

**Redis failure policy:** Fail **closed** for auth and reset endpoints (reject the request — turning a Redis outage into an account-abuse incident is worse than brief downtime). Fail **open** for non-mutating read endpoints (with structured warning logs).

### 1.8 SSE Implementation
The spec says "single multiplexed SSE connection." Decision: a Next.js Route Handler at `GET /api/sse` that checks auth, holds the connection open, and writes `text/event-stream` responses.

**Transport:** Use Redis Pub/Sub for event distribution from day one. Since Redis is already required for sessions/rate-limits/cache, adding a second event transport later is needless migration risk. An in-memory EventEmitter fallback is acceptable only for local `npm test` runs where Redis may not be available.

Event types: `new-tweet`, `notification`, `tweet_deleted`.

**Protocol requirements:**
- Include `retry: 5000` directive so clients back off consistently
- Obtain per-user monotonic sequence numbers via Redis `INCR sse:seq:{userId}`; include the integer in the SSE `id:` field
- Publishing an event MUST atomically `PUBLISH` to Pub/Sub AND `LPUSH` to the replay buffer in a single Redis Lua script to prevent lost events on process crash
- Replay buffer: `sse:replay:{userId}` with 5-minute TTL, capped at 200 entries via `LTRIM 0 199` after each push
- Send heartbeat comments (`: heartbeat\n\n`) every 30 seconds; clean up listener on write failure
- **Connection draining:** On `SIGTERM`, send `event: server_restart` to all active SSE streams, then close them server-side. This prevents deployment hangs from long-lived connections

### 1.9 Feed Assembly Strategy
The design doc confirms fan-out-on-read. Home timeline query uses a single UNION query to avoid race conditions at page boundaries:

```sql
WITH followed AS (
  SELECT "followingId" FROM "Follow" WHERE "followerId" = $1
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
ORDER BY "effectiveAt" DESC, "tweetId" DESC
LIMIT 21;
```

Then:
1. Hydrate tweet + author data for the resulting IDs (single batched query with `publicUserSelect`), preserving the `deduped` row order
2. Batch-check hasLiked/hasRetweeted for all tweet IDs (see §1.16)
3. Cache assembled page in Redis using versioned key `feed:{userId}:v:{version}:page:{cursorHash}` with TTL 60s

**Home-feed cursor:** Because home feed ordering is by `effectiveAt DESC, tweetId DESC`, the opaque cursor payload for `feed.home` is `{ effectiveAt, tweetId }`, not the raw tweet `createdAt`. This avoids duplicates/skips when a retweet changes the effective ordering.

**Cache versioning:** Instead of a TTL-based invalidation flag, maintain a monotonic `feed:version:{userId}` counter in Redis. Bump on new tweet, follow/unfollow, or retweet. Cache reads check the version; a mismatch means the cache is stale and triggers a DB query.

**Tombstone filtering for deletes:** Do NOT bump `feed:version` for followers on tweet deletion — that causes thundering-herd cache rebuilds for high-follower accounts. Instead, add the deleted tweet's ID to a Redis Set `tombstones:tweets` (60s TTL). When serving a cached feed page, intersect the cached tweet IDs against the tombstone set and filter matches in memory before returning. The cache naturally rotates out the deleted tweet when its 60s TTL expires.

**Stale-while-revalidate:** On cache miss, use `SETNX` on a lock key (`feed:{userId}:rebuilding`, 5s TTL) so only one process rebuilds the cache. Other concurrent requests receive the stale page (if available) or wait briefly. This prevents thundering-herd database load on high-follower-count users.

### 1.10 NextAuth Session Strategy
Use NextAuth with `jwt` strategy for the session token (stored in HTTP-only cookie), but maintain a server-side allow-list in Redis keyed by the JWT's `jti` claim. This allows session invalidation (logout, password reset) while keeping NextAuth happy.

The JWT contains `{ sub: userId, jti: sessionId, sv: sessionVersion }`.

**Validation rule:** a request is authenticated only if:
1. the JWT signature verifies,
2. `session:jti:{jti}` exists in Redis, AND
3. `token.sv === User.sessionVersion` (checked on every request from DB or a short-lived cache).

This closes the gap where a password reset or "logout everywhere" should invalidate already-issued JWTs immediately — incrementing `sessionVersion` invalidates all tokens without needing to enumerate Redis keys.

Note: The `Session` model in the Prisma schema is omitted — JWT strategy with Redis-backed allow-list is used instead. The `Session` model is only needed if falling back to database sessions.

### 1.11 Full-Text Search Setup
PostgreSQL `tsvector` column on Tweet with a GIN index. Use a generated column `search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED`. This avoids triggers and keeps the schema self-contained. The search query uses `plainto_tsquery` with `ts_rank` for ordering. Note: the canonical column name is `search_vector` (snake_case) everywhere — in migration SQL, in raw queries, and in plan references.

### 1.12 No Edit in v1
The design.md is authoritative. No tweet edit functionality.

### 1.13 User Select Pattern (public vs self)

Define separate Prisma `select` objects in `src/server/db.ts` — public endpoints must never return `email`:
```typescript
export const publicUserSelect = {
  id: true, username: true, displayName: true,
  bio: true, avatarUrl: true, bannerUrl: true, createdAt: true,
  followerCount: true, followingCount: true, tweetCount: true,
} as const;

export const selfUserSelect = {
  ...publicUserSelect,
  email: true,
} as const;
```
Public endpoints (`getByUsername`, followers/following lists, likers, search results, notification actor payloads, tweet author payloads) MUST use `publicUserSelect`. Only self-scoped reads (own profile, own settings) may use `selfUserSelect`. NEVER use `include: { author: true }` without an explicit `select` — Prisma returns all columns by default, including `hashedPassword` and `sessionVersion`.

### 1.14 Standard Error Format

All tRPC errors use the built-in `TRPCError` with these conventions:
```typescript
// Validation errors (user input problems)
throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tweet exceeds 280 character limit' });

// Auth errors
throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You must be logged in' });

// Permission errors
throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only delete your own tweets' });

// Not found
throw new TRPCError({ code: 'NOT_FOUND', message: 'Tweet not found' });

// Rate limit
throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded. Try again in {n} seconds.' });
```
Error messages in this plan are authoritative — agents should use the exact strings shown in the specs (e.g., "Cannot retweet your own tweet", "Cannot follow yourself").

### 1.15 Shared Zod Validators

Key validators to include in `src/lib/validators.ts`:
```typescript
export const usernameSchema = z.string().min(3).max(15).regex(/^[a-zA-Z0-9_]+$/);
export const passwordSchema = z.string().min(8);
export const displayNameSchema = z.string().max(50);
export const bioSchema = z.string().max(160);
export const tweetContentSchema = z.string().min(1).max(280);
export const emailSchema = z.string().email();
```

### 1.16 Batch Engagement State Check

When hydrating a list of tweets for an authenticated user, check hasLiked/hasRetweeted in two batched queries:
```sql
SELECT "tweetId" FROM "Like" WHERE "userId" = $1 AND "tweetId" = ANY($2::text[]);
SELECT "tweetId" FROM "Retweet" WHERE "userId" = $1 AND "tweetId" = ANY($2::text[]);
```
Convert results to `Set<string>` and annotate each feed item with `hasLiked`/`hasRetweeted` booleans. Never do per-tweet subqueries.

### 1.17 Security Headers

Static headers in `next.config.ts` via the `headers()` function:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `X-XSS-Protection: 0` (rely on CSP instead)
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (production only)

CSP is generated per-request in `src/middleware.ts` with a nonce:
- `default-src 'self'`
- `script-src 'self' 'nonce-{requestNonce}'`
- `style-src 'self' 'unsafe-inline'`
- `img-src 'self' data: blob: https://*.amazonaws.com https://*.minio.*`
- `frame-ancestors 'none'`
- `base-uri 'self'`
- `form-action 'self'`

### 1.18 Logging

Use structured JSON output in production via a thin wrapper with automatic redaction of sensitive fields:
```typescript
// src/lib/logger.ts
type LogFields = {
  requestId?: string;
  route?: string;
  userId?: string;
  errorCode?: string;
  latencyMs?: number;
} & Record<string, unknown>;

const REDACTED_KEYS = ['password', 'hashedPassword', 'token', 'access_token', 'refresh_token'];

const redact = (data?: LogFields): LogFields | undefined => {
  if (!data) return data;
  const clone = { ...data };
  for (const key of REDACTED_KEYS) delete clone[key];
  return clone;
};

export const log = {
  info: (msg: string, data?: LogFields) =>
    console.log(JSON.stringify({ level: 'info', msg, ...redact(data), ts: new Date().toISOString() })),
  warn: (msg: string, data?: LogFields) =>
    console.warn(JSON.stringify({ level: 'warn', msg, ...redact(data), ts: new Date().toISOString() })),
  error: (msg: string, data?: LogFields) =>
    console.error(JSON.stringify({ level: 'error', msg, ...redact(data), ts: new Date().toISOString() })),
};
```
Use at key boundaries: tRPC error handler, auth failures, rate limit hits, Redis failures, SSE connection lifecycle. Do NOT log request bodies or sensitive data.

### 1.19 Request ID Propagation

Every incoming request gets a `requestId` (UUIDv4) generated in tRPC middleware. Inject into `ctx.requestId` and pass to every logger call, Prisma query (via Prisma client extensions), and Redis operation. This enables correlating distributed errors to a single user action.

### 1.20 CSRF / Origin Validation

Cookie-authenticated mutation endpoints require explicit origin validation. In `src/middleware.ts`, reject all unsafe methods (`POST`) on `/api/trpc` and `/api/auth` unless the `Origin` header matches `APP_ORIGIN` or `ALLOWED_PREVIEW_ORIGINS`. Surface failures as `403 FORBIDDEN` with a structured warning log including `requestId` and `origin`.

### 1.21 Database CHECK Constraints

Add raw SQL constraints in the migration to catch bugs at the DB level:
```sql
-- Non-negative counts
ALTER TABLE "User" ADD CONSTRAINT "User_counts_nonneg"
  CHECK ("followerCount" >= 0 AND "followingCount" >= 0 AND "tweetCount" >= 0);
ALTER TABLE "Tweet" ADD CONSTRAINT "Tweet_counts_nonneg"
  CHECK ("likeCount" >= 0 AND "retweetCount" >= 0 AND "replyCount" >= 0);
-- Soft-delete consistency
ALTER TABLE "Tweet" ADD CONSTRAINT "Tweet_deleted_consistency"
  CHECK (("deleted" = false AND "deletedAt" IS NULL) OR ("deleted" = true AND "deletedAt" IS NOT NULL));
-- Content or media required
ALTER TABLE "Tweet" ADD CONSTRAINT "Tweet_content_or_media"
  CHECK (char_length(content) > 0 OR cardinality("mediaUrls") > 0);
```

### 1.22 Search Pagination

Both `search.tweets` and `search.users` use the standard cursor pagination shape from §1.2. Reject empty/whitespace-only queries with `BAD_REQUEST`. Enforce minimum normalized query length of 2 characters.

- Tweet search order: `rank DESC, createdAt DESC, id DESC`; cursor payload `{ rank, ts, id }`
- User search order: `followerCount DESC, id DESC`; cursor payload `{ followerCount, id }`

---

## 2. Directory Structure

```
twitter-clone/
├── .env.example
├── .env.local                    # git-ignored
├── .gitignore
├── docker-compose.yml
├── next.config.ts
├── package.json
├── postcss.config.js
├── tailwind.config.ts
├── tsconfig.json
├── vitest.config.ts
├── prisma/
│   ├── schema.prisma
│   └── migrations/               # auto-generated
├── public/
│   └── placeholder-avatar.png
├── scripts/
│   ├── reconcile-counts.ts       # operational: recompute denormalized counts
│   └── sse-lua/publish.lua       # atomic SSE publish + replay buffer script
├── src/
│   ├── env.ts                    # Zod-based env validation at process start
│   ├── middleware.ts             # Next.js middleware: CSP nonce, CSRF origin check
│   ├── app/                      # Next.js App Router pages
│   │   ├── layout.tsx            # root layout (providers, fonts)
│   │   ├── page.tsx              # redirect to /home or /login
│   │   ├── globals.css           # Tailwind imports
│   │   ├── error.tsx             # root error boundary
│   │   ├── not-found.tsx         # root 404 page
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   ├── register/page.tsx
│   │   │   └── reset-password/
│   │   │       ├── page.tsx      # request reset
│   │   │       └── [token]/page.tsx  # complete reset
│   │   ├── (main)/               # layout with sidebar nav
│   │   │   ├── layout.tsx        # app shell: left nav, right sidebar
│   │   │   ├── home/page.tsx     # home feed
│   │   │   ├── search/page.tsx   # search page with tabs
│   │   │   ├── notifications/page.tsx
│   │   │   ├── [username]/
│   │   │   │   ├── page.tsx      # user profile
│   │   │   │   ├── followers/page.tsx
│   │   │   │   ├── following/page.tsx
│   │   │   │   └── status/
│   │   │   │       └── [tweetId]/page.tsx  # tweet detail
│   │   │   └── compose/
│   │   │       └── tweet/page.tsx  # mobile compose
│   │   └── api/
│   │       ├── trpc/[trpc]/route.ts  # tRPC handler
│   │       ├── auth/[...nextauth]/route.ts  # NextAuth
│   │       ├── sse/route.ts       # SSE endpoint
│   │       └── health/route.ts    # Health check endpoint
│   ├── components/
│   │   ├── providers.tsx          # Client wrapper: SessionProvider, tRPC, QueryClient
│   │   ├── ui/                    # generic UI primitives
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── modal.tsx
│   │   │   ├── avatar.tsx
│   │   │   ├── skeleton.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── dropdown.tsx
│   │   │   └── infinite-scroll.tsx
│   │   ├── auth/
│   │   │   ├── login-form.tsx
│   │   │   ├── register-form.tsx
│   │   │   └── oauth-buttons.tsx
│   │   ├── tweet/
│   │   │   ├── tweet-card.tsx
│   │   │   ├── tweet-composer.tsx
│   │   │   ├── tweet-thread.tsx
│   │   │   ├── quote-tweet-embed.tsx
│   │   │   └── engagement-buttons.tsx
│   │   ├── media/
│   │   │   ├── image-grid.tsx
│   │   │   ├── image-lightbox.tsx
│   │   │   └── image-upload.tsx
│   │   ├── profile/
│   │   │   ├── profile-header.tsx
│   │   │   ├── profile-tabs.tsx
│   │   │   └── edit-profile-modal.tsx
│   │   ├── feed/
│   │   │   ├── feed-list.tsx
│   │   │   ├── new-tweets-indicator.tsx
│   │   │   └── empty-feed.tsx
│   │   ├── social/
│   │   │   ├── follow-button.tsx
│   │   │   ├── user-list.tsx
│   │   │   └── who-to-follow.tsx
│   │   ├── notification/
│   │   │   ├── notification-card.tsx
│   │   │   └── notification-bell.tsx
│   │   ├── search/
│   │   │   ├── search-input.tsx
│   │   │   ├── search-results.tsx
│   │   │   └── search-user-card.tsx
│   │   └── layout/
│   │       ├── sidebar-nav.tsx
│   │       ├── mobile-bottom-nav.tsx
│   │       ├── right-sidebar.tsx
│   │       └── loading-skeletons.tsx
│   ├── server/
│   │   ├── db.ts                 # Prisma client singleton + publicUserSelect/selfUserSelect
│   │   ├── redis.ts              # Redis client singleton with per-feature failure wrappers
│   │   ├── s3.ts                 # S3/MinIO client
│   │   ├── auth.ts               # NextAuth config
│   │   ├── trpc/
│   │   │   ├── index.ts          # tRPC init, context, base procedures
│   │   │   ├── router.ts         # root router (merges all sub-routers)
│   │   │   └── routers/
│   │   │       ├── auth.ts       # register, login, reset-password
│   │   │       ├── user.ts       # profile queries/mutations
│   │   │       ├── tweet.ts      # create, delete, get, replies
│   │   │       ├── feed.ts       # home timeline, user timeline
│   │   │       ├── social.ts     # follow, unfollow, lists, suggestions
│   │   │       ├── engagement.ts # like, retweet, quote-tweet, likers, getUserLikes
│   │   │       ├── notification.ts # list, mark-read, unread-count
│   │   │       ├── search.ts     # tweet search, user search
│   │   │       └── media.ts      # pre-signed URL generation (all uploads)
│   │   └── services/
│   │       ├── notification.ts   # notification creation + self-suppression
│   │       ├── mention.ts        # @mention parsing
│   │       ├── feed.ts           # feed assembly + dedup logic
│   │       ├── email.ts          # email sending abstraction
│   │       ├── sse-publisher.ts  # Redis Pub/Sub event bus with Lua atomic publish+replay (in-memory fallback for tests)
│   │       └── rate-limiter.ts   # Redis rate limiter
│   ├── lib/
│   │   ├── trpc.ts              # tRPC client (React hooks)
│   │   ├── utils.ts             # general utilities (cn, formatDate, etc.)
│   │   ├── validators.ts        # shared Zod schemas
│   │   ├── constants.ts         # magic numbers, limits
│   │   └── logger.ts            # structured JSON logger
│   └── hooks/
│       ├── use-sse.ts            # SSE client hook with auto-reconnect
│       ├── use-debounce.ts       # 300ms debounce for search
│       └── use-infinite-scroll.ts # intersection observer hook
├── openspec/                     # preserved specs (read-only)
│   └── ...
└── tests/
    ├── unit/
    │   ├── mention-parser.test.ts
    │   ├── feed-dedup.test.ts
    │   ├── validators.test.ts
    │   ├── cursor-pagination.test.ts
    │   ├── username-generator.test.ts
    │   ├── notification-suppression.test.ts
    │   ├── media-url-validation.test.ts
    │   └── rate-limiter.test.ts
    ├── integration/
    │   ├── auth.test.ts
    │   ├── tweet.test.ts
    │   ├── social.test.ts
    │   ├── engagement.test.ts
    │   ├── feed.test.ts
    │   ├── search.test.ts
    │   ├── notification.test.ts
    │   ├── media.test.ts
    │   └── helpers.ts
    └── e2e/
        ├── playwright.config.ts
        └── specs/
            ├── auth.spec.ts
            ├── tweet.spec.ts
            ├── feed.spec.ts
            ├── social.spec.ts
            ├── profile.spec.ts
            ├── search.spec.ts
            └── notification.spec.ts
```

---

## 3. Prisma Schema (Reference Artifact)

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["fullTextSearch"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id             String    @id @default(cuid())
  email          String    @unique
  username       String    @unique
  displayName    String
  bio            String    @default("")
  avatarUrl      String    @default("")
  bannerUrl      String    @default("")
  hashedPassword String?   // null for OAuth-only users
  sessionVersion Int       @default(0)  // incremented on password reset / logout-all
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  // Counts (denormalized)
  followerCount  Int       @default(0)
  followingCount Int       @default(0)
  tweetCount     Int       @default(0)

  // Relations
  tweets         Tweet[]   @relation("AuthoredTweets")
  likes          Like[]
  retweets       Retweet[]
  followers      Follow[]  @relation("FollowedBy")  // users who follow this user
  following      Follow[]  @relation("Follows")      // users this user follows
  notifications  Notification[] @relation("Recipient")
  actedNotifications Notification[] @relation("Actor")
  accounts       Account[]
  passwordResetTokens PasswordResetToken[]
}

model Tweet {
  id            String    @id @default(cuid())
  content       String    @db.VarChar(280)
  authorId      String
  parentId      String?   // reply-to
  quoteTweetId  String?   // quote tweet
  mediaUrls     String[]  // array of S3 URLs
  deleted       Boolean   @default(false)
  deletedAt     DateTime?
  createdAt     DateTime  @default(now())

  // Counts (denormalized)
  likeCount     Int       @default(0)
  retweetCount  Int       @default(0)
  replyCount    Int       @default(0)

  // Relations
  author        User      @relation("AuthoredTweets", fields: [authorId], references: [id])
  parent        Tweet?    @relation("Replies", fields: [parentId], references: [id])
  replies       Tweet[]   @relation("Replies")
  quotedTweet   Tweet?    @relation("QuoteTweets", fields: [quoteTweetId], references: [id])
  quotedBy      Tweet[]   @relation("QuoteTweets")
  likes         Like[]
  retweets      Retweet[]
  notifications Notification[]

  @@index([authorId, deleted, createdAt(sort: Desc), id(sort: Desc)])
  @@index([parentId])
}

model Follow {
  followerId  String
  followingId String
  createdAt   DateTime @default(now())

  follower    User     @relation("Follows", fields: [followerId], references: [id])
  following   User     @relation("FollowedBy", fields: [followingId], references: [id])

  @@id([followerId, followingId])
  @@index([followerId])
  @@index([followingId])
}

model Like {
  userId    String
  tweetId   String
  createdAt DateTime @default(now())

  user      User     @relation(fields: [userId], references: [id])
  tweet     Tweet    @relation(fields: [tweetId], references: [id])

  @@id([userId, tweetId])
  @@index([tweetId])
}

model Retweet {
  userId    String
  tweetId   String
  createdAt DateTime @default(now())

  user      User     @relation(fields: [userId], references: [id])
  tweet     Tweet    @relation(fields: [tweetId], references: [id])

  @@id([userId, tweetId])
  @@index([tweetId])
  @@index([userId, createdAt(sort: Desc)])
}

model Notification {
  id          String           @id @default(cuid())
  recipientId String
  type        NotificationType
  actorId     String
  tweetId     String?
  dedupeKey   String?          @unique  // deterministic key to prevent duplicate notifications
  read        Boolean          @default(false)
  createdAt   DateTime         @default(now())

  recipient   User             @relation("Recipient", fields: [recipientId], references: [id])
  actor       User             @relation("Actor", fields: [actorId], references: [id])
  tweet       Tweet?           @relation(fields: [tweetId], references: [id])

  @@index([recipientId, createdAt(sort: Desc)])
  @@index([recipientId, read, createdAt(sort: Desc)])
}

enum NotificationType {
  LIKE
  RETWEET
  FOLLOW
  REPLY
  MENTION
  QUOTE_TWEET
}

model PasswordResetToken {
  id        String   @id @default(cuid())
  tokenHash String   @unique  // SHA-256 hash of the raw token
  userId    String
  expiresAt DateTime
  used      Boolean  @default(false)
  createdAt DateTime @default(now())

  user      User     @relation(fields: [userId], references: [id])

  @@index([tokenHash])
  @@index([userId, expiresAt])
}

// NextAuth OAuth account linking
model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}
```

**Post-migration raw SQL** (run via `prisma migrate` custom SQL):
```sql
-- Add full-text search generated column and GIN index
ALTER TABLE "Tweet" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS "Tweet_search_vector_idx" ON "Tweet" USING GIN ("search_vector");

-- Enable trigram extension for user ILIKE search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram indexes for user search
CREATE INDEX IF NOT EXISTS "User_username_trgm_idx" ON "User" USING GIN (username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "User_displayName_trgm_idx" ON "User" USING GIN ("displayName" gin_trgm_ops);

-- Partial indexes for hot-path queries on live tweets and unread notifications
CREATE INDEX IF NOT EXISTS "Tweet_live_created_idx"
  ON "Tweet" ("createdAt" DESC, "id" DESC) WHERE "deleted" = false;

CREATE INDEX IF NOT EXISTS "Notification_unread_created_idx"
  ON "Notification" ("recipientId", "createdAt" DESC) WHERE "read" = false;

-- Guardrail constraints (see §1.21)
ALTER TABLE "User" ADD CONSTRAINT "User_counts_nonneg"
  CHECK ("followerCount" >= 0 AND "followingCount" >= 0 AND "tweetCount" >= 0);
ALTER TABLE "Tweet" ADD CONSTRAINT "Tweet_counts_nonneg"
  CHECK ("likeCount" >= 0 AND "retweetCount" >= 0 AND "replyCount" >= 0);
ALTER TABLE "Tweet" ADD CONSTRAINT "Tweet_deleted_consistency"
  CHECK (("deleted" = false AND "deletedAt" IS NULL) OR ("deleted" = true AND "deletedAt" IS NOT NULL));
ALTER TABLE "Tweet" ADD CONSTRAINT "Tweet_content_or_media"
  CHECK (char_length(content) > 0 OR cardinality("mediaUrls") > 0);
```

---

## 4. Redis Key Patterns

### Redis Failure Strategy

All Redis operations MUST be wrapped in try/catch. The failure policy varies by feature:

**Fail closed** (reject request on Redis failure):
- **Auth rate limiting:** Allowing auth requests without rate limiting turns a Redis outage into an account-abuse incident.

**Fail open** (degrade gracefully, log warning):
- **Feed cache miss:** Fall through to PostgreSQL query (slower but functional)
- **Read-path rate limiting:** Allow the request; log warning for alerting
- **SSE publisher unavailable:** SSE events are best-effort; client falls back to polling
- **Unread count unavailable:** Query from Notification table (`COUNT(*)` fallback)
- **Session allow-list unavailable:** Fall back to JWT signature + `sessionVersion` DB check only

Implementation: `src/server/redis.ts` exports helper wrappers (`cacheGet`, `cacheSet`, etc.) that catch `ioredis` connection errors and return `null`/no-op instead of throwing. Auth-path wrappers rethrow.

### Key Patterns

| Key Pattern | Type | TTL | Purpose |
|---|---|---|---|
| `session:jti:{jti}` | String (JSON) | 30 days (sliding) | JWT allow-list entry |
| `feed:version:{userId}` | String (integer) | none | Monotonic feed cache-bust version |
| `feed:{userId}:v:{version}:page:{cursorHash}` | String (JSON) | 60s | Cached feed page |
| `feed:{userId}:rebuilding` | String | 5s | SETNX lock to prevent thundering-herd cache rebuild |
| `tombstones:tweets` | Set | 60s | Soft-deleted tweet IDs for in-memory cache filtering |
| `sse:connections:{userId}` | Set | none | Track active SSE connection IDs |
| `sse:seq:{userId}` | String (integer) | none | Monotonic per-user SSE event sequence for `id:` fields |
| `sse:replay:{userId}` | List | 5 min | Short replay buffer for `Last-Event-ID` recovery (`LPUSH` + `LTRIM 0 199`) |
| `rate:{scope}:{identifier}` | Sorted Set | 1-60 min | Sliding window rate limiter |
| `notification:unread:{userId}` | String (integer) | none | Unread notification count (DB fallback on miss) |
| `suggestions:{userId}` | String (JSON) | 5 min | Cached follow suggestions |

---

## 5. tRPC Router Structure

```
appRouter
├── auth
│   ├── register          (mutation, public)
│   ├── login             (mutation, public)
│   ├── requestReset      (mutation, public)
│   ├── completeReset     (mutation, public)
│   └── logoutAll         (mutation, protected)  // increment sessionVersion, clear Redis sessions
├── user
│   ├── getByUsername      (query, public)
│   └── updateProfile      (mutation, protected)
├── tweet
│   ├── create             (mutation, protected)
│   ├── delete             (mutation, protected)
│   ├── getById            (query, public)
│   ├── getReplies         (query, public)
│   ├── getUserTweets      (query, public)
│   └── getUserReplies     (query, public)
├── feed
│   ├── home               (query, protected)
│   └── userTimeline       (query, public)
├── social
│   ├── follow             (mutation, protected)
│   ├── unfollow           (mutation, protected)
│   ├── getFollowers       (query, public)
│   ├── getFollowing       (query, public)
│   └── getSuggestions     (query, protected)
├── engagement
│   ├── like               (mutation, protected)
│   ├── unlike             (mutation, protected)
│   ├── retweet            (mutation, protected)
│   ├── undoRetweet        (mutation, protected)
│   ├── quoteTweet         (mutation, protected)
│   ├── getLikers          (query, public)
│   └── getUserLikes       (query, public)
├── notification
│   ├── list               (query, protected)
│   ├── unreadCount        (query, protected)
│   ├── markRead           (mutation, protected)
│   └── markAllRead        (mutation, protected)
├── search
│   ├── tweets             (query, public)
│   └── users              (query, public)
└── media
    └── getUploadUrl       (mutation, protected)  // all uploads: tweet, avatar, banner
```

---

## 6. Phase Plan

### Phase A: Foundation (Tasks 1.1-1.7, 2.1-2.10)
**Parallelism:** None — everything else depends on this.

#### Files to Create

| File | Purpose |
|---|---|
| `package.json` | Dependencies: next@14, react@18, @trpc/server, @trpc/client, @trpc/react-query, @tanstack/react-query, @prisma/client, prisma, next-auth, @next-auth/prisma-adapter, ioredis, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, bcryptjs, zod, tailwindcss, postcss, autoprefixer, nodemailer, clsx, tailwind-merge, date-fns |
| `tsconfig.json` | Strict mode, paths aliases (`@/*` -> `src/*`) |
| `next.config.ts` | Image domains (S3/MinIO), security headers (see §1.17) |
| `tailwind.config.ts` | Content paths, custom theme (Twitter blue #1DA1F2) |
| `postcss.config.js` | Tailwind + autoprefixer |
| `.env.example` | All env vars documented (see below) |
| `.gitignore` | node_modules, .env.local, .next, coverage (**do not ignore `prisma/migrations`** — they must be committed) |
| `docker-compose.yml` | PostgreSQL (5432), Redis (6379), MinIO (9000/9001) |
| `prisma/schema.prisma` | Full schema as defined in Section 3 |
| `src/env.ts` | Zod-based env validation — import at process start, crash immediately on missing/invalid vars |
| `src/app/error.tsx` | Root error boundary |
| `src/app/not-found.tsx` | Root 404 page |
| `src/server/db.ts` | Prisma client singleton with global dev cache + `publicUserSelect` / `selfUserSelect` (see §1.13) |
| `src/server/redis.ts` | ioredis client singleton with per-feature failure wrappers (see §4) |
| `src/server/s3.ts` | S3Client configured for MinIO in dev, AWS in prod |
| `src/server/auth.ts` | NextAuth config: providers, adapter, callbacks, session strategy |
| `src/server/trpc/index.ts` | createTRPCContext, initTRPC, publicProcedure, protectedProcedure |
| `src/server/trpc/router.ts` | Root appRouter (empty routers initially) |
| `src/app/api/trpc/[trpc]/route.ts` | tRPC HTTP handler |
| `src/app/api/auth/[...nextauth]/route.ts` | NextAuth route handler |
| `src/app/api/health/route.ts` | `GET /api/health` — checks DB, Redis, S3 connectivity. Returns `{ status, db, redis, s3 }` with 200 or 503. |
| `src/lib/trpc.ts` | tRPC React client setup with React Query |
| `src/components/providers.tsx` | Client component wrapping SessionProvider, tRPC QueryClientProvider |
| `src/app/layout.tsx` | Root layout using Providers component |
| `src/app/globals.css` | Tailwind directives |
| `src/app/page.tsx` | Root redirect |
| `src/lib/constants.ts` | MAX_TWEET_LENGTH=280, MAX_DISPLAY_NAME_LENGTH=50, MAX_BIO_LENGTH=160, PAGE_SIZE=20, etc. |
| `src/lib/validators.ts` | Shared Zod schemas for all input validation (see §1.15) |
| `src/lib/logger.ts` | Structured JSON logger with redaction + requestId support (see §1.18) |
| `vitest.config.ts` | Vitest configuration |
| `src/middleware.ts` | Next.js middleware: CSP nonce generation (§1.17), CSRF origin validation (§1.20) |
| `scripts/reconcile-counts.ts` | Operational: recompute denormalized counts from relationship tables (§1.3) |
| `scripts/seed.ts` | Dev seed data: 5 users, 20 tweets, social graph, engagement fixtures. Run via `npx tsx scripts/seed.ts` |

**`.env.example` contents:**
```env
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/twitter_clone?schema=public"

# Redis
REDIS_URL="redis://localhost:6379"

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"

# OAuth
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""

# S3 / MinIO
S3_ENDPOINT="http://localhost:9000"
S3_REGION="us-east-1"
S3_BUCKET="twitter-clone"
S3_ACCESS_KEY="minioadmin"
S3_SECRET_KEY="minioadmin"
S3_PUBLIC_URL="http://localhost:9000/twitter-clone"

# Email (Ethereal for dev)
SMTP_HOST="smtp.ethereal.email"
SMTP_PORT="587"
SMTP_USER=""
SMTP_PASS=""
EMAIL_FROM="noreply@twitterclone.local"

# Security
APP_ORIGIN="http://localhost:3000"
ALLOWED_PREVIEW_ORIGINS=""
```

**Done criteria:**
- `docker compose up` starts PostgreSQL, Redis, MinIO
- `npx prisma migrate dev` creates all tables
- `npm run dev` serves Next.js at localhost:3000
- `GET /api/health` returns `{ status: "ok", db: true, redis: true, s3: true }`
- `publicUserSelect` excludes `email`; `selfUserSelect` includes it only for self-scoped reads
- NextAuth `/api/auth/providers` returns configured providers

---

### Phase B: Authentication (Tasks 3.1-3.10)
**Depends on:** Phase A
**Parallelism:** Backend (B1) and Frontend (B2) can partially overlap.

#### B1: Auth Backend

| File | Purpose |
|---|---|
| `src/server/trpc/routers/auth.ts` | register, requestReset, completeReset, logoutAll mutations |
| `src/server/auth.ts` (update) | CredentialsProvider with bcrypt, Google + GitHub OAuth, callbacks for auto-account creation, session handling |
| `src/server/services/email.ts` | sendPasswordResetEmail using nodemailer |
| `src/server/services/rate-limiter.ts` | Redis sliding-window rate limiter middleware |
| `src/lib/validators.ts` (update) | registerSchema, loginSchema, resetSchema Zod validators |

**Key implementation details:**
- `register` mutation: validate input (see §1.15 validators), check uniqueness, hash password with bcrypt (cost 12), create user, return session
- CredentialsProvider `authorize`: find user by email, compare bcrypt hash, return user or null. On failure (user not found OR password mismatch), return the SAME error: "Invalid email or password". Never reveal whether the email exists. Use timing-safe comparison even when user is not found (compare against a dummy hash to prevent timing side-channel).
- OAuth `signIn` callback: only auto-create an account when the provider supplies a verified email; if no user exists, create one with auto-generated username (CUID-prefix guarantees uniqueness — see §1.6; no P2002 retry needed)
- JWT callback stores `{ sub, jti, sv }` and session validation checks Redis allow-list + `User.sessionVersion` (see §1.10)
- `requestReset`: always return a generic success message regardless of whether the email exists. Invalidate prior active reset tokens for that user. Apply both email- and IP-based rate limits. **Critical:** do NOT await the email send — fire-and-forget with `void sendResetEmail(...)` and enforce a minimum 200ms response delay to prevent timing oracle (see §1.4).
- `completeReset`: validate token hash + expiry + unused status, update password, increment `sessionVersion`, mark token used
- `logoutAll`: increment `sessionVersion` to invalidate all active JWTs
- `protectedProcedure` in tRPC: check `ctx.session`, throw `UNAUTHORIZED` if missing

#### B2: Auth Frontend

| File | Purpose |
|---|---|
| `src/app/(auth)/login/page.tsx` | Login form + OAuth buttons |
| `src/app/(auth)/register/page.tsx` | Registration form |
| `src/app/(auth)/reset-password/page.tsx` | Request reset form |
| `src/app/(auth)/reset-password/[token]/page.tsx` | Complete reset form |
| `src/components/auth/login-form.tsx` | Email/password form with validation |
| `src/components/auth/register-form.tsx` | Registration form with all validations |
| `src/components/auth/oauth-buttons.tsx` | Google + GitHub sign-in buttons |

**Done criteria:**
- User can register with email/password, receive session cookie, see authenticated state
- Duplicate email/username shows correct error messages
- Google and GitHub OAuth create accounts and log in
- Logout destroys session
- Password reset email is sent (visible in Ethereal), link works, all sessions invalidated via `sessionVersion`
- `requestReset` does not reveal whether an email exists (constant-time response, fire-and-forget email)
- Unauthenticated access to protected tRPC routes returns 401
- Login errors return "Invalid email or password" regardless of which field is wrong
- Cookies are `HttpOnly`, `Secure` in production, and `SameSite=Lax`

---

### Phase C: Core Data Layer (Tasks 5.1-5.5, 6.1, 7.1-7.5, 8.1-8.4)
**Depends on:** Phase B (auth middleware)
**Parallelism:**
- **C5 (Notification Service) MUST be built first** — all other sub-phases call `createNotification`.
- **C2 (Media) has no dependency on C5** and can start immediately alongside C5.
- Once C5 is complete: C1 (Tweets), C3 (Social), C4 (Engagement) can run in parallel.

```
Phase C dependency graph:
  C5 (Notifications) ──┐
  C2 (Media) ──────────┤  C2 + C5 start immediately
                        │
                        ├── C1 (Tweets)      ─┐
                        ├── C3 (Social)       ─┤  Start after C5 done
                        └── C4 (Engagement)   ─┘
```

#### C1: Tweet Backend

| File | Purpose |
|---|---|
| `src/server/trpc/routers/tweet.ts` | create, delete, getById, getReplies, getUserTweets, getUserReplies |
| `src/server/services/mention.ts` | parseMentions(text): extracts @usernames, returns user IDs |

**Key details:**
- `create`: validate content length (§1.15), require text or media, parse mentions, create tweet in transaction (increment author's tweetCount), fire mention notifications. If `parentId` is provided, verify parent exists AND `deleted = false`; if deleted, throw `BAD_REQUEST` with "Cannot reply to a deleted tweet". If parent exists, increment parent's `replyCount` in the same transaction.
- `delete`: verify authorId === session.userId (else throw `FORBIDDEN` with "You can only delete your own tweets"), set `deleted=true` and `deletedAt=now()`, decrement `tweetCount`. If the tweet was a reply, also decrement parent's `replyCount`. Add tweet ID to Redis `tombstones:tweets` set (60s TTL) for cache filtering (see §1.9). Publish `tweet_deleted` SSE event to connected followers.
- `getById`: use `publicUserSelect` for author; if deleted return `NOT_FOUND` with "Tweet not found"; if authenticated, include `hasLiked` and `hasRetweeted` via batch check (§1.16)
- `getReplies`: WHERE parentId = tweetId AND deleted = false, paginated
- `getUserTweets`: WHERE authorId = userId AND deleted = false AND parentId IS NULL, paginated
- `getUserReplies`: WHERE authorId = userId AND deleted = false AND parentId IS NOT NULL, paginated

#### C2: Media Backend

| File | Purpose |
|---|---|
| `src/server/trpc/routers/media.ts` | getUploadUrl mutation (all upload types) |

**Key details:**
- Input: `{ filename: string, contentType: string, purpose: 'tweet' | 'avatar' | 'banner' }`
- Validate contentType against allowed MIME types (image/jpeg, image/png, image/gif, image/webp)
- Validate file size: max 5MB per image
- Generate S3 key: `{purpose}/{userId}/{cuid()}.{ext}`
- Return `{ uploadUrl: presignedPutUrl, publicUrl: finalUrl }`
- Pre-signed URL expires in 10 minutes
- **URL validation on tweet create:** verify mediaUrls match the expected S3 bucket origin (e.g., `https://{BUCKET}.s3.{REGION}.amazonaws.com/` or `http://localhost:9000/{BUCKET}/`) and path prefix matches `tweet/{userId}/`. Reject any URL pointing to external domains.

#### C3: Social Graph Backend

| File | Purpose |
|---|---|
| `src/server/trpc/routers/social.ts` | follow, unfollow, getFollowers, getFollowing, getSuggestions |

**Key details:**
- `follow`: check self-follow (throw `BAD_REQUEST` with "Cannot follow yourself"), upsert Follow record, increment counts in transaction, fire follow notification
- `unfollow`: delete Follow record if exists, decrement counts in transaction. Unfollow non-followed user: idempotent success.
- `getSuggestions`: raw SQL query — find users followed by people the current user follows, exclude already-followed, group by suggested user, order by count of mutual connections, limit 10. Cache result in Redis with key `suggestions:{userId}`, TTL 5 minutes. Invalidate on follow/unfollow.

#### C4: Engagement Backend

| File | Purpose |
|---|---|
| `src/server/trpc/routers/engagement.ts` | like, unlike, retweet, undoRetweet, quoteTweet, getLikers, getUserLikes |

**Key details:**
- `like`: insert Like (skip if already exists). If a row was inserted, use Prisma `update` with `{ likeCount: { increment: 1 } }` atomically in the same transaction. Fire like notification with deterministic `dedupeKey` (`like:{actorId}:{tweetId}`).
- `unlike`: delete Like if exists. If a row was deleted, use `{ likeCount: { decrement: 1 } }` atomically.
- `retweet`: check self-retweet (throw `BAD_REQUEST` with "Cannot retweet your own tweet"). Insert Retweet (skip if exists). If inserted, `{ retweetCount: { increment: 1 } }` atomically. Fire notification with `dedupeKey` (`retweet:{actorId}:{tweetId}`). Bump `feed:version` for the retweeter's followers.
- `quoteTweet`: create Tweet with quoteTweetId, fire `QUOTE_TWEET` notification to quoted author
- `getLikers`: join Like with User (using `publicUserSelect`), paginated
- `getUserLikes`: join Like with Tweet WHERE userId = targetUserId, paginated by Like.createdAt DESC. Powers the "Likes" profile tab.

#### C5: Notification Service

| File | Purpose |
|---|---|
| `src/server/services/notification.ts` | createNotification function with self-suppression check |
| `src/server/trpc/routers/notification.ts` | list, unreadCount, markRead, markAllRead |

**Key details:**
- `createNotification({ recipientId, actorId, type, tweetId?, dedupeKey? })`: if `recipientId === actorId`, return early (self-suppression). Otherwise, if `dedupeKey` is provided, attempt insert with unique constraint — skip silently on duplicate (prevents notification spam from retries). Increment Redis `notification:unread:{userId}` count, publish SSE event best-effort after commit.
- `list`: WHERE recipientId = userId, include actor (using `publicUserSelect`) and tweet (content preview), paginated
- `markAllRead`: UPDATE Notification SET read=true WHERE recipientId=userId AND read=false
- If Redis unread-cache operations fail, fall back to DB `COUNT(*) WHERE read = false` rather than returning stale or negative counts

**Done criteria for Phase C:**
- All tRPC endpoints respond correctly
- Tweet CRUD works with proper validation errors
- Reply-to-deleted-tweet returns "Cannot reply to a deleted tweet"
- Follow/unfollow correctly updates counts
- Like/retweet idempotency works
- Self-retweet blocked, self-follow blocked
- Notifications created for all event types (LIKE, RETWEET, FOLLOW, REPLY, MENTION, QUOTE_TWEET)
- Self-notifications suppressed
- Mention parser extracts @usernames correctly
- No query ever returns `hashedPassword` or `email` via public endpoints

---

### Phase D: Feed Assembly + Search (Tasks 9.1-9.4, 12.1-12.2)
**Depends on:** Phase C (tweets, social graph, engagement must exist)
**Parallelism:** D1 (Feed) and D2 (Search) can run in parallel.

#### D1: Feed Backend

| File | Purpose |
|---|---|
| `src/server/trpc/routers/feed.ts` | home, userTimeline queries |
| `src/server/services/feed.ts` | assembleFeed, deduplicateFeed, cacheGet/cacheSet |

**Home timeline algorithm:** Uses the UNION query from §1.9, then:
1. Hydrate tweet + author data for the resulting IDs (single batched query with `publicUserSelect`)
2. Batch-check hasLiked/hasRetweeted (§1.16)
3. Cache assembled page in Redis with TTL 60s

#### D2: Search Backend

| File | Purpose |
|---|---|
| `src/server/trpc/routers/search.ts` | tweets, users queries |

**Key details:**
- Both endpoints use the standard pagination shape from §1.2: `{ query, cursor?, limit? } -> { items, nextCursor }` (see §1.22)
- Reject empty/whitespace-only queries with `BAD_REQUEST`; enforce minimum normalized query length of 2
- **Input sanitization:** Strip `%` and `_` wildcard characters from user search input, cap query string at 50 characters to prevent pg_trgm CPU exhaustion from adversarial patterns
- Tweet search (parameterized, with cursor):
  ```sql
  SELECT t.*, ts_rank(t.search_vector, query) AS rank
  FROM "Tweet" t, plainto_tsquery('english', $1) query
  WHERE t.search_vector @@ query
    AND t.deleted = false
    AND (
      $2::numeric IS NULL OR
      ts_rank(t.search_vector, query) < $2::numeric OR
      (ts_rank(t.search_vector, query) = $2::numeric AND (
        t."createdAt" < $3::timestamptz OR
        (t."createdAt" = $3::timestamptz AND t.id < $4::text)
      ))
    )
  ORDER BY rank DESC, t."createdAt" DESC, t.id DESC
  LIMIT $5;
  ```
- User search (parameterized — NEVER interpolate user input):
  ```sql
  SELECT id, username, "displayName", "avatarUrl", bio, "followerCount"
  FROM "User"
  WHERE (
        username ILIKE '%' || $1 || '%'
        OR "displayName" ILIKE '%' || $1 || '%'
      )
    AND (
      $2::int IS NULL OR
      "followerCount" < $2::int OR
      ("followerCount" = $2::int AND id < $3::text)
    )
  ORDER BY "followerCount" DESC, id DESC
  LIMIT $4;
  ```
  Use `prisma.$queryRaw` with `Prisma.sql` tagged template for safe parameterization. The `pg_trgm` GIN indexes (see §3 post-migration SQL) ensure this does not full-table-scan.

**Done criteria:**
- Home feed returns tweets from followed users only
- Feed deduplication works (same tweet via author + retweeter shows once)
- Cursor pagination works correctly
- Tweet search returns relevant results with stemming and stable cursor pagination
- User search returns by substring match ordered by popularity with stable cursor pagination
- Search queries are fully parameterized (no SQL injection)
- Search input is sanitized (wildcards stripped, length capped)
- Feed still works when Redis cache is unavailable (degraded performance, not failure)
- Deleted tweets are filtered from cached feeds via tombstone set

---

### Phase E: Real-Time SSE (Tasks 10.1-10.6)
**Depends on:** Phase C (notification service), Phase D (feed)
**Parallelism:** Can run in parallel with Phase F (Frontend).

| File | Purpose |
|---|---|
| `src/app/api/sse/route.ts` | GET handler: auth check, hold connection, stream events |
| `src/server/services/sse-publisher.ts` | Redis Pub/Sub publisher with Lua atomic publish+replay; in-memory fallback for tests |
| `src/hooks/use-sse.ts` | Client hook: connect to /api/sse, parse events, auto-reconnect with exponential backoff |
| `scripts/sse-lua/publish.lua` | Redis Lua script: atomic PUBLISH + LPUSH replay buffer + LTRIM + EXPIRE |

**Key details:**
- SSE route: `export async function GET(req) { ... }` using `ReadableStream` and `TransformStream`
- Event format: `id: {seq}\nevent: {type}\ndata: {json}\n\n`
- Event types: `new-tweet` (payload: `{ tweetId, authorUsername }`), `notification` (payload: `{ notification }`), `tweet_deleted` (payload: `{ tweetId }`)
- Publisher: uses a unified Redis Lua script to atomically `PUBLISH` to Pub/Sub AND `LPUSH` to `sse:replay:{userId}` (with `LTRIM 0 199` and `EXPIRE 300`) to prevent lost events on crash. When a tweet is created, find all follower IDs, publish `new-tweet` to each. When a notification is created, publish `notification` to recipient. When a tweet is deleted, publish `tweet_deleted` to connected followers.
- Sequence numbers: obtain per-user monotonic IDs via Redis `INCR sse:seq:{userId}`; include the integer in the SSE `id:` field.
- Client hook returns `{ newTweetCount, latestNotification, resetTweetCount }`.
- Client `use-sse.ts` listens for `tweet_deleted` events and removes the tweet from local React Query caches via `setQueryData`.
- **Protocol:** Include `retry: 5000` directive, monotonic `id:` fields per user stream, and heartbeat comments (`: heartbeat\n\n`) every 30 seconds. If write fails (broken pipe), clean up subscriber immediately.
- **Connection draining:** On `SIGTERM`, send `event: server_restart` to all active SSE streams, then close server-side. Clients jitter-reconnect.
- **Fallback:** `use-sse.ts` should detect connection failures and fall back to polling `notification.unreadCount` every 30 seconds after 3 consecutive reconnect failures.

**Done criteria:**
- SSE connection established on page load for authenticated users
- New tweet by followed user triggers `new-tweet` event on client
- New notification triggers `notification` event on client
- Deleted tweet triggers `tweet_deleted` event and is removed from client feed
- Connection auto-reconnects after drop
- Reconnect with `Last-Event-ID` does not lose recent events
- Replay buffer is bounded (max 200 events per user key)
- Heartbeat keeps connection alive
- Client falls back to polling if SSE remains unavailable

---

### Phase F: Frontend — Core UI (Tasks 5.6-5.8, 4.5-4.6, 9.5-9.6, 13.1-13.4)
**Depends on:** Phase B (auth UI), Phase C (all backend APIs), Phase D (feed/search APIs)
**Parallelism:** All sub-phases (F1-F6) can run in parallel.

#### F1: Layout Shell

| File | Purpose |
|---|---|
| `src/app/(main)/layout.tsx` | Three-column layout: left nav, center content, right sidebar |
| `src/components/layout/sidebar-nav.tsx` | Home, Search, Notifications, Profile links; compose button |
| `src/components/layout/mobile-bottom-nav.tsx` | Bottom tab bar for mobile |
| `src/components/layout/right-sidebar.tsx` | Search bar, trending (placeholder), who-to-follow |
| `src/components/layout/loading-skeletons.tsx` | Skeleton components for tweets, profiles, lists |
| `src/components/ui/*.tsx` | All UI primitives (button, input, modal, avatar, skeleton, tabs, dropdown, infinite-scroll) |

#### F2: Tweet Components

| File | Purpose |
|---|---|
| `src/components/tweet/tweet-card.tsx` | Full tweet card: avatar, author, content, media grid, engagement bar, timestamp |
| `src/components/tweet/tweet-composer.tsx` | Textarea with char counter, media upload button, submit |
| `src/components/tweet/tweet-thread.tsx` | Threaded reply view with connecting lines |
| `src/components/tweet/quote-tweet-embed.tsx` | Embedded quoted tweet card |
| `src/components/tweet/engagement-buttons.tsx` | Like (heart), retweet, reply, share buttons with counts |
| `src/components/media/image-grid.tsx` | 1/2/3/4 image responsive grid |
| `src/components/media/image-lightbox.tsx` | Full-screen image viewer |
| `src/components/media/image-upload.tsx` | File picker, preview, upload progress |

#### F3: Feed Pages

| File | Purpose |
|---|---|
| `src/app/(main)/home/page.tsx` | Home feed with composer at top, infinite scroll |
| `src/components/feed/feed-list.tsx` | Renders list of tweet cards with infinite scroll |
| `src/components/feed/new-tweets-indicator.tsx` | "N new tweets" banner using SSE hook |
| `src/components/feed/empty-feed.tsx` | Empty state with follow suggestions |
| `src/hooks/use-infinite-scroll.ts` | IntersectionObserver hook for pagination trigger |

#### F4: Profile Pages

| File | Purpose |
|---|---|
| `src/app/(main)/[username]/page.tsx` | Profile page: header + tabbed timelines |
| `src/app/(main)/[username]/followers/page.tsx` | Followers list |
| `src/app/(main)/[username]/following/page.tsx` | Following list |
| `src/components/profile/profile-header.tsx` | Banner, avatar, name, bio, stats, follow/edit button |
| `src/components/profile/profile-tabs.tsx` | Tweets / Replies / Likes tabs |
| `src/components/profile/edit-profile-modal.tsx` | Modal form for displayName, bio, avatar, banner |

#### F5: Social Components

| File | Purpose |
|---|---|
| `src/components/social/follow-button.tsx` | Follow/Following toggle with optimistic update |
| `src/components/social/user-list.tsx` | Reusable user list for followers/following/likers |
| `src/components/social/who-to-follow.tsx` | Suggestion cards with follow buttons |

#### F6: Tweet Detail Page

| File | Purpose |
|---|---|
| `src/app/(main)/[username]/status/[tweetId]/page.tsx` | Single tweet view with reply thread below |

**Done criteria:**
- App shell renders with responsive layout (3-col desktop, single-col mobile)
- Tweet composer creates tweets with character counter turning red at limit
- Tweet cards display correctly with all engagement buttons
- Home feed shows tweets from followed users with infinite scroll
- "N new tweets" indicator appears for new SSE events
- Profile pages show header, stats, and tabbed timelines (Tweets / Replies / Likes)
- Edit profile modal updates displayName and bio
- Follow/unfollow buttons work with optimistic UI
- Image grid renders correctly for 1-4 images
- Image lightbox opens on click

---

### Phase G: Frontend — Notifications, Search, Media Polish (Tasks 11.5-11.6, 12.3-12.4, 6.2-6.4)
**Depends on:** Phase E (SSE), Phase F (base UI components)
**Parallelism:** G1, G2, G3 can run in parallel.

#### G1: Notifications UI

| File | Purpose |
|---|---|
| `src/app/(main)/notifications/page.tsx` | Notification list page |
| `src/components/notification/notification-card.tsx` | Individual notification (icon by type including QUOTE_TWEET, actor info, tweet preview) |
| `src/components/notification/notification-bell.tsx` | Bell icon with unread count badge, uses SSE hook |

#### G2: Search UI

| File | Purpose |
|---|---|
| `src/app/(main)/search/page.tsx` | Search page with input, tabs (Tweets/People), results |
| `src/components/search/search-input.tsx` | Search input with debounce |
| `src/components/search/search-results.tsx` | Tab-switched result lists |
| `src/components/search/search-user-card.tsx` | User result card with follow button |
| `src/hooks/use-debounce.ts` | 300ms debounce hook |

#### G3: Media Upload Polish

Complete the upload flow in tweet composer and edit profile modal:
- File selection with drag-and-drop
- Client-side validation (format, size, count: max 4 images, max 5MB each, JPEG/PNG/GIF/WebP)
- Client-side resize for avatars (400x400) and banners (1500x500) using canvas
- Upload progress indicator
- Preview before tweet submission

**Done criteria:**
- Notification page shows all notification types with correct icons and text
- Bell icon shows unread count that updates in real-time via SSE
- Mark as read works (single and bulk)
- Search returns results with 300ms debounce
- Tab switching between Tweets and People works
- Media upload flow is end-to-end functional

---

### Phase H: Testing (Tasks 14.1-14.5)
**Depends on:** All previous phases
**Parallelism:** H1, H2, H3 can run in parallel.

#### H1: Unit Tests

| File | Purpose |
|---|---|
| `tests/unit/mention-parser.test.ts` | @mention extraction edge cases |
| `tests/unit/feed-dedup.test.ts` | Deduplication logic |
| `tests/unit/validators.test.ts` | Zod schema validation (all schemas from §1.15) |
| `tests/unit/cursor-pagination.test.ts` | Compound cursor encode/decode, edge cases (ties, empty pages) |
| `tests/unit/username-generator.test.ts` | OAuth username derivation: sanitization, truncation, CUID prefix uniqueness |
| `tests/unit/notification-suppression.test.ts` | Self-notification suppression for all event types |
| `tests/unit/media-url-validation.test.ts` | S3 URL origin validation, path prefix enforcement |

#### H2: Integration Tests

| File | Purpose |
|---|---|
| `tests/integration/auth.test.ts` | Register, login, logout, password reset flows |
| `tests/integration/tweet.test.ts` | Create, delete, reply, mention, reply-to-deleted flows |
| `tests/integration/social.test.ts` | Follow, unfollow, suggestions |
| `tests/integration/engagement.test.ts` | Like, retweet, quote tweet, getUserLikes |
| `tests/integration/feed.test.ts` | Home timeline assembly, dedup, cache behavior, empty feed |
| `tests/integration/search.test.ts` | FTS ranking, ILIKE user search, empty results, special chars |
| `tests/integration/notification.test.ts` | All notification types, self-suppression, mark-read, unread count |
| `tests/integration/media.test.ts` | Pre-signed URL generation, URL validation on tweet create |
| `tests/integration/rate-limit.test.ts` | Per-IP/per-user limits, Redis-failure closed/open behavior |
| `tests/integration/helpers.ts` | Test utilities: create test user, create test tweet, etc. |

#### H3: E2E Tests

| File | Purpose |
|---|---|
| `playwright.config.ts` | Playwright config targeting localhost:3000 |
| `docker-compose.test.yml` | Ephemeral test containers for E2E (PostgreSQL, Redis, MinIO) |
| `tests/e2e/specs/auth.spec.ts` | Registration, login, logout, password reset E2E |
| `tests/e2e/specs/tweet.spec.ts` | Tweet creation, deletion, reply thread E2E |
| `tests/e2e/specs/feed.spec.ts` | Home feed pagination, new-tweets indicator, empty state |
| `tests/e2e/specs/social.spec.ts` | Follow/unfollow, follower/following lists, who-to-follow |
| `tests/e2e/specs/profile.spec.ts` | View profile, edit profile, avatar upload |
| `tests/e2e/specs/search.spec.ts` | Tweet search, user search, tab switching, debounce |
| `tests/e2e/specs/notification.spec.ts` | Notification list, bell badge, mark-read |

**Test infrastructure:**
- Integration tests use a separate `twitter_clone_test` database (env var `DATABASE_URL_TEST`)
- Each integration test file uses a `beforeEach`/`afterEach` cleanup helper to reset state
- E2E tests use `docker compose -f docker-compose.test.yml` with ephemeral containers
- External services mocked in unit tests: S3 (mock `getSignedUrl`), email (mock transport), Redis (ioredis-mock)

**Done criteria:**
- All unit tests pass
- Integration tests cover all critical flows
- E2E tests pass in headless Chromium
- No TypeScript errors (`tsc --noEmit` passes)
- Line coverage ≥ 80% for `src/server/` (services, routers, auth)
- Rate limiter integration tests use per-test Redis key prefix to avoid cross-test pollution
- Integration tests assert structured log output for: auth failures (WARN), rate limit hits (WARN), Redis errors (WARN)
- Test database (`twitter_clone_test`) is isolated; each test file resets state via `beforeEach` cleanup

---

## 7. Risks & Mitigations

### Risk 1: NextAuth + Custom Credentials Complexity
NextAuth is designed primarily for OAuth and fights you on custom credential flows (no database sessions with credentials by default).
**Mitigation:** Use JWT strategy with a Redis-backed session invalidation layer. If this proves too complex, fall back to a fully custom auth implementation using bcrypt + iron-session, keeping the same API surface.

### Risk 2: Feed Query Performance
Fan-out-on-read means the home timeline query joins Follow + Tweet for every request. For users following 1000+ people, this is slow.
**Mitigation:** Redis caching with 60s TTL. Cache invalidation on new tweet/follow. For v1 with limited scale, this is acceptable. The architecture supports migration to fan-out-on-write (Redis sorted sets per user) later.

### Risk 3: SSE Connection Limits in Serverless
If deployed on Vercel, serverless functions have execution time limits. SSE requires long-lived connections.
**Mitigation:** Production deployment should use a Node.js server (Docker) rather than serverless. The `use-sse.ts` hook detects connection failures and falls back to polling the `notification.unreadCount` endpoint every 30 seconds after 3 consecutive reconnect failures.

### Risk 4: Prisma Full-Text Search Limitations
Prisma does not natively support PostgreSQL `tsvector` columns. The search query must use `$queryRaw`.
**Mitigation:** Encapsulate all FTS queries in `src/server/trpc/routers/search.ts` using `prisma.$queryRaw` with `Prisma.sql` tagged templates (parameterized — no SQL injection). The generated column approach means no Prisma schema changes needed — it is invisible to Prisma.

### Risk 5: OAuth Username Generation Collisions
Auto-generating usernames from OAuth display names can create awkward or duplicate names.
**Mitigation:** Append the first 6 characters of the user's pre-generated CUID to guarantee mathematical uniqueness on the first insert (see §1.6). Zero retries, zero exception handling. Usernames like `johndoe_abc123` are acceptable for v1.

### Risk 6: Image Upload Reliability
Direct client-to-S3 upload can fail silently, leaving orphaned URLs in tweets.
**Mitigation:** The tweet creation mutation verifies that all mediaUrls match the expected S3 bucket origin and path prefix `tweet/{userId}/`. Reject any URL pointing to external domains. Pre-signed URLs expire in 10 minutes, so stale URLs cannot be reused. **v2 upgrade path:** All four independent review rounds recommend a `MediaUpload` intent table (server-side upload manifest with `PENDING → UPLOADED → ATTACHED` lifecycle and orphan GC). This is deferred for v1 due to complexity (new model, 2 endpoints, GC job), but is the correct long-term solution.

### Risk 7: Redis Downtime Cascading to App Outage
Redis is used for caching, rate limiting, SSE, session invalidation, and unread counts. A Redis outage would break all of these simultaneously.
**Mitigation:** Per-feature fallback policy (see §4 Redis Failure Strategy): auth rate limiting fails closed (rejects requests), all other features fail open (degrade to DB queries, skip caching, fall back to polling). Log Redis errors at WARN level for alerting.

### Risk 8: Denormalized Count Drift
Engagement and follower counts can drift from source-of-truth tables due to partial transaction failures, concurrent race conditions, or manual database fixes.
**Mitigation:** `scripts/reconcile-counts.ts` recomputes all counts from relationship tables. Run weekly via cron or on-demand when discrepancies are reported. Counts are display-only — business logic never depends on their exact values.

### Risk 9: SSE Connection Leak Under Load
Each SSE connection holds a Redis Pub/Sub subscriber. If connections are not properly cleaned up (browser closes without sending close event), subscribers accumulate.
**Mitigation:** Implement heartbeat ping every 30 seconds. If the write fails (broken pipe), unsubscribe and clean up immediately. Cap concurrent connections per user (max 5 per userId) and log warnings when the global connection count approaches configured limits. Bound replay storage with `LTRIM` and a max 200-event per-user buffer. Implement connection draining on `SIGTERM` to prevent deployment hangs.

### Risk 10: SMTP Timing Oracle on Password Reset
If `requestReset` awaits email delivery, network latency to the SMTP server (500ms–3s) reveals whether the email exists, bypassing the generic success message.
**Mitigation:** Fire-and-forget email sends (`void sendResetEmail(...)`) plus a fixed 200ms minimum response delay to flatten any residual timing signal. No infrastructure change needed — just don't `await` the SMTP call in the request handler.

---

## 8. Security Model

### Threat Matrix

| Threat | Vector | Mitigation | Reference |
|--------|--------|------------|-----------|
| Account enumeration | Login/reset response timing or content | Generic errors; constant-time reset (200ms floor) | §1.4, §1.14 |
| Credential stuffing | Automated login attempts | Dual-key rate limiting (IP + email); fail-closed on Redis outage | §1.7 |
| Session hijacking | Stolen JWT | HttpOnly + Secure + SameSite=Lax; Redis jti allow-list; sessionVersion | §1.10 |
| XSS | User-generated content injection | CSP with per-request nonce; React default escaping; nosniff | §1.17 |
| CSRF | Forged cookie-authenticated mutations | Origin header validation on POST to /api/ | §1.20 |
| SQL injection | Raw FTS/search queries | `Prisma.sql` tagged templates; no string interpolation | §1.11, Phase D2 |
| SSRF via media URLs | Attacker-controlled mediaUrls | Validate URL origin against S3 bucket + path prefix | Phase C2 |
| Data leakage | API returns hashedPassword/email | `publicUserSelect` / `selfUserSelect` on all queries | §1.13 |
| Timing side-channel | Reset endpoint reveals email existence | Fire-and-forget email; 200ms response floor | §1.4 |
| Token brute-force | Password reset token guessing | SHA-256 hash; 32-byte random; 1h expiry; one active per user | §1.4 |

### Secrets Handling

- All secrets live in `.env.local` (git-ignored). `.env.example` documents every variable with placeholders.
- `NEXTAUTH_SECRET`: generate with `openssl rand -base64 32`. Rotation invalidates all active JWTs (new signature key).
- `S3_SECRET_KEY`: scoped to `twitter-clone` bucket only. MinIO dev uses default `minioadmin/minioadmin`.
- Database credentials: dedicated PostgreSQL role with CRUD-only privileges (no DDL in production).
- `src/env.ts` validates all required env vars at process start — crash immediately on missing values, never at first use.
- bcrypt cost factor 12 targets ≈250ms per hash on commodity hardware — high enough to resist offline brute-force, low enough to not block auth endpoints.

---

## 9. Performance Targets & Observability

### Latency Targets

| Endpoint | p50 | p99 | Bottleneck |
|----------|-----|-----|------------|
| `feed.home` (cache hit) | <50ms | <150ms | Redis GET + deserialize |
| `feed.home` (cache miss) | <200ms | <500ms | UNION query + hydrate + engagement batch |
| `tweet.create` | <100ms | <300ms | Prisma transaction + async notification fan-out |
| `tweet.getById` | <30ms | <100ms | Single-row lookup + author join |
| `search.tweets` | <150ms | <400ms | GIN index FTS |
| `search.users` | <100ms | <300ms | pg_trgm GIN index |
| `auth.register` | <400ms | <800ms | bcrypt(12) ≈ 250ms |
| SSE first event | <2s | <5s | Redis SUBSCRIBE + auth |
| Page load (LCP) | <1.5s | <3s | Next.js RSC streaming |

These are development-environment baselines. If any endpoint consistently exceeds its p99, investigate before shipping.

### Key Metrics

Every tRPC response logs `{ requestId, route, userId, latencyMs, statusCode }`. Additional signals:

| Metric | Log field | Alert threshold |
|--------|-----------|-----------------|
| Feed cache hit rate | `cacheHit: boolean` on `feed.home` | Hit rate < 70% over 5 min |
| Redis errors | `redisError` at WARN | Any occurrence |
| Rate limit hits | `rateLimited: true` at WARN | > 100/min (possible attack) |
| SSE active connections | `sseConnections` on heartbeat | > 1000 (capacity planning) |
| Auth failures | `authFailure` at WARN | > 50/min per IP |
| Slow queries | `latencyMs > 500` at WARN | Any occurrence |

### Health Check Contract

`GET /api/health` returns `{ status, db, redis, s3, uptime }`:
- **200** if `db: true` (PostgreSQL is the only hard dependency)
- **503** if `db: false`
- `redis: false` or `s3: false` → `status: "degraded"` (app functions with fallbacks)

---

## 10. Error Handling Philosophy

**Every failure surfaces as a structured `TRPCError` to the client or a WARN/ERROR log with `requestId`. No silent swallows. No empty catch blocks. No `|| undefined` fallbacks masking broken queries.**

### Per-Subsystem Behavior

| Subsystem | On failure | Action |
|-----------|-----------|--------|
| PostgreSQL | Connection lost | Prisma throws → `INTERNAL_SERVER_ERROR`; log ERROR. No app-level retry (Prisma pool reconnects). |
| Redis (auth rate-limit) | Connection lost | **Reject request** (fail closed). Log ERROR. |
| Redis (cache/SSE/unread) | Connection lost | **Degrade** (fail open). Cache miss → DB. SSE → poll. Unread → `COUNT(*)`. Log WARN. |
| S3 | Pre-sign failure | `INTERNAL_SERVER_ERROR` — "Upload temporarily unavailable". Log ERROR. |
| Email (SMTP) | Send failure | Log ERROR. Do not block or retry — user can re-request reset. |
| SSE publish | Pub/Sub failure | Log WARN. Notification persisted in DB — visible on next load. |

### Retry Policy

No application-level retries in v1. Prisma manages its own connection pool internally. Redis operations are idempotent — missed writes self-heal on next request. Email is fire-and-forget by design. S3 pre-signing is a local crypto operation (retry won't fix configuration errors).

---

## 11. Deployment & Rollout

### Migration Strategy

1. `npx prisma migrate dev --name init` generates the initial migration from §3 schema.
2. Append post-migration raw SQL (FTS column, GIN indexes, CHECK constraints, pg_trgm) to the generated migration file before committing.
3. All subsequent schema changes: `npx prisma migrate dev --name <name>`. Never `db push`.
4. Migration files are committed to git. `.gitignore` must NOT ignore `prisma/migrations/`.

### Feature Flags

None. Greenfield — all features ship together. Incomplete features stay on branches.

### Backwards Compatibility

N/A. No existing users, API consumers, or data to migrate.

### Production Target

Docker container on a long-lived Node.js server (not serverless — SSE needs persistent connections). Multi-stage Dockerfile (`node:22-alpine`). Docker Compose for all services with named volumes.

### Demo Data

`scripts/seed.ts` creates development fixtures via `npx tsx scripts/seed.ts`: 5 users with known credentials (`user1@test.com` / `password123`, etc.), 20 tweets with replies and quote tweets, follow graph, likes and retweets.

---

## Appendix: Parallelism Summary

```
Phase A (Foundation)
    │
    v
Phase B (Auth)
    │
    v
Phase C5 (Notifications) ──┐
Phase C2 (Media) ───────────┤  Start immediately
                            │
                            v
Phase C1 (Tweets) ──────┐
Phase C3 (Social) ───────┤  Start after C5 done
Phase C4 (Engagement) ──┘
    │
    v
Phase D1 (Feed) ────────┐  Run in parallel
Phase D2 (Search) ──────┘
    │
    v
Phase E (SSE) ──────────┐
Phase F (Core UI) ──────┘  Run in parallel
    │
    v
Phase G (Notifications UI, Search UI, Media Polish)  — all sub-phases parallel
    │
    v
Phase H (Testing)  — all sub-phases parallel
```

**Maximum parallelism:** 3 concurrent workstreams in Phase C (after C5 completes).

**Critical path:** A → B → C5 → C1 → D → F → G → H
