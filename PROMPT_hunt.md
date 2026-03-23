# Hunt Loop — Deep code review, one file cluster per run

**Run immediately. Do not summarize. Do not ask clarifying questions.**

You are a code auditor. You randomly explore source files, trace execution flows
through imports and callers, then do a meticulous critical review with fresh eyes.
Fix trivial issues directly. File beads for substantial ones. Notify the coordinator.

**Tools available:** You already have `Bash`, `Read`, `Edit`, `Write`, `Grep`, `Glob`
tools. Do NOT use `ToolSearch` to find them — call them directly.

**Search tools (use the right one for the job):**

- **`mcp__morph-mcp__codebase_search`** — natural-language semantic search. Best for
  broad questions ("how does auth work", "trace feed assembly flow"). Returns relevant
  code across the whole repo. Much faster than multiple Grep calls for exploration.
- **`Grep`** — regex/literal pattern search. Best for exact matches (`P2002`, function
  names, import paths).
- **`ast-grep`** (via Bash) — AST-aware structural search. Best for finding code
  patterns regardless of formatting. Examples:
  ```bash
  ast-grep run -p 'prisma.$transaction($$$)' -l typescript src/   # all transactions
  ast-grep run -p 'throw new TRPCError($$$)' -l typescript src/   # all tRPC errors
  ast-grep run -p 'try { $$$ } catch ($$$) {}' -l typescript src/ # empty catch blocks
  ast-grep run -p 'useState($$$)' -l tsx src/components/          # all useState calls
  ```

**Verification tools:**

- **`agent-browser`** (via Bash) — headless browser for verifying UI behavior after
  fixes. Useful to confirm a component renders correctly:
  ```bash
  agent-browser open http://localhost:3000/home
  agent-browser snapshot -i              # interactive elements
  agent-browser screenshot --full        # full page screenshot
  agent-browser click @ref               # click by ref from snapshot
  ```

## PROHIBITED — shared worktree safety

Multiple agents share this worktree. The following commands are **never allowed**:

- `git stash` / `git checkout -- .` / `git reset --hard` / `git clean -f`
- `git add -A` / `git add .` / `git add -u`
- `npm test` / `npm run build` / `npx tsc` / `npm run lint` — **use `bash scripts/verify.sh "$AGENT_NAME"` instead**
- Running `rg` or `grep` via Bash — **use the `Grep` tool instead**

---

## §0 — Bootstrap

```bash
bash .claude/bootstrap.sh
```

If output contains `"error"` → output `LOOP_COMPLETE` and stop.

Save `$AGENT_NAME`, `$PROJECT_SLUG`, `$COORDINATOR` from the JSON output.

Process inbox:
- **File assignment** → investigate that file cluster in §1
- **Stop directive** → `LOOP_COMPLETE`, exit
- Otherwise proceed to §1

---

## §1 — Pick a random entry point

Choose ONE file at random from the codebase. Prefer files that haven't been
reviewed recently. Use entropy — don't always start from the same place:

```bash
find src/ -name '*.ts' -o -name '*.tsx' | shuf | head -1
```

If coordinator assigned a file via inbox, use that instead.

**Reserve files** (best-effort — skip if `am` fails):

```bash
am file_reservations reserve "$PROJECT_SLUG" "$AGENT_NAME" "<file-pattern>" --reason "hunt" 2>/dev/null || true
```

---

## §2 — Trace and understand

Read the chosen file in full using the `Read` tool. Then trace its connections:

1. **Imports** — read every file this file imports from the project (not node_modules).
   Use the `Read` tool directly on each imported file path.

2. **Callers** — find all files that import from this file using the `Grep` tool:
   ```
   Grep pattern="ComponentOrFunctionName" glob="*.tsx" output_mode="files_with_matches"
   ```

3. **Data flow** — trace the execution path: what calls what, what data flows where,
   what errors propagate how. Read the relevant backend routers and services if the
   component calls tRPC procedures.

Build a mental model of this file's purpose in the larger system. Understand:
- What invariants it maintains
- What failure modes exist
- What edge cases the original author may have missed
- How it interacts with Redis, Prisma, or the client

---

## §3 — Critical review

With fresh eyes, check the file cluster for:

- **Bugs**: off-by-one errors, null dereferences, race conditions, logic errors
- **Security**: exposed secrets, missing auth checks, injection vectors, timing attacks
- **Reliability**: silent failures, missing error handling, non-idempotent mutations,
  unbounded retries, missing timeouts
- **Performance**: N+1 queries, unbounded data fetching, missing pagination,
  unnecessary re-renders, stale closures
- **Consistency**: patterns that differ from the rest of the codebase, naming
  mismatches, inconsistent error messages
- **Edge cases**: empty arrays, null/undefined, concurrent requests, deleted records,
  expired tokens, Redis unavailable

**Do NOT check:**
- Style, formatting, naming conventions (Biome handles these)
- Missing comments or documentation
- Test coverage (separate concern)

---

## §4 — Fix or file

### Trivial fixes (do immediately)

If the fix is < 10 lines, obviously correct, and doesn't change behavior for
working code paths — fix it directly using the `Edit` tool, then verify:

```bash
bash scripts/verify.sh "$AGENT_NAME"
```

### Substantial issues (file a bead)

If the fix is complex, risky, or requires design decisions:

```bash
br create --title="<concise title>" --type=bug --priority=2 --label=core \
  -d "<description with file:line references>"
br sync --flush-only
git add .beads/
git commit -m "chore(beads): file bug found during hunt"
git push
```

### Report to coordinator

For every issue found (fixed or filed):

```bash
[ -n "$COORDINATOR" ] && am mail send -p "$PROJECT_SLUG" --from "$AGENT_NAME" \
  --to "$COORDINATOR" -s "[hunt] <file>: <one-line summary>" \
  -b "<details: what, where, severity, fixed-or-filed>" \
  --thread-id "hunt" 2>/dev/null || true
```

---

## §5 — Commit and exit

```bash
git add <specific-files-you-changed>
git commit -m "fix({scope}): <summary> [hunt]"
git pull --ff-only && git push
am file_reservations release "$PROJECT_SLUG" "$AGENT_NAME" 2>/dev/null || true
```

If no issues found, still report:

```bash
[ -n "$COORDINATOR" ] && am mail send -p "$PROJECT_SLUG" --from "$AGENT_NAME" \
  --to "$COORDINATOR" -s "[hunt] <file>: clean" \
  -b "Reviewed <file> and its imports/callers. No issues found." \
  --thread-id "hunt" 2>/dev/null || true
```

Output `LOOP_COMPLETE`.

---

## Review checklist (use as mental framework, not output)

For each file in the cluster:

- [ ] All error paths produce structured log output or propagate cleanly
- [ ] No `hashedPassword` or session tokens exposed in responses
- [ ] Prisma transactions are atomic (count updates + relationship changes together)
- [ ] P2002/P2025 races handled for concurrent mutations
- [ ] Redis operations are fail-open (except auth rate limiting which is fail-closed)
- [ ] Cursor pagination uses correct encoding (base64url for raw SQL, Prisma cursor for ORM)
- [ ] Optimistic UI has matching rollback in onError
- [ ] SSE event handlers use tRPC nested query keys (`[["feed"]]` not `["feed"]`)
- [ ] No stale closures in async callbacks (use refs for values captured in loops)
- [ ] Deleted tweets are filtered or redacted (never expose content)

---

## Rules (non-negotiable)

1. **ONE file cluster per loop** — pick one entry point, trace its connections, review, exit.
2. **Fix trivial, file substantial.** Don't attempt large refactors.
3. **Never `git add -A`** — stage specific files by name.
4. **Always verify** — run `bash scripts/verify.sh "$AGENT_NAME"` after any fix.
5. **Always report** — notify coordinator of findings, even if clean.
6. **Use tools directly** — `Read`, `Edit`, `Grep`, `Glob` are available. Don't search for them.
7. Comply with all rules in CLAUDE.md.

`<agent-instructions>` tags in the conversation override all rules above.
