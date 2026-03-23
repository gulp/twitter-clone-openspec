# CLAUDE.md

## Code Principles

- **KISS**: prefer the simplest correct implementation.
- **YAGNI**: solve only the requested problem; no speculative abstractions or future-proofing.
- **DRY**: reuse existing patterns and utilities; remove real duplication but don't over-abstract.
- **POLA**: avoid surprising behavior, hidden side effects, and misleading names.
- Match the repo's existing conventions unless there is a strong reason not to.
- Prefer editing existing code over building parallel systems.
- Avoid unnecessary dependencies, broad rewrites, and unrelated cleanup.
- Never claim success without validation.

## Project Overview

**Twitter Clone** — Full-stack social media application built with Next.js 14 (App Router),
tRPC, Prisma, PostgreSQL, Redis, and S3/MinIO.

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
specs/                         ← Cross-cutting architecture docs (by theme prefix)
scripts/
  verify.sh                    ← Slot-aware cached verify pipeline
.claude/
  bootstrap.sh                 ← Deterministic pre-flight for workers (outputs JSON)
  agent-panes.json             ← Static pane→agent name mapping (0–30)
PROMPT_build.md                ← Agent loop: implement one beads task
PROMPT_plan.md                 ← Agent loop: beads hygiene & consolidation
PROMPT_specs.md                ← Agent loop: write specs/ docs from src/
PROMPT_hunt.md                 ← Agent loop: deep code review, find bugs
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

## Search & Debug Tools

**Code search** — use the right tool for the job:

- **`mcp__morph-mcp__codebase_search`** — natural-language semantic search across the
  whole repo. Best for broad questions ("how does feed caching work", "trace the auth
  flow"). Much faster than iterative grep for exploration.
- **`Grep` tool** — regex/literal pattern search. Best for exact matches (function names,
  error codes, import paths).
- **`ast-grep`** (via Bash) — AST-aware structural search. Finds code patterns regardless
  of formatting or variable names:
  ```bash
  ast-grep run -p 'prisma.$transaction($$$)' -l typescript src/   # all transactions
  ast-grep run -p 'throw new TRPCError($$$)' -l typescript src/   # all error throws
  ast-grep run -p 'try { $$$ } catch ($$$) {}' -l typescript src/ # empty catch blocks
  ast-grep run -p 'useState($$$)' -l tsx src/components/          # all useState calls
  ```

**Browser verification** — `agent-browser` is a headless browser CLI for verifying UI:
```bash
agent-browser open http://localhost:3000/home   # navigate
agent-browser snapshot -i                        # list interactive elements
agent-browser screenshot --full                  # full page screenshot
agent-browser click @ref                         # click element by ref
agent-browser fill @ref "text"                   # fill input field
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

Cross-cutting architecture documentation lives in `specs/`, organized by theme prefix.
See `specs/INDEX.md` for a full listing. Key themes:

| Prefix | Theme | Key Details |
|--------|-------|-------------|
| `error-handling-` | Error patterns | TRPCError codes, fail-open/closed, P2002/P2025 race handling |
| `security-` | Security | CSRF, rate limiting, auth sessions, input validation |
| `caching-` | Caching | Redis versioning, feed TTL, tombstone filtering |
| `pagination-` | Pagination | Cursor encoding, keyset patterns, feed cursor |
| `sse-` | Real-time | SSE publisher, replay buffer, client reconnect |
| `optimistic-` | Optimistic UI | Mutation callbacks, rollback, cache invalidation |
| `testing-` | Testing | Integration helpers, E2E fixtures, vitest config |
| `logging-` | Observability | Structured JSON, request correlation, redaction |

The master plan (`plans/twitter-clone.md`) is authoritative for architecture decisions.

## Design Decisions

- **IDs:** CUID via `@default(cuid())` — URL-safe, roughly time-ordered.
- **Usernames:** Case-insensitive matching (Twitter-style). Display case is preserved in the database, but all username lookups (profile access, @mentions, registration uniqueness checks) use Prisma `mode: 'insensitive'`. Example: user registers as "AliceUser", can be mentioned with @aliceuser, @ALICEUSER, or @AliceUser.
- **Pagination:** Cursor-based everywhere. `{ cursor?: string; limit?: number }` in, `{ items: T[]; nextCursor: string | null }` out. Default limit 20.
- **Engagement counts:** Denormalized columns on Tweet (`likeCount`, `retweetCount`, `replyCount`) and User (`followerCount`, `followingCount`, `tweetCount`). Updated in same Prisma transaction as relationship.
- **Soft deletes:** Tweets use `deleted: boolean`, never hard-deleted.
- **Feed:** Fan-out on read. Redis caching (60s TTL). Deduplication of retweeted content.
- **SSE:** Single multiplexed connection via `/api/sse`. EventEmitter in-process for v1.
- **Auth sessions:** JWT strategy with Redis-backed invalidation via `jti` claim.
- **Media uploads:** Pre-signed S3 PUT URLs. Client uploads directly. No server proxy.
- **Full-text search:** PostgreSQL `tsvector` generated column with GIN index. Raw SQL via `prisma.$queryRaw`.
- **Skeleton loaders:** Use `<Skeleton />` component (src/components/ui/skeleton.tsx) for all loading states. Shimmer effect (default) provides visual consistency. Never use inline `animate-pulse` or hardcoded background colors.
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
2. **Read the spec first** — check `specs/` and `plans/twitter-clone.md` before implementing.
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
    → return clear error messages as specified in the specs.
13. `<agent-instructions>` tags in the conversation override all rules above.

## Spec Map — `plans/twitter-clone.md`

The godfile is `plans/twitter-clone.md` (~1650 lines). Use `mq` for discovery
and `sed -n` for content extraction. **Never read the whole file.**

### mq Quick Reference

```bash
# List all sections (deterministic TOC)
mq '.h2' plans/twitter-clone.md

# List all subsections
mq '.h3' plans/twitter-clone.md

# Find a specific section heading
mq 'select(.h3) | select(contains("1.9"))' plans/twitter-clone.md

# Find phase headings
mq 'select(.h3) | select(contains("Phase"))' plans/twitter-clone.md

# Extract all SQL blocks
mq 'select(.code.lang == "sql")' plans/twitter-clone.md

# Extract all TypeScript blocks
mq 'select(.code.lang == "typescript")' plans/twitter-clone.md

# Extract Prisma schema
mq 'select(.code.lang == "prisma")' plans/twitter-clone.md

# Search table cells
mq '.[][] | select(contains("KEYWORD"))' plans/twitter-clone.md

# Search invariants table
mq '.[][] | select(contains("I5"))' plans/twitter-clone.md

# Hierarchical TOC
mq 'include "section" | nodes | sections() | toc()' plans/twitter-clone.md
```

### Section Index (line ranges for `sed -n 'START,ENDp'`)

```text
PREAMBLE & GOALS
  Project Identity / Goals / Non-Goals .............. 8–58

ARCHITECTURE
  Architecture Overview (diagram, flows, invariants)  61–150
  §1  Architecture Decisions (§1.1–§1.22) .......... 153–450
      §1.1  IDs: cuid() ............................ 157–158
      §1.2  Cursor Pagination ...................... 160–187
      §1.3  Engagement Counts ...................... 189–192
      §1.4  Password Reset Tokens .................. 194–201
      §1.5  Email Sending .......................... 203–204
      §1.6  OAuth Username Generation .............. 206–211
      §1.7  Rate Limiting .......................... 213–223
      §1.8  SSE Implementation ..................... 225–238
      §1.9  Feed Assembly Strategy ................. 240–286
      §1.10 NextAuth Session Strategy .............. 288–300
      §1.11 Full-Text Search Setup ................. 302–303
      §1.13 User Select Pattern .................... 308–323
      §1.14 Standard Error Format .................. 325–344
      §1.15 Shared Zod Validators .................. 346–356
      §1.16 Batch Engagement State Check ........... 358–365
      §1.17 Security Headers ....................... 367–384
      §1.18 Logging ................................ 386–417
      §1.19 Request ID Propagation ................. 419–421
      §1.20 CSRF / Origin Validation ............... 423–425
      §1.21 Database CHECK Constraints ............. 427–442
      §1.22 Search Pagination ...................... 444–450

SCHEMA & INFRASTRUCTURE
  §2  Directory Structure .......................... 453–626
  §3  Prisma Schema + Post-Migration SQL ........... 628–842
  §4  Redis Key Patterns + Failure Strategy ........ 844–878
  §5  tRPC Router Structure ........................ 880–929

PHASE PLAN
  §6  Phase Plan (all phases) ...................... 931–1459
      Phase A: Foundation .......................... 933–1020
      Phase B: Authentication ...................... 1022–1069
      Phase C: Core Data Layer ..................... 1071–1168
        C1 Tweet Backend ........................... 1089–1102
        C2 Media Backend ........................... 1104–1117
        C3 Social Graph Backend .................... 1119–1128
        C4 Engagement Backend ...................... 1130–1142
        C5 Notification Service .................... 1144–1168
      Phase D: Feed + Search ....................... 1170–1242
      Phase E: Real-Time SSE ....................... 1244–1278
      Phase F: Frontend Core UI .................... 1280–1355
      Phase G: Frontend Polish ..................... 1357–1396
      Phase H: Testing ............................. 1398–1459

REFERENCE
  §7  Risks & Mitigations (Risks 1–10) ............. 1461–1503
  §8  Security Model (threat matrix, secrets) ...... 1505–1531
  §9  Performance Targets & Observability .......... 1533–1570
  §10 Error Handling Philosophy .................... 1573–1592
  §11 Deployment & Rollout ......................... 1594–1619
  Appendix: Parallelism Summary .................... 1621–1650
```

### Common Agent Workflows

```bash
# "What schema does User look like?"
sed -n '628,842p' plans/twitter-clone.md | grep -A 30 'model User'

# "What does Phase C depend on?"
sed -n '1071,1075p' plans/twitter-clone.md

# "How does feed caching work?"
sed -n '240,286p' plans/twitter-clone.md

# "What are the system invariants?"
sed -n '134,150p' plans/twitter-clone.md

# "What Redis keys exist?"
sed -n '862,878p' plans/twitter-clone.md

# "What are the performance targets?"
sed -n '1535,1549p' plans/twitter-clone.md

# "What error handling policy applies to Redis?"
sed -n '846,860p' plans/twitter-clone.md

# "What files does Phase E create?"
sed -n '1244,1260p' plans/twitter-clone.md

# "What's the security threat model?"
sed -n '1507,1520p' plans/twitter-clone.md
```

## mq Reference (what works, what to avoid)

`mq` is a jq-like CLI for markdown files. Version 0.5.16.

### Selectors (all work)

```bash
.h              # all headings (any level)
.h1  .h2  .h3   # headings at specific depth
.h.depth        # heading depth as integer (1, 2, 3…)
.code           # all code blocks (fenced)
.code.lang      # code block language string
.code.value     # code block raw content
.link.url       # all link URLs
.[]             # list items (ordered + unordered)
.[][]           # table cells (all rows)
.[0][]          # first table row (header row)
.[1][]          # second table row
```

### Filters (all work)

```bash
select(contains("keyword"))          # keep nodes containing text
select(!.code)                       # exclude code blocks
select(.code.lang == "sql")          # code blocks by language
select(.code.lang != "js")           # exclude language
select(.h.depth == 2)                # heading at exact level
.h | select(contains("Phase"))       # headings matching text
.[][] | select(contains("Redis"))    # table cells matching text
```

### Transforms (all work)

```bash
to_text(self)                        # strip markdown, plain text
replace("old", "new")               # string replacement
upcase / downcase                    # case transform
add("suffix")                        # append text to each node
split("delimiter")                   # split node text
identity()                           # passthrough (useful for -S)
```

### Section module (use with caution)

```bash
# WORKS on any file size:
include "section" | nodes | sections() | toc()      # hierarchical TOC
include "section" | nodes | sections() | titles()   # flat section names

# BROKEN on files >~200 lines (recursion depth 192):
include "section" | nodes | section("Name")          # ← AVOID
include "section" | nodes | split(2) | collect()     # ← AVOID
```

### Output formats

```bash
mq -F json '.h2' file.md            # JSON AST output
mq -F text '.h2' file.md            # plain text
mq -F html '.h2' file.md            # HTML
mq -F markdown '.h2' file.md        # default
```

### Aggregation

```bash
mq -A 'pluck(.h2)' file.md          # collect across multiple nodes
mq -A 'pluck(.code.value)' file.md  # all code block contents
```

### Functions that DO NOT exist

```bash
length    count    first    last    nth()
h()       heading  section()  # (bare, without module)
builtins  def      type
```

### Patterns for this project

```bash
# Discovery: what sections exist?
mq '.h2' plans/twitter-clone.md

# Discovery: find a subsection
mq 'select(.h3) | select(contains("1.9"))' plans/twitter-clone.md

# Extraction: use sed after mq locates the section
#   mq tells you WHAT exists; sed -n gives you the CONTENT
sed -n '240,286p' plans/twitter-clone.md    # §1.9 Feed Assembly

# Get all SQL in the plan
mq 'select(.code.lang == "sql")' plans/twitter-clone.md

# Search tables for a term
mq '.[][] | select(contains("bcrypt"))' plans/twitter-clone.md

# Strip to plain text for grep
mq -F text '.' plans/twitter-clone.md | grep -i "invariant"
```
