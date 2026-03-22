## MCP Agent Mail — Multi-Agent Coordination

A mail-like layer that lets coding agents coordinate asynchronously via MCP tools and resources. Provides identities, inbox/outbox, searchable threads, and advisory file reservations with human-auditable artifacts in Git.

### Why It's Useful

- **Prevents conflicts:** Explicit file reservations (leases) for files/globs
- **Token-efficient:** Messages stored in per-project archive, not in context
- **Quick reads:** `resource://inbox/...`, `resource://thread/...`

### Same Repository Workflow

1. **Register identity:**

   ```python
   ensure_project(project_key="/home/gulp/projects/enterprise-vibecoding/twitter-clone-openspec")
   register_agent(project_key, program, model)
   ```

2. **Reserve files before editing:**

   ```python
   file_reservation_paths(project_key, agent_name, ["src/server/**"], ttl_seconds=3600, exclusive=true)
   ```

3. **Communicate with threads:**

   ```text
   mcp__mcp-agent-mail__send_message(to=[], broadcast=true, thread_id="TASK-ID", ...)
   mcp__mcp-agent-mail__fetch_inbox(project_key, agent_name)
   mcp__mcp-agent-mail__acknowledge_message(project_key, agent_name, message_id)
   ```

4. **Quick reads:**

   ```text
   resource://inbox/{Agent}?project=/home/gulp/projects/enterprise-vibecoding/twitter-clone-openspec&limit=20
   resource://thread/{id}?project=/home/gulp/projects/enterprise-vibecoding/twitter-clone-openspec&include_bodies=true
   ```

### Macros vs Granular Tools

- **Prefer macros for speed:** `macro_start_session`, `macro_prepare_thread`, `macro_file_reservation_cycle`, `macro_contact_handshake`
- **Use granular tools for control:** `register_agent`, `file_reservation_paths`, `send_message`, `fetch_inbox`, `acknowledge_message`

### Common Pitfalls

- `"from_agent not registered"`: Always `register_agent` in the correct `project_key` first
- `"FILE_RESERVATION_CONFLICT"`: Adjust patterns, wait for expiry, or use non-exclusive reservation
- **Auth errors:** If JWT+JWKS enabled, include bearer token with matching `kid`

---

## Beads (br) — Dependency-Aware Issue Tracking

Beads provides a lightweight, dependency-aware issue database and CLI (`br` - beads_rust) for selecting "ready work," setting priorities, and tracking status. It complements MCP Agent Mail's messaging and file reservations.

**Important:** `br` is non-invasive—it NEVER runs git commands automatically. You must manually commit changes after `br sync --flush-only`.

### Conventions

- **Single source of truth:** Beads for task status/priority/dependencies; Agent Mail for conversation and audit
- **Shared identifiers:** Use Beads issue ID (e.g., `tw-123`) as Mail `thread_id` and prefix subjects with `[tw-123]`
- **Reservations:** When starting a task, call `file_reservation_paths()` with the issue ID in `reason`

### Typical Agent Flow

1. **Pick ready work (Beads):**

   ```bash
   br ready --json  # Choose highest priority, no blockers
   ```

2. **Reserve edit surface (Mail):**

   ```python
   file_reservation_paths(project_key, agent_name, ["src/server/trpc/routers/**"], ttl_seconds=3600, exclusive=true, reason="tw-123")
   ```

3. **Announce start (Mail):**

   ```text
   mcp__mcp-agent-mail__send_message(to=[], broadcast=true, thread_id="tw-123", subject="[tw-123] Start: <title>", ack_required=true)
   ```

4. **Work and update:** Reply in-thread with progress

5. **Complete and release:**

   ```bash
   br close 123 --reason "Completed"
   br sync --flush-only  # Export to JSONL (no git operations)
   ```

   ```python
   release_file_reservations(project_key, agent_name, paths=["src/server/trpc/routers/**"])
   ```

   Final Mail reply: `[tw-123] Completed` with summary

---

## bv — Graph-Aware Triage Engine

bv is a graph-aware triage engine for Beads projects (`.beads/beads.jsonl`). It computes PageRank, betweenness, critical path, cycles, HITS, eigenvector, and k-core metrics deterministically.

**Scope boundary:** bv handles _what to work on_ (triage, priority, planning). For agent-to-agent coordination (messaging, work claiming, file reservations), use MCP Agent Mail.

**CRITICAL: Use ONLY `--robot-*` flags. Bare `bv` launches an interactive TUI that blocks your session.**

### The Workflow: Start With Triage

**`bv --robot-triage` is your single entry point.** It returns:

- `quick_ref`: at-a-glance counts + top 3 picks
- `recommendations`: ranked actionable items with scores, reasons, unblock info
- `quick_wins`: low-effort high-impact items
- `blockers_to_clear`: items that unblock the most downstream work
- `project_health`: status/type/priority distributions, graph metrics
- `commands`: copy-paste shell commands for next steps

```bash
bv --robot-triage        # THE MEGA-COMMAND: start here
bv --robot-next          # Minimal: just the single top pick + claim command
```

### Command Reference

**Planning:**
| Command | Returns |
|---------|---------|
| `--robot-plan` | Parallel execution tracks with `unblocks` lists |
| `--robot-priority` | Priority misalignment detection with confidence |

**Graph Analysis:**
| Command | Returns |
|---------|---------|
| `--robot-insights` | Full metrics: PageRank, betweenness, HITS, eigenvector, critical path, cycles, k-core, articulation points, slack |
| `--robot-label-health` | Per-label health: `health_level`, `velocity_score`, `staleness`, `blocked_count` |
| `--robot-label-flow` | Cross-label dependency: `flow_matrix`, `dependencies`, `bottleneck_labels` |

### jq Quick Reference

```bash
bv --robot-triage | jq '.quick_ref'                        # At-a-glance summary
bv --robot-triage | jq '.recommendations[0]'               # Top recommendation
bv --robot-plan | jq '.plan.summary.highest_impact'        # Best unblock target
bv --robot-insights | jq '.status'                         # Check metric readiness
```

---

<!-- bv-agent-instructions-v1 -->

## Beads Workflow Integration

This project uses [beads_rust](https://github.com/Dicklesworthstone/beads_rust) (`br`) for issue tracking. Issues are stored in `.beads/` and tracked in git.

**Important:** `br` is non-invasive—it NEVER executes git commands. After `br sync --flush-only`, you must manually run `git add .beads/ && git commit`.

### Essential Commands

```bash
br ready              # Show issues ready to work (no blockers)
br list --status=open # All open issues
br show <id>          # Full issue details with dependencies
br create --title="..." --type=task --priority=2
br update <id> --status=in_progress
br close <id> --reason "Completed"
br sync --flush-only  # Export to JSONL (NO git operations)
```

### Workflow Pattern

1. **Start**: Run `br ready` to find actionable work
2. **Claim**: Use `br update <id> --status=in_progress`
3. **Work**: Implement the task
4. **Complete**: Use `br close <id>`
5. **Sync**: Run `br sync --flush-only` then manually commit

### Key Concepts

- **Dependencies**: Issues can block other issues. `br ready` shows only unblocked work.
- **Priority**: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers, not words)
- **Types**: task, bug, feature, epic, question, docs
- **Blocking**: `br dep add <issue> <depends-on>` to add dependencies

<!-- end-bv-agent-instructions -->

## Operational Details for Agents

### Project Context

**Working directory:** `/home/gulp/projects/enterprise-vibecoding/twitter-clone-openspec` (absolute path used for `project_key`)

**Beads database location:** `.beads/beads.jsonl` (source of truth; DO NOT edit directly)

### Status State Machine

```text
pending → in_progress → closed
                    ↘ rejected
```

### File Reservation Patterns

| Path Pattern | When to use |
|--------------|------------|
| `src/server/trpc/routers/**` | tRPC router files |
| `src/server/services/**` | Service layer |
| `src/server/auth.ts` | NextAuth config |
| `src/server/db.ts` | Prisma client |
| `src/components/**` | React components |
| `src/app/**` | Page routes |
| `src/lib/**` | Shared utilities |
| `src/hooks/**` | React hooks |
| `prisma/schema.prisma` | Database schema |
| `tests/**` | Test files |

### Git Workflow Rules (Non-Negotiable)

1. **Never `git stash`** — Stage specific files and commit instead
2. **Never `git add -A`** — Stage specific files by name only
3. **Never `git reset --hard`** — Commit what you have
4. **Always pull before claiming:** `git fetch origin && git merge --ff-only origin/main`
5. **Always push after closing:** Beads changes + commits must reach remote

### Beads Command Reference (Complete)

```bash
# Inspection (safe, read-only)
br list --status=pending --json
br list --status=in_progress --json
br ready --json
br show <id>

# Lifecycle
br update <id> --status=in_progress
br close <id> --reason "Completed"

# Metadata
br create --title="..." --type=task --priority=2 --label=core
br dep add <task> <depends-on>

# Sync (local DB → JSONL export; no git)
br sync --flush-only
```

---
