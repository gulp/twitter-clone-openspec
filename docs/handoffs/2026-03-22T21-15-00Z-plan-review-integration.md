# HANDOFF SUMMARY

## 1) Mission State

- **Current objective:** Produce a single, cohesive, contradiction-free implementation plan for the Twitter Clone project at `plans/twitter-clone.md`, integrating the best ideas from competing model reviews.
- **Current status:** Complete. The plan has been through three passes: (1) initial review of `IMPLEMENTATION_PLAN.md` producing detailed feedback, (2) integration of that feedback into `plans/twitter-clone.md`, (3) synthesis of two competing external reviews (`plans/reviews/P1.gemini.md` and `plans/reviews/P1.gpt54.md`) into a final cohesive revision.
- **Definition of done:** `plans/twitter-clone.md` is internally consistent, addresses all high-severity findings from all three review sources, and is ready for beads task decomposition.
- **Immediate next best action:** Decompose `plans/twitter-clone.md` into beads tasks for parallel agent implementation. The plan is ready; no further revision is needed unless new specs are added.

## 2) Stable Context (carry forward)

- **Project:** Twitter Clone — full-stack Next.js 14 + tRPC + Prisma + PostgreSQL + Redis + S3/MinIO
- **Working directory:** `/home/gulp/projects/enterprise-vibecoding/twitter-clone-openspec`
- **Plan location:** `plans/twitter-clone.md` (~1270 lines)
- **Original plan:** `IMPLEMENTATION_PLAN.md` (reference artifact only, per CLAUDE.md)
- **Competing reviews:** `plans/reviews/P1.gemini.md` (Gemini), `plans/reviews/P1.gpt54.md` (GPT-5.4)
- **Specs:** `openspec/specs/*/spec.md` (9 specs: engagement, feed-assembly, media-upload, notifications, search, social-graph, tweet-management, user-auth, user-profiles)
- **Design doc:** `openspec/design.md` — authoritative for architecture decisions
- **Task tracking:** Beads (`br`/`bv`), SQLite-backed in `.beads/`
- **Agent coordination:** Coordinator-Worker pattern via wezterm panes 0-30, agent-mail for file reservations
- **Key constraints from CLAUDE.md:** Never `git add -A`, never expose `hashedPassword`, never `prisma db push`, read spec before implementing, no stubs/placeholders

## 3) Progress So Far (what happened)

1. **Read full `IMPLEMENTATION_PLAN.md`** (939 lines) and all 9 openspec specs via Explore agent.
   - Result: Complete understanding of original plan gaps vs spec requirements.

2. **Produced initial review** with 31 proposed changes across 8 categories.
   - Categories: Architecture (5), Missing Features (4), Reliability (3), Security (5), Performance (3), Clarity (4), Testing (4), Operations (3).
   - Highest severity: SQL injection in user search, hashedPassword leak pattern, Follow relation naming, Phase C dependency graph, Redis failure strategy.

3. **Integrated review into `plans/twitter-clone.md`** — full rewrite from `IMPLEMENTATION_PLAN.md` incorporating all accepted changes.
   - Key changes: Follow relation renamed (`FollowedBy`/`Follows`), UNION feed query, `publicUserSelect` pattern, `QUOTE_TWEET` enum, parameterized search, pg_trgm indexes, Redis fail-open strategy, expanded tests, health endpoint, structured logger, compound cursor docs, `.env.example` contents, Phase C dependency correction.

4. **Read competing reviews** from Gemini and GPT-5.4.
   - Gemini: 12 revisions, focus on distributed systems (SSE multi-node, thundering herd, async email, media chain-of-trust, atomic increments, cache invalidation on delete).
   - GPT-5.4: Comprehensive diff, focus on operational robustness (sessionVersion, opaque cursors, feed cache versioning, MediaUpload table, notification dedupeKey, env validation, partial indexes, liveness/readiness split).

5. **Synthesized best ideas into final `plans/twitter-clone.md`** via targeted edits (25+ Edit calls).
   - Integrated from both: Redis Pub/Sub for SSE, atomic increment clarification, nuanced Redis failure policy.
   - Integrated from GPT: `sessionVersion`, opaque base64url cursors, feed cache versioning with SETNX lock, notification `dedupeKey`, `env.ts`, `error.tsx`/`not-found.tsx`, partial indexes, `deletedAt`, `logoutAll`, `PasswordResetToken` userId+expiresAt index, SSE replay buffer + `Last-Event-ID`, `requestReset` enumeration protection.
   - Integrated from Gemini: SWR cache with SETNX lock, soft-delete bumps feed cache version, OAuth `P2002` catch for collision retry, account enumeration prevention on reset.
   - Deliberately rejected: BullMQ email workers, async search indexing, idempotency keys, transactional outbox, MediaUpload table (deferred to v2), Phase I operations phase, `ops/` directory, Pino dependency.

## 4) Effective Strategies (helpful)

- **Read all specs before reviewing the plan.** The Explore agent extracted all 9 specs in one pass, which revealed gaps the plan didn't address (e.g., reply-to-deleted guard, QUOTE_TWEET notification, Likes profile tab).
  - Why it worked: Specs are the source of truth; the plan is derived from them.
  - Where to reuse: Always cross-reference specs before implementing any bead.

- **Targeted edits over full rewrites.** After the initial full write of `plans/twitter-clone.md`, the synthesis pass used 25+ surgical `Edit` calls instead of rewriting.
  - Why it worked: Preserved already-reviewed content, minimized risk of introducing new contradictions.
  - Where to reuse: Any plan revision or large document update.

- **Categorize competing ideas by consensus strength.** Ideas both reviews agreed on (Redis Pub/Sub, atomic increments) were integrated with high confidence. Ideas only one review proposed were evaluated more critically.
  - Why it worked: Two independent models converging on the same fix is strong signal.
  - Where to reuse: Any multi-model review synthesis.

- **Explicit rejection list.** Documenting WHY ideas were rejected (with reasoning) prevents the next agent from re-proposing them.
  - Why it worked: Stops the "suggestion loop" where each review re-raises the same over-engineering concern.
  - Where to reuse: Any decision that might be revisited.

## 5) Pitfalls and Anti-Patterns (harmful)

- **The original plan's Follow relation naming (`@relation("Following")` on `User.followers`) was a semantic inversion that would have caused every agent to write backwards queries.**
  - Why it failed: Prisma relation names describe the FK side, not the field side. The naming was technically valid but semantically backwards.
  - How to avoid: Use relation names that describe the relationship from the FK row's perspective (`Follows`, `FollowedBy`).

- **"Conditionally increment" without specifying the mechanism invited in-memory arithmetic.**
  - Why it failed: Agents interpret ambiguous instructions literally. "Conditionally increment" could mean `count + 1` in JS.
  - How to avoid: Always specify the exact Prisma operator: `{ likeCount: { increment: 1 } }`.

- **Blanket "fail-open" Redis policy for all features is wrong for auth rate limiting.**
  - Why it failed: If rate limiting fails open during a Redis outage, auth endpoints become unprotected — worse than brief downtime.
  - How to avoid: Per-feature failure policies (auth=closed, reads=open).

- **MediaUpload intent/confirm flow was proposed by both external reviews but rejected for v1 scope.**
  - Why: Adds a new model, two new endpoints, a GC job, and changes every media consumer. URL-origin validation is adequate for v1. The risk is documented in Risk 6 with the upgrade path.
  - How to avoid: Resist the temptation to over-engineer the media layer. If a v2 is needed, the MediaUpload pattern is well-documented in both reviews.

## 6) Open Loops

- **Beads task decomposition not done.** The plan is ready but no beads have been created from it.
  - Blocking: Nothing — this is the next step.
  - Suggested next probe: Run `br ready --json` to check existing beads, then decompose phases A-H into individual beads.

- **`IMPLEMENTATION_PLAN.md` still exists at repo root.** CLAUDE.md says it's "a reference artifact only" but it's now stale relative to `plans/twitter-clone.md`.
  - Blocking: Not blocking, but could confuse agents.
  - Suggested next probe: Ask user if `IMPLEMENTATION_PLAN.md` should be updated to redirect to `plans/twitter-clone.md`, or left as-is.

- **CLAUDE.md references `IMPLEMENTATION_PLAN.md` in the Task Tracking section.** May need updating to point to `plans/twitter-clone.md`.
  - Blocking: Not blocking for implementation, but agents may read the wrong plan.
  - Suggested next probe: Update CLAUDE.md reference if user agrees.

- **`plans/reviews/P1.gpt54.md` had 0 bytes initially but was later 60KB.** The file may have been written mid-session. No issue now but worth noting.
  - Blocking: Nothing.

## 7) Decision Ledger

| Decision | Rationale | Tradeoff accepted |
|---|---|---|
| Redis Pub/Sub for SSE from day one | Redis already required; EventEmitter rewrite later touches every publisher | Slightly more complex SSE setup in Phase E |
| `sessionVersion` on User model | Deterministic "invalidate all sessions" without Redis key enumeration | Extra DB column, `sessionVersion` check on every authenticated request |
| Opaque base64url cursors | Decouples clients from sort-key internals | Slightly harder to debug pagination (can't read cursor in browser devtools) |
| Feed cache versioning (monotonic counter) | Simpler than TTL-based invalidation flag, no race window | Requires bumping version on every write that affects feed (tweet, follow, delete, retweet) |
| Notification dedupeKey | Prevents duplicate notifications from retries | Extra unique column, requires deterministic key generation |
| Reject MediaUpload table for v1 | Adds significant complexity (new model, 2 endpoints, GC job); URL-origin validation is adequate | Less secure than server-verified uploads; documented as v2 upgrade path |
| Reject BullMQ for email | Password resets are rare; nodemailer <1s | If SMTP is slow, request thread blocks; acceptable for v1 scale |
| Auth rate limiting fails closed on Redis outage | Account-abuse risk outweighs brief auth downtime | Users cannot log in during Redis outage |
| SWR cache with SETNX lock | Prevents thundering-herd DB load on popular feed cache expiry | Adds a Redis lock key and slightly stale data during rebuild |

## 8) Delta Update (for memory/playbook)

### Helpful (+)

- [plan-review] : Cross-reference all openspec specs before reviewing derived plans (count: 1)
- [plan-review] : Two independent models converging on the same fix is strong integration signal (count: 1)
- [prisma-relations] : Name relations from the FK row's perspective, not the field side (count: 1)
- [redis-failure] : Per-feature failure policy (auth=closed, reads=open) is better than blanket fail-open (count: 1)
- [denormalized-counts] : Always specify exact Prisma atomic operators in plan text to prevent ambiguity (count: 1)
- [session-management] : sessionVersion on User model enables deterministic session invalidation (count: 1)
- [pagination] : Opaque base64url cursors decouple wire format from sort internals (count: 1)
- [feed-caching] : Monotonic version counter is simpler and more correct than TTL-based invalidation flags (count: 1)

### Harmful (-)

- [over-engineering] : BullMQ, idempotency keys, transactional outbox, MediaUpload table are premature for v1 (count: 3, from 3 separate proposals across 2 reviews)
- [ambiguous-wording] : "Conditionally increment" in plan text leads agents to implement in-memory arithmetic (count: 1)
- [security-theatre] : Blanket fail-open Redis policy leaves auth endpoints unprotected during outages (count: 1)
- [naming] : Semantically inverted Prisma relation names cause every downstream agent to write backwards queries (count: 1)

## 9) Next-Agent Brief

**What to read first:**
- `plans/twitter-clone.md` — this is the authoritative, fully-revised implementation plan
- `CLAUDE.md` — agent rules and coordination protocol
- `BEADS.md` — task tracking commands

**What to ignore:**
- `IMPLEMENTATION_PLAN.md` at repo root — stale, superseded by `plans/twitter-clone.md`
- `plans/reviews/P1.gemini.md` and `plans/reviews/P1.gpt54.md` — already synthesized into the plan; no need to re-read

**What to try first:**
- Decompose `plans/twitter-clone.md` Phase A through Phase H into beads tasks
- Phase A has zero dependencies and should be the first set of beads created
- Check existing beads state with `br ready --json` before creating new ones

**What success looks like in the next turn:**
- All phases decomposed into beads with correct dependency chains
- Phase A beads are marked ready (no blockers)
- Phase C beads correctly encode the C5-first dependency (C5 must complete before C1/C3/C4 start)
- Workers can begin picking up Phase A beads immediately
