# CLAUDE.md

## Project Overview

**Twitter Clone** — Full-stack social media application built with Next.js 14 (App Router),
tRPC, Prisma, PostgreSQL, Redis, and S3/MinIO. Clean-room implementation from OpenSpec
artifacts in `openspec/`.

## Task Tracking

All task tracking uses **beads** (`br`/`bv`, SQLite-backed, `.beads/`).
Beads is the single source of truth. The implementation plan lives at `plans/twitter-clone.md`.

```bash
br ready --json                                    # actionable work (no blockers)
bv --robot-triage | jq '.triage.quick_ref'         # ranked recommendations
br show <ID>                                       # full task details
br update <ID> --status=in_progress                # claim
br close <ID> --reason "Implemented"               # complete
br sync --flush-only                               # export to JSONL (no git ops)
git add .beads/ && git commit -m "chore(beads): close <ID>"
```

## Stack

- **Framework:** Next.js 14 (App Router, React Server Components + Client Components)
- **API:** tRPC (end-to-end type safety, co-located in Next.js API routes)
- **Database:** PostgreSQL (relational data, full-text search via tsvector)
- **ORM:** Prisma (schema, migrations, TypeScript query types)
- **Cache/Sessions:** Redis (ioredis — feed caching, session store, rate limiting)
- **Auth:** NextAuth.js (Auth.js) — email/password + Google/GitHub OAuth
- **Real-time:** Server-Sent Events (SSE) — single multiplexed connection per user
- **Media:** AWS S3 / MinIO (pre-signed URLs for direct client upload)
- **Styling:** Tailwind CSS
- **Validation:** Zod (all input schemas, shared client/server)
- **Testing:** Vitest (unit/integration), Playwright (E2E)
- **Lint/Format:** Biome
- **Package manager:** npm
- **Runtime:** Node 22+

## Repository Structure

```text
src/
  app/                         ← Next.js App Router pages
    (auth)/                    ← Login, register, password reset
    (main)/                    ← App shell with sidebar nav
      home/                    ← Home feed
      search/                  ← Search with tabs (tweets/people)
      notifications/           ← Notification list
      [username]/              ← User profile + followers/following
        status/[tweetId]/      ← Tweet detail with thread
      compose/tweet/           ← Mobile compose
    api/
      trpc/[trpc]/route.ts     ← tRPC HTTP handler
      auth/[...nextauth]/route.ts ← NextAuth handler
      sse/route.ts             ← SSE endpoint
  components/
    ui/                        ← Generic primitives (button, input, modal, etc.)
    auth/                      ← Login/register forms, OAuth buttons
    tweet/                     ← Tweet card, composer, thread, engagement
    media/                     ← Image grid, lightbox, upload
    profile/                   ← Profile header, tabs, edit modal
    feed/                      ← Feed list, new tweets indicator, empty state
    social/                    ← Follow button, user list, who-to-follow
    notification/              ← Notification card, bell icon
    search/                    ← Search input, results, user card
    layout/                    ← Sidebar nav, mobile nav, right sidebar, skeletons
  server/
    db.ts                      ← Prisma client singleton
    redis.ts                   ← Redis client singleton
    s3.ts                      ← S3/MinIO client
    auth.ts                    ← NextAuth config
    trpc/
      index.ts                 ← tRPC init, context, publicProcedure, protectedProcedure
      router.ts                ← Root appRouter (merges sub-routers)
      routers/
        auth.ts                ← register, requestReset, completeReset
        user.ts                ← getByUsername, updateProfile, getUploadUrl
        tweet.ts               ← create, delete, getById, getReplies, getUserTweets
        feed.ts                ← home timeline, user timeline
        social.ts              ← follow, unfollow, getFollowers, getFollowing, getSuggestions
        engagement.ts          ← like, unlike, retweet, undoRetweet, quoteTweet, getLikers
        notification.ts        ← list, unreadCount, markRead, markAllRead
        search.ts              ← tweets (FTS), users (ILIKE)
        media.ts               ← getUploadUrl (pre-signed S3 URL)
    services/
      notification.ts          ← createNotification + self-suppression
      mention.ts               ← @mention parsing from tweet content
      feed.ts                  ← feed assembly, deduplication, Redis caching
      email.ts                 ← email sending (nodemailer, Ethereal for dev)
      sse-publisher.ts         ← SSE event bus (EventEmitter, swappable to Redis Pub/Sub)
      rate-limiter.ts          ← Redis sliding-window rate limiter
  lib/
    trpc.ts                    ← tRPC React client setup
    utils.ts                   ← cn(), formatDate, etc.
    validators.ts              ← Shared Zod schemas (all input validation)
    constants.ts               ← MAX_TWEET_LENGTH=280, PAGE_SIZE=20, etc.
  hooks/
    use-sse.ts                 ← SSE client hook with auto-reconnect
    use-debounce.ts            ← 300ms debounce for search
    use-infinite-scroll.ts     ← IntersectionObserver hook
prisma/
  schema.prisma                ← Authoritative data model
tests/
  unit/                        ← mention-parser, feed-dedup, validators
  integration/                 ← auth, tweet, social, engagement flows
  e2e/                         ← Playwright specs
openspec/                      ← Specs (read-only reference)
scripts/
  verify.sh                    ← Slot-aware cached verify pipeline
.claude/
  bootstrap.sh                 ← Deterministic pre-flight for workers (outputs JSON)
  agent-panes.json             ← Static pane→agent name mapping (0–30)
PROMPT_build.md                ← Agent loop: implement one beads task
PROMPT_plan.md                 ← Agent loop: beads hygiene & consolidation
BEADS.md                       ← br/bv/agent-mail reference
```

## Key Commands

```bash
npm run dev                             # Next.js dev server at localhost:3000
npm run build                           # Next.js production build
npm run lint                            # Biome lint/format
npx tsc --noEmit                        # Type check
npm test                                # Vitest run
npx prisma migrate dev                  # Apply migrations
npx prisma generate                     # Regenerate Prisma client
npx prisma studio                       # Visual database browser
docker compose up -d                    # Start PostgreSQL, Redis, MinIO
```

## Verify

Run the slot-aware cached verify wrapper before closing any bead:

```bash
bash scripts/verify.sh "$AGENT_NAME"    # preferred — cached + serialized
```

The wrapper runs `prisma generate → next build → tsc → test → lint` with
content-addressed caching (skips if source files unchanged) and flock-based
serialization (prevents concurrent builds from colliding). Or run individually:

```bash
npx prisma generate                     # regenerate client after schema changes
npm run build                           # Next.js build (catches SSR/RSC errors)
npx tsc --noEmit                        # type-check
npm test                                # all tests pass
npm run lint                            # biome lint/format
```

## Specs Reference

All feature specs live in `openspec/specs/`. Read the relevant spec before implementing:

| Capability | Spec | Key Details |
|-----------|------|-------------|
| User Auth | `openspec/specs/user-auth/spec.md` | Registration, login, OAuth, sessions, password reset |
| User Profiles | `openspec/specs/user-profiles/spec.md` | Profile CRUD, avatar/banner upload |
| Tweet Management | `openspec/specs/tweet-management/spec.md` | Create, delete, replies, mentions |
| Engagement | `openspec/specs/engagement/spec.md` | Like, retweet, quote tweet |
| Social Graph | `openspec/specs/social-graph/spec.md` | Follow/unfollow, suggestions |
| Feed Assembly | `openspec/specs/feed-assembly/spec.md` | Home timeline, dedup, caching |
| Notifications | `openspec/specs/notifications/spec.md` | All notification types, self-suppression |
| Search | `openspec/specs/search/spec.md` | Tweet FTS, user search, debounce |
| Media Upload | `openspec/specs/media-upload/spec.md` | Pre-signed URLs, image grid |

The design document (`openspec/design.md`) is authoritative for architecture decisions.

## Design Decisions

- **IDs:** CUID via `@default(cuid())` — URL-safe, roughly time-ordered.
- **Pagination:** Cursor-based everywhere. `{ cursor?: string; limit?: number }` in, `{ items: T[]; nextCursor: string | null }` out. Default limit 20.
- **Engagement counts:** Denormalized columns on Tweet (`likeCount`, `retweetCount`, `replyCount`) and User (`followerCount`, `followingCount`, `tweetCount`). Updated in same Prisma transaction as relationship.
- **Soft deletes:** Tweets use `deleted: boolean`, never hard-deleted.
- **Feed:** Fan-out on read. Redis caching (60s TTL). Deduplication of retweeted content.
- **SSE:** Single multiplexed connection via `/api/sse`. EventEmitter in-process for v1.
- **Auth sessions:** JWT strategy with Redis-backed invalidation via `jti` claim.
- **Media uploads:** Pre-signed S3 PUT URLs. Client uploads directly. No server proxy.
- **Full-text search:** PostgreSQL `tsvector` generated column with GIN index. Raw SQL via `prisma.$queryRaw`.
- **No edit in v1.** No DMs, video, ML ranking, content moderation.

## MCP Tools

Before **any** `WebFetch` or `WebSearch`:

```text
manage_resource(action='list', query='<relevant-keyword>')
```

If indexed: use `search`, `nia_grep`, `nia_read`, `nia_explore`.
If not indexed: `index` the source, then search.
For library API docs: `mcp__context7__resolve-library-id` → `mcp__context7__query-docs`.

## Multi-Agent Coordination

This project uses a **Coordinator-Worker** pattern:

- **Coordinator** (wezterm pane 0 = `OliveChapel`): reads beads, plans work, reviews
  results. Does NOT implement directly.
- **Workers** (`loop-ui build` in wezterm panes 1–30): headless Claude Code sessions
  running `PROMPT_build.md`. Each worker picks one bead, implements it, commits,
  closes the bead, and exits.

Infrastructure:

- **Beads** (`br`/`bv`): SQLite-backed issue tracking in `.beads/`. See `BEADS.md`.
- **Agent Mail** (`am` CLI): messaging and file reservations between agents.
- **Bootstrap** (`.claude/bootstrap.sh`): deterministic pre-flight script that handles
  pane identity, agent registration, git sync, triage, and ready list. Outputs
  structured JSON — no inference needed.
- **Pane registry** (`.claude/agent-panes.json`): static mapping of wezterm pane
  numbers (0–30) to durable agent names (e.g., pane 4 = `TopazWaterfall`).

**project_key:** `/home/gulp/projects/enterprise-vibecoding/twitter-clone-openspec`
**project_slug:** `home-gulp-projects-enterprise-vibecoding-twitter-clone-openspec`

### Before editing files

```bash
am file_reservations reserve home-gulp-projects-enterprise-vibecoding-twitter-clone-openspec "$AGENT_NAME" "src/server/trpc/routers/**" --reason "<BEAD_ID>"
```

### After completing a task

```bash
br close <ID> --reason "All acceptance criteria verified."
br sync --flush-only
git add .beads/
git commit -m "chore(beads): close <ID> — <title>"
git push
am file_reservations release home-gulp-projects-enterprise-vibecoding-twitter-clone-openspec "$AGENT_NAME"
```

## Commit Convention

```text
feat({scope}): {summary}        # new functionality
fix({scope}): {summary}         # bug fix
test({scope}): {summary}        # tests
chore({scope}): {summary}       # tooling, CI, beads
docs({section}): {summary}      # documentation
```

Scopes: `auth`, `user`, `tweet`, `feed`, `social`, `engagement`, `notification`,
`search`, `media`, `sse`, `ui`, `layout`, `prisma`, `infra`, `verify`

Commit immediately after creating or modifying artifacts. Push with `git push`.

## Agent Rules (non-negotiable)

1. **IMPLEMENT.** Write real TypeScript/React code. No stubs, no placeholders.
2. **Read the spec first** — check `openspec/specs/<capability>/spec.md` before implementing.
3. **Search before coding** — confirm a feature is not already implemented before starting.
4. **Never `git add -A`** — stage specific files by name only.
5. **Before `git rm` / `git mv`:** run `git stash list 2>/dev/null | head -3`.
6. **Before `git add <dir>`:** run `git ls-files <dir>` to verify tracked state.
7. **When a file appears modified unexpectedly:** run `git log --oneline -3` to detect
   concurrent agent commits before retrying write operations.
8. **NEVER delete files without user approval.** Use `git rm` so history is preserved.
9. **After Prisma schema changes:** always run `npx prisma generate` before building/testing.
10. **Never `npx prisma db push`** — use `npx prisma migrate dev` for schema changes.
11. **Never expose `hashedPassword`** in any API response or client-side code.
12. **Diagnostics, not silent failures.** Missing data, broken queries, validation errors
    → return clear error messages as specified in the openspec.
13. `<agent-instructions>` tags in the conversation override all rules above.
