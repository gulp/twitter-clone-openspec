# HANDOFF SUMMARY

## 1) Mission State

- **Current objective:** Transform `plans/twitter-clone.md` (1655-line godfile) into a fully dependency-wired beads hierarchy, then review/fix all issues.
- **Current status:** COMPLETE. 51 beads created (9 epics + 42 tasks), 123 dependency edges, 0 cycles. All beads reviewed, 16 issues found and fixed. Memory files written for future agent tool-usage correctness.
- **Definition of done:** Comprehensive, self-contained beads with acceptance criteria, background, constraints, and correct dependency graph — agents can pick any ready bead and implement without referring back to the plan. Done.
- **Immediate next best action:** Start implementation. Claim `tw-bpw.1` (A1: Project scaffolding) and `tw-bpw.2` (A2: Docker Compose) — the only two unblocked P0 tasks. They can run in parallel.

## 2) Stable Context (carry forward)

### Project
- **What:** Twitter Clone — full-stack Next.js 14 + tRPC + Prisma + PostgreSQL + Redis + S3/MinIO
- **Plan:** `plans/twitter-clone.md` (~1655 lines, 25K tokens). Never read whole file — use `mq` for discovery and `sed -n` for extraction.
- **Beads DB:** `.beads/` directory, SQLite-backed. Tools: `br` (issue tracking), `bv` (robot triage).
- **Memory:** 3 files in `~/.claude/projects/-home-gulp-projects-enterprise-vibecoding-twitter-clone-openspec/memory/`:
  - `feedback_br_bv_tool_usage.md` — JSON shapes, flag traps, jq queries for log analysis
  - `feedback_bead_review_lessons.md` — Review checklist (missing routers, dep direction, etc.)
  - `reference_beads_project_state.md` — All 51 bead IDs, epic→task mappings, critical path

### Architecture invariants (from plan)
- I1: `hashedPassword` and `sessionVersion` never in API responses (`publicUserSelect`/`selfUserSelect`)
- I2: `email` never on public endpoints
- I3: Denormalized counts updated atomically in same Prisma transaction
- I4: Counts never negative (CHECK constraints)
- I5: Deleted tweets → 404; never in feeds/search
- I6: Self-actions blocked (no self-follow, self-retweet, self-notification)
- I7: All user input validated by Zod before business logic
- I8: All raw SQL parameterized via `Prisma.sql` tagged template
- I9: CSRF origin validation on POST to `/api/`
- I10: Auth errors never reveal email/username existence

### Key beads tool facts
- `br show <id> --json` returns a **list** (not a dict) — always index `[0]`
- Dependency type key: `dependency_type` in `br show`, `type` in `br dep list`
- `br create` uses `-d` for description; `br update` uses `--description`
- `br create --silent` may emit log lines after ID — always pipe through `head -1`
- `br dep add <A> <B>` means A depends on B (B blocks A)

## 3) Progress So Far (what happened)

### Phase 1: Bead Creation
1. Read AGENTS.md (which is CLAUDE.md) and full `plans/twitter-clone.md` in chunks (offset/limit due to 10K token limit)
2. Checked `br` CLI syntax: `create`, `dep add`, `comments add`, `--parent`, `--silent`
3. Wrote `/tmp/create-beads.sh` — comprehensive shell script with helper functions (`mk`, `mkp`, `dep`, `cmt`)
4. Created beads in order: 9 epics → 40 tasks (with `--parent`) → 67 `blocks` dependencies → 12 detailed comments
5. Result: 49 beads, 110 dependency edges, 0 cycles
6. Verified with `br stats`, `br ready`, `br dep cycles`, `br dep tree`

### Phase 2: Review & Fix
1. Ran `bv --robot-triage` for graph analysis (PageRank, betweenness centrality, critical path)
2. Dumped all 110 dependency edges and analyzed systematically
3. Cross-referenced §5 tRPC Router Structure against beads — found user router missing
4. Checked every dependency for correctness (code-level imports, not phase-level groupings)
5. Found 16 issues across 5 categories:
   - 2 missing beads (user router, SSE integration test)
   - 3 wrong dependencies (E1→D1 removed, E2→C3 and H3→G3 added)
   - 4 missing dependencies (G1→F1, G2→F3, F5→C2, G3→F5)
   - 3 priority corrections (A1→P0, A2→P0, O1→P1)
   - 4 advisory comments (B1 scope, F4 SSE soft-dep, H1 rate limiter, A1 biome.json)
6. Applied all 16 fixes via `/tmp/fix-beads.sh`
7. Post-fix: 51 beads, 123 edges, 0 cycles, 11 ready (2 actionable P0 tasks)

### Phase 3: Memory Documentation
1. Tested all `br`/`bv` JSON output shapes empirically — captured exact key names
2. Reproduced every failure mode from the session
3. Wrote 3 memory files: tool usage patterns, review lessons, project state reference
4. Updated MEMORY.md index

### Phase 4: Log Analysis
1. Located conversation log at `~/.claude/projects/.../6e092796-5b68-4f21-9a5b-3508e4640fac.jsonl`
2. Analyzed 81 tool calls, found 8 failures (10% rate)
3. Categorized into 5 root causes: JSON shape mismatch (3), dep key naming (2), flag inconsistency (1), file too large (1), parallel cascade (1)
4. Wrote reusable jq queries into the memory file for future log analysis

## 4) Effective Strategies (helpful)

1. **Shell script with helper functions for bulk bead creation**
   - Why: Capturing IDs in variables (`A1=$(mk ...)`) enables reliable dependency wiring. `2>/dev/null | head -1` prevents log noise from corrupting ID capture.
   - Reuse: Any future bulk bead creation or restructuring.

2. **Cross-reference §5 tRPC Router Structure against beads**
   - Why: The phase plan (§6) omits things that §5 includes (user router was missing). §5 is the authoritative router inventory.
   - Reuse: After any bead creation, always verify §5 coverage.

3. **Code-level dependency analysis ("does this task's code import/call the dependency?")**
   - Why: Phase-level dependencies from the plan are often over-constrained. E1 (SSE) doesn't call `feed.home`, so E1→D1 was wrong. Task-level analysis catches this.
   - Reuse: Any dependency review.

4. **Empirical JSON schema capture before writing parsing code**
   - Why: `br` uses different key names across commands (`dependency_type` vs `type`). Testing with real output prevents KeyErrors.
   - Reuse: Any new `br`/`bv` command or flag combination.

5. **`bv --robot-triage` for graph metrics (PageRank, betweenness, blocker analysis)**
   - Why: Identifies critical path bottlenecks and high-impact tasks programmatically.
   - Reuse: Prioritization decisions, parallelism planning.

## 5) Pitfalls and Anti-Patterns (harmful)

1. **`br show --json` returns a list, not a dict**
   - Failed: `d = json.load(sys.stdin); d['title']` → `TypeError: list indices must be integers`
   - Fix: Always `d = json.load(sys.stdin)[0]`
   - Count: 1 primary + 2 cascaded cancellations = 3 failures

2. **Dependency key naming inconsistency across br commands**
   - Failed: `dep['dep_type']` → KeyError. The key is `dependency_type` in `br show` but `type` in `br dep list`.
   - Fix: Consult memory file `feedback_br_bv_tool_usage.md` table before writing parsing code.
   - Count: 1 primary + 1 cascaded = 2 failures

3. **`br update -d` does not exist (only `--description`)**
   - Failed: Script used `br update <id> -d "..."` which is not a valid flag.
   - Fix: `br create` has `-d`; `br update` requires `--description`. Inconsistent but documented.
   - Count: 1 failure

4. **Parallel tool calls: one failure cascades to cancel all siblings**
   - Failed: 3 parallel Bash calls; first errored → other 2 cancelled as `tool_use_error`.
   - Fix: Isolate risky/untested commands from safe ones. Don't parallelize exploratory calls.
   - Count: 3 cascaded cancellations

5. **Reading plans/twitter-clone.md without offset/limit**
   - Failed: File is 25K tokens, exceeds 10K Read tool limit.
   - Fix: Always use `offset` and `limit` params. The CLAUDE.md says "Never read the whole file."
   - Count: 1 failure

## 6) Open Loops

1. **No beads are in_progress or closed — zero implementation done**
   - Blocking: This session was purely planning/review. Implementation starts next.
   - Next: Assign `tw-bpw.1` and `tw-bpw.2` to workers.

2. **B1 (auth backend) may be too large for one agent**
   - Blocking: Not yet tested. Comment added with splitting strategy.
   - Next: If first agent attempt on B1 fails or times out, coordinator should split into B1a/B1b/B1c per the comment.

3. **F4 new-tweets-indicator has soft SSE dependency**
   - Blocking: F4 doesn't hard-depend on E3 to preserve parallelism.
   - Next: F4 implementer must stub the useSSE hook. Comment documents this.

4. **H2 user integration tests not yet in description body**
   - Blocking: Fix was added as a comment, not a description update.
   - Next: When H2 is claimed, agent should read comments for the user.test.ts requirement.

## 7) Decision Ledger

| Decision | Rationale | Tradeoff |
|----------|-----------|----------|
| E1 does NOT depend on D1 (feed) | SSE endpoint subscribes to Redis PubSub, never calls feed.home. E2 needs C3 (followers) not D1. | E can start earlier; if feed logic is needed in SSE later, dep must be added back. |
| A1 and A2 bumped to P0 | Both on critical path (A2 blocks A3 which is P0). Triage uses priority for ranking. | No downside — they're genuinely critical. |
| O1 (tRPC logging) bumped to P1 | Logging middleware should be wired early so all subsequent features have observability. | If deferred, debugging feature beads is harder. |
| F4 does NOT hard-depend on E3 (SSE) | Maximizes parallelism. New-tweets indicator is progressive enhancement. | Indicator shows nothing until E3 done; must degrade gracefully. |
| User router added as separate bead (tw-3by.6 / C0) | §5 defines it; no existing bead covered getByUsername/updateProfile. | Adds one more bead to Phase C; slight increase in graph complexity. |
| SSE integration test added as separate bead (tw-2yb.4 / H2b) | SSE has Lua scripts, replay buffers, connection lifecycle — too complex for zero test coverage. | Adds testing scope; requires real Redis (no mocks). |

## 8) Delta Update (for memory/playbook)

### Helpful (+)
- [br-bulk-creation] : Use shell script with `mk()`/`mkp()` helpers capturing IDs in variables; create epics→tasks→deps→comments in order (count: 1)
- [br-json-shapes] : `br show` returns list (index `[0]`); dep key is `dependency_type` in show, `type` in dep list (count: 3)
- [bead-review] : Cross-reference §5 tRPC Router Structure against beads to find missing coverage (count: 1)
- [dep-analysis] : Check "does code literally import/call the dep?" not "does the plan say phase-level dep?" (count: 1)
- [bv-triage] : `bv --robot-triage` gives PageRank, betweenness, blocker analysis for prioritization (count: 1)
- [jq-log-analysis] : Failed tool calls at `.message.content[] | select(.type == "tool_result" and .is_error == true)` joined with tool_use by ID (count: 1)

### Harmful (-)
- [br-show-json-shape] : `br show --json` is a list not dict — `d['title']` fails; must use `[0]` (count: 3)
- [br-dep-key-naming] : Key is `dependency_type` in show, `type` in dep list, `dep_type` never exists — KeyError (count: 2)
- [br-update-flags] : `br update -d` does not exist; use `--description`; `-d` only works on `create` (count: 1)
- [parallel-cascade] : One failed Bash in parallel group cancels all siblings — isolate risky calls (count: 3)
- [large-file-read] : plans/twitter-clone.md is 25K tokens; must use offset+limit or sed/mq extraction (count: 1)

## 9) Next-Agent Brief

**Read first:**
- `CLAUDE.md` (AGENTS.md is identical) — project constitution, stack, commands, agent rules
- Memory file `feedback_br_bv_tool_usage.md` — critical for avoiding `br`/`bv` tool call failures
- `br ready` output — shows `tw-bpw.1` and `tw-bpw.2` as the two actionable P0 tasks

**Ignore:**
- `plans/twitter-clone.md` in its entirety — use `sed -n` with line ranges from CLAUDE.md Section Index
- Epic-level beads (tw-bpw, tw-1er, etc.) — they're containers, not work items
- The 9 "ready" feature beads — those are epics with no direct work; only task beads should be claimed

**Try first:**
- Spin up 2 parallel workers: one on `tw-bpw.1` (package.json, tsconfig, biome.json, tailwind, vitest configs), one on `tw-bpw.2` (docker-compose.yml, .env.example)
- After both complete: `tw-bpw.3` (Prisma schema + migrations), `tw-bpw.4` (env.ts), `tw-bpw.9` (validators, constants, utils, logger) can run in parallel
- Run `bv --robot-triage | jq '.triage.quick_ref.top_picks[:5]'` for ranked recommendations

**Success looks like:**
- Workers claim beads, implement real code (no stubs), pass `bash scripts/verify.sh`, commit, close beads, push
- Dependency graph unlocks progressively: A1/A2 → A3/A4/A9 → A5 → A6/A7 → B1 → C5/C2 (parallel) → C1/C3/C4 (parallel)
- Zero implementation beads should be in "open" state with no progress after the next session
