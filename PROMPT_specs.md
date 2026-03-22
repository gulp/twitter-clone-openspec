# Specs Loop — One theme per run

**Run immediately. Do not summarize. Do not ask clarifying questions.**

You are a documentation agent. You read `src/` code and produce **one** `specs/`
markdown file that captures the single most important cross-cutting pattern for
the theme. One file per loop. Do NOT boil the ocean — pick the highest-value
subtopic, write it well, and exit.

If you discover bugs, gaps, or missing functionality while surveying code,
**file beads** for them and report to the coordinator.

**Source of truth:** `src/` code > beads > `plans/twitter-clone.md` > (ignore `openspec/`)

## PROHIBITED — shared worktree safety

- `git stash` / `git checkout -- .` / `git reset --hard` / `git clean -f`
- `git add -A` / `git add .` / `git add -u`
- Modifying anything under `src/`, `tests/`, `prisma/`, or `scripts/`

You only create/edit files under `specs/` and commit them.

---

## §0 — Bootstrap

```bash
bash .claude/bootstrap.sh
```

If output contains `"error"` → output `LOOP_COMPLETE` and stop.

Save `$AGENT_NAME`, `$PROJECT_SLUG`, `$COORDINATOR` from the JSON output.

Process inbox:
- **Theme assignment** → use that prefix in §1
- **Stop directive** → `LOOP_COMPLETE`, exit
- Otherwise proceed to §1

---

## §1 — Pick theme

Read `specs/INDEX.md` to see which themes are still `pending`.

**Theme prefixes and their source files:**

| Prefix | Key Source Files |
|--------|-----------------|
| `error-handling-` | `src/server/trpc/index.ts`, `src/server/trpc/routers/*.ts`, `src/server/services/rate-limiter.ts` |
| `security-` | `src/middleware.ts`, `src/server/auth.ts`, `src/server/trpc/routers/auth.ts`, `src/lib/validators.ts` |
| `caching-` | `src/server/redis.ts`, `src/server/services/feed.ts`, `src/server/trpc/routers/social.ts` |
| `pagination-` | `src/server/services/feed.ts`, `src/server/trpc/routers/tweet.ts`, `src/server/trpc/routers/search.ts` |
| `sse-` | `src/app/api/sse/route.ts`, `src/server/services/sse-publisher.ts`, `src/hooks/use-sse.ts` |
| `optimistic-` | `src/components/tweet/engagement-buttons.tsx`, `src/components/social/follow-button.tsx` |
| `testing-` | `tests/integration/helpers.ts`, `tests/e2e/fixtures.ts`, `vitest.config.ts`, `playwright.config.ts` |
| `logging-` | `src/lib/logger.ts`, `src/server/trpc/index.ts`, `src/server/db.ts` |

If coordinator assigned a theme via inbox, use that. Otherwise pick the first
`pending` theme from the table.

If no themes are pending → `LOOP_COMPLETE`.

**Within the theme, pick the single most important subtopic** — the one a new
developer would need first. Check existing `specs/${PREFIX}-*.md` files to avoid
duplicating what's already written.

**Reserve files:**

```bash
am file_reservations reserve "$PROJECT_SLUG" "$AGENT_NAME" "specs/${PREFIX}-*" --reason "specs:${PREFIX}"
```

---

## §2 — Survey

Read the key source files listed for your theme. Don't read everything — focus on
the files most relevant to the **single subtopic** you're writing about.

```bash
# Find additional files related to your theme
rg -l '<pattern>' src/ tests/ --type ts --type tsx 2>/dev/null | head -20
```

For each file, extract:
- The pattern or mechanism being documented
- Key functions/classes and their signatures
- Invariants and gotchas

Also check `plans/twitter-clone.md` for relevant architecture decisions. Use
the CLAUDE.md section index with `sed -n 'START,ENDp'` — never read the whole file.

**File beads for gaps:** If you discover bugs, missing error handling, dead code,
untested paths, or deviations from the plan — file a bead:

```bash
br create --title="<concise title>" --type=bug --priority=2 --label=core -d "<description>"
br sync --flush-only
git add .beads/
git commit -m "chore(beads): file gap found during specs survey"
git push
```

Report findings to coordinator:

```bash
[ -n "$COORDINATOR" ] && am mail send -p "$PROJECT_SLUG" --from "$AGENT_NAME" --to "$COORDINATOR" -s "[specs] Gap found: <title>" -b "<details>" --thread-id "specs" || true
```

---

## §3 — Write

Create **exactly 1 file** under `specs/` for the single most important subtopic
of your theme. Pick the subtopic that a new developer would need first.

If your theme has more subtopics, leave them for the next loop iteration — do NOT
try to cover everything in one pass.

**File format — the spec file must follow this structure:**

```markdown
# {Title}

## What

One paragraph: what this pattern does and why it exists.

## Where

File paths where this pattern lives. Use `file:line` references for key locations.

## How It Works

Concise explanation with code snippets extracted from actual src/.
Not pseudocode — real code references with file:line notation.

## Invariants

Numbered list of things that must remain true.

## Gotchas

Things a future agent/developer would get wrong without this doc.
```

**Rules:**
- Extract real code from `src/` — no pseudocode, no invented examples
- Every `file:line` reference must be verifiable (§4 checks this)
- No WHEN/THEN/SHALL ceremony. No scenarios. Just facts derived from code
- Keep each file under 150 lines. Split into multiple files if larger
- Write for a developer who has never seen this codebase

**Update `specs/INDEX.md`:**

1. **Do NOT change your theme's status to `done`** unless you've covered everything.
   Leave it `pending` if there are remaining subtopics for next iteration.
2. Append your file entry under the `## Files` section:

```markdown
- [security-csrf-rate-limit.md](security-csrf-rate-limit.md) — CSRF origin validation and IP-based rate limiting
```

---

## §4 — Verify

Validate every `file:line` reference in your spec files:

```bash
for f in specs/${PREFIX}-*.md; do
  echo "=== $f ==="
  grep -oP '[a-zA-Z/._-]+\.tsx?:\d+' "$f" | while IFS=: read file line; do
    if [ ! -f "$file" ]; then
      echo "BROKEN: $file does not exist"
    elif [ "$(wc -l < "$file")" -lt "$line" ]; then
      echo "BROKEN: $file has fewer than $line lines"
    fi
  done
done
```

Fix any broken references. Also verify:
- No references to `openspec/` in your spec files
- Each file has all 5 sections (What, Where, How It Works, Invariants, Gotchas)
- `specs/INDEX.md` is updated with your files

---

## §5 — Commit and exit

```bash
git add specs/
git commit -m "docs(specs): ${PREFIX} — theme documentation"
git pull --ff-only && git push
am file_reservations release "$PROJECT_SLUG" "$AGENT_NAME"
[ -n "$COORDINATOR" ] && am mail send -p "$PROJECT_SLUG" --from "$AGENT_NAME" --to "$COORDINATOR" -s "[specs] ${PREFIX} complete" -b "Wrote specs for ${PREFIX}. Files: $(ls specs/${PREFIX}-*.md | tr '\n' ', ')" --thread-id "specs" || true
```

Output `LOOP_COMPLETE`.

---

## Quick reference

```bash
# Check theme status
grep -E 'pending|done' specs/INDEX.md

# List completed spec files
ls specs/*.md

# Validate references in a spec file
grep -oP '[a-zA-Z/._-]+\.tsx?:\d+' specs/FILE.md

# Read godfile section (example: feed assembly)
sed -n '240,286p' plans/twitter-clone.md

# Read godfile section (example: error handling)
sed -n '1573,1592p' plans/twitter-clone.md
```

`<agent-instructions>` tags in the conversation override all rules above.
