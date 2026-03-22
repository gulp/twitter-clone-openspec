# Twitter Clone

Full-stack social media application built with Next.js 14, tRPC, Prisma, PostgreSQL, Redis, and S3/MinIO.

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router, RSC + Client Components) |
| API | tRPC (end-to-end type safety) |
| Database | PostgreSQL (relational data, full-text search via tsvector) |
| ORM | Prisma (schema, migrations, typed queries) |
| Cache | Redis (feed caching, session store, rate limiting) |
| Auth | NextAuth.js (email/password + Google/GitHub OAuth) |
| Real-time | Server-Sent Events (single multiplexed connection per user) |
| Media | S3 / MinIO (pre-signed URLs, direct client upload) |
| Styling | Tailwind CSS (dark-mode first, CSS custom properties) |
| Validation | Zod (shared client/server schemas) |
| Testing | Vitest (unit/integration), Playwright (E2E) |
| Lint/Format | Biome |

## Quick Start

```bash
# Prerequisites: Node 22+, Docker

# Start infrastructure (PostgreSQL, Redis, MinIO)
docker compose up -d

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your values (defaults work for local dev)

# Run database migrations
npx prisma migrate dev

# Seed development data (optional)
npx tsx scripts/seed.ts

# Start dev server
npm run dev
# Open http://localhost:3000
```

## Commands

```bash
npm run dev              # Next.js dev server (localhost:3000)
npm run build            # Production build
npm run start            # Start production server
npm run lint             # Biome lint/format check
npm run lint:fix         # Auto-fix lint issues
npm test                 # Run all tests (Vitest)
npm run test:watch       # Watch mode
npm run test:e2e         # Playwright E2E tests
npm run typecheck        # TypeScript type check (tsc --noEmit)
npx prisma migrate dev   # Apply database migrations
npx prisma generate      # Regenerate Prisma client
npx prisma studio        # Visual database browser
```

### Verification Pipeline

The `scripts/verify.sh` wrapper runs the full verification pipeline with
content-addressed caching and flock-based serialization:

```bash
bash scripts/verify.sh              # prisma generate -> build -> tsc -> test -> lint
bash scripts/verify.sh --status     # Show cache stats and slot state
```

Exit codes: `0` pass, `10` prisma, `11` build, `12` tsc, `13` test, `14` lint.

### Operational Scripts

```bash
npx tsx scripts/seed.ts              # Seed deterministic fixture data
npx tsx scripts/reconcile-counts.ts  # Repair denormalized engagement counts
npx tsx scripts/perf-smoke.ts        # Performance smoke test
```

## Project Structure

```
src/
  app/                          Next.js App Router pages
    (auth)/                     Login, register, password reset
    (main)/                     App shell with sidebar nav
      home/                     Home feed
      search/                   Search with tabs (tweets/people)
      notifications/            Notification list
      [username]/               User profile + followers/following
        status/[tweetId]/       Tweet detail with thread
      compose/tweet/            Mobile compose
    api/
      trpc/[trpc]/route.ts      tRPC HTTP handler
      auth/[...nextauth]/       NextAuth handler
      sse/route.ts              SSE endpoint
      health/route.ts           Health check
  components/
    ui/                         Primitives (button, input, modal, tabs, avatar, skeleton)
    auth/                       Login/register forms, OAuth buttons
    tweet/                      Tweet card, composer, thread, engagement buttons
    media/                      Image grid, lightbox, drag-drop upload with resize
    profile/                    Profile header, tabs, edit modal
    feed/                       Feed list, new tweets indicator, empty state
    social/                     Follow button, user list, who-to-follow widget
    notification/               Notification card, bell icon with unread badge
    search/                     Search input, results, user card
    layout/                     Sidebar nav, mobile nav, right sidebar
  server/
    db.ts                       Prisma client singleton + query logging
    redis.ts                    Redis client + fail-open/closed wrappers
    s3.ts                       S3/MinIO client + pre-signed URL generation
    auth.ts                     NextAuth config (JWT + Redis session allow-list)
    trpc/
      index.ts                  tRPC init, context, publicProcedure, protectedProcedure
      router.ts                 Root appRouter (merges sub-routers)
      routers/
        auth.ts                 register, requestReset, completeReset, logoutAll
        user.ts                 getByUsername, updateProfile
        tweet.ts                create, delete, getById, getReplies, getUserTweets, getUserReplies
        feed.ts                 home, userTimeline
        social.ts               follow, unfollow, getFollowers, getFollowing, getSuggestions
        engagement.ts           like, unlike, retweet, undoRetweet, quoteTweet, getLikers, getUserLikes
        notification.ts         list, unreadCount, markRead, markAllRead
        search.ts               tweets (FTS), users (ILIKE)
        media.ts                getUploadUrl (pre-signed S3 URL)
    services/
      notification.ts           createNotification + self-suppression + deduplication
      mention.ts                @mention parsing from tweet content
      feed.ts                   Feed assembly, dedup, Redis caching, tombstone filtering
      email.ts                  Nodemailer (Ethereal for dev)
      sse-publisher.ts          SSE event bus (Redis Pub/Sub + Lua atomicity)
      rate-limiter.ts           Redis sliding-window rate limiter
  lib/
    trpc.ts                     tRPC React client setup
    utils.ts                    cn(), formatDate, generateUsername
    validators.ts               Shared Zod schemas (all input validation)
    constants.ts                MAX_TWEET_LENGTH, PAGE_SIZE, ALLOWED_MIME_TYPES
    logger.ts                   Structured JSON logger with redaction
    image-utils.ts              Canvas resize for avatars/banners
  hooks/
    use-sse.ts                  SSE client with auto-reconnect + polling fallback
    use-debounce.ts             300ms debounce for search
    use-infinite-scroll.ts      IntersectionObserver hook
prisma/
  schema.prisma                 Data model (User, Tweet, Follow, Like, Retweet, Notification)
tests/
  unit/                         Pure logic tests (validators, parsers, dedup)
  integration/                  Database + Redis tests (auth, tweet, feed, social, engagement)
  e2e/                          Playwright specs (auth, tweet, feed, social, profile, search, media)
scripts/
  verify.sh                    Cached slot-aware verify pipeline
  seed.ts                      Deterministic fixture data
  reconcile-counts.ts          Repair denormalized counts
  perf-smoke.ts                Performance smoke test
  sse-lua/                     Lua scripts for atomic Redis SSE operations
specs/                          Cross-cutting architecture documentation
docs/
  ERROR_HANDLING.md             Error handling policies
  FAILURE_MODES.md              Failure mode analysis
```

## Architecture

### Data Model

8 core models with denormalized engagement counts:

- **User** — id (cuid), email, username, displayName, bio, avatar/banner URLs, follower/following/tweet counts, sessionVersion
- **Tweet** — id (cuid), content (280 chars), authorId, parentId (reply), quoteTweetId, mediaUrls, soft delete (deleted + deletedAt), like/retweet/reply counts
- **Follow** — composite key (followerId, followingId)
- **Like** — composite key (userId, tweetId)
- **Retweet** — composite key (userId, tweetId)
- **Notification** — recipientId, actorId, type enum (LIKE/RETWEET/FOLLOW/REPLY/MENTION/QUOTE_TWEET), dedupeKey for deduplication, read status

### Key Design Decisions

- **IDs**: CUID via `@default(cuid())` — URL-safe, roughly time-ordered
- **Pagination**: Cursor-based everywhere. `{ cursor?, limit? }` in, `{ items, nextCursor }` out. Default limit 20
- **Engagement counts**: Denormalized columns updated atomically in the same Prisma transaction as the relationship
- **Soft deletes**: Tweets use `deleted: boolean`, never hard-deleted. Content redacted in notification responses
- **Feed**: Fan-out-on-read with Redis caching (60s TTL), version-based invalidation, SETNX lock, tombstone filtering, DISTINCT ON deduplication
- **SSE**: Single multiplexed connection via `/api/sse`. Redis Pub/Sub with atomic Lua publish script. Auto-reconnect with exponential backoff, polling fallback after 3 failures
- **Auth sessions**: JWT strategy with Redis-backed allow-list via `jti` claim. Session invalidation via `sessionVersion` increment
- **Rate limiting**: Redis sliding-window via atomic Lua script. Auth endpoints fail-closed (5/min per IP). General API fails-open (100/min per user)
- **Media**: Pre-signed S3 PUT URLs. Client uploads directly. Client-side resize for avatars (400x400) and banners (1500x500)
- **Full-text search**: PostgreSQL `tsvector` generated column with GIN index. Raw SQL via `prisma.$queryRaw`
- **Error handling**: Fail-closed for security (rate limiting, CSRF). Fail-open for performance (cache, SSE, unread counts). All errors logged with requestId correlation

### Real-time Events

The SSE endpoint (`/api/sse`) streams three event types:

| Event | Trigger | Client Action |
|-------|---------|---------------|
| `new-tweet` | Followed user posts | Increment new-tweets indicator |
| `notification` | Like, follow, mention, reply, retweet, quote | Invalidate notification queries, update bell badge |
| `tweet_deleted` | Author deletes tweet | Remove from feed and tweet caches |

Events include sequence numbers for Last-Event-ID replay on reconnect. A 200-entry replay buffer (5-minute TTL) is maintained in Redis.

## Testing

```bash
npm test                              # All unit + integration tests
npm test -- tests/unit/               # Unit tests only
npm test -- tests/integration/        # Integration tests (requires PostgreSQL + Redis)
npm run test:e2e                      # Playwright E2E tests (requires running app)
```

### Test Infrastructure

- **Unit tests** (12 files, 154 tests): Pure logic — validators, mention parsing, feed dedup, cursor encoding, notification suppression, rate limiter, logger
- **Integration tests** (13 files): Real database — auth flow, tweet CRUD, engagement, social graph, feed assembly, notifications, search FTS, schema invariants, security
- **E2E tests** (8 specs): Playwright — auth journeys, tweet compose/reply/delete, feed infinite scroll, follow/unfollow, profile editing, search, notifications, media upload

Integration tests use `tests/integration/helpers.ts` which provides `createTestUser()`, `createTestTweet()`, `createTestContext()`, and `cleanupDatabase()`.

E2E tests use page objects (`tests/e2e/page-objects/`) for DRY selectors and `tests/e2e/fixtures.ts` for seeded test data.

### Vitest Configuration

Tests run with limited parallelism to prevent OOM in multi-agent environments:

- Thread pool: 1-2 threads
- Sequential file execution (`fileParallelism: false`)
- 15s test timeout, 10s hook timeout

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `NEXTAUTH_SECRET` | Yes | NextAuth JWT signing secret |
| `NEXTAUTH_URL` | Yes | Application URL (e.g., `http://localhost:3000`) |
| `APP_ORIGIN` | Yes | Origin for CSRF validation |
| `S3_ENDPOINT` | Yes | S3/MinIO endpoint |
| `S3_ACCESS_KEY` | Yes | S3 access key |
| `S3_SECRET_KEY` | Yes | S3 secret key |
| `S3_BUCKET` | Yes | S3 bucket name |
| `S3_PUBLIC_URL` | Yes | Public URL for uploaded files |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |
| `GITHUB_CLIENT_ID` | No | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | No | GitHub OAuth client secret |
| `SMTP_HOST` | No | SMTP server (defaults to Ethereal for dev) |

## Documentation

| Document | Description |
|----------|-------------|
| `specs/INDEX.md` | Cross-cutting architecture specs organized by theme |
| `docs/ERROR_HANDLING.md` | Error handling policies and failure modes |
| `docs/FAILURE_MODES.md` | Detailed failure scenarios with test references |
| `plans/twitter-clone.md` | Master implementation plan (~1650 lines) |
| `CLAUDE.md` | Agent instructions and project conventions |

## License

Private repository.
