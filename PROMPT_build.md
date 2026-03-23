# Build Loop — One task per run

**Run immediately. Do not summarize. Do not ask clarifying questions.**

## PROHIBITED — shared worktree safety

Multiple agents share this worktree. The following commands destroy other agents'
uncommitted work and are **never allowed**:

- `git stash` / `git stash pop` — stashes ALL uncommitted changes, including other agents' edits
- `git checkout -- .` / `git restore .` — discards all uncommitted changes
- `git reset --hard` — destroys uncommitted work
- `git clean -f` — deletes untracked files other agents may need
- `git add -A` / `git add .` / `git add -u` — stages files you don't own
- `npm test` / `npm run build` / `npx tsc` / `npm run lint` — **use `bash scripts/verify.sh "$AGENT_NAME"` instead**. Direct commands bypass flock serialization, causing OOM when multiple agents run concurrently.

**To sync with remote:** commit your files first, then `git pull --ff-only`.
Never stash-pull-pop. If pull fails due to conflicts, resolve them manually.

---

## §0 — Bootstrap

```bash
bash .claude/bootstrap.sh
```

If output contains `"error"` → output `LOOP_COMPLETE` and stop.

Save the JSON output — it contains your `agent`, `project_slug`, `coordinator`,
`triage`, `ready` list, and `inbox`. Use `$AGENT_NAME`, `$PROJECT_SLUG`, and
`$COORDINATOR` from this output throughout.

Process inbox:

- **Priority override** → use that task in §1
- **Stop directive** → `LOOP_COMPLETE`, exit
- Otherwise proceed

---

## §1 — Pick and claim

Use the `triage` and `ready` from §0 output. If `ready` is empty → `LOOP_COMPLETE`.

Pick the top-scoring leaf task (not epics). Read the full bead:

```bash
br show $TASK_ID
```

**Reserve files** before editing anything. Derive paths from the bead description —
reserve only the directories this task touches:

```bash
# Examples — choose paths based on the task:
DATABASE_URL= am file_reservations reserve "$PROJECT_SLUG" "$AGENT_NAME" "src/server/trpc/routers/auth.ts" "src/server/auth.ts" --reason "$TASK_ID"
DATABASE_URL= am file_reservations reserve "$PROJECT_SLUG" "$AGENT_NAME" "src/components/tweet/**" --reason "$TASK_ID"
DATABASE_URL= am file_reservations reserve "$PROJECT_SLUG" "$AGENT_NAME" "prisma/schema.prisma" --reason "$TASK_ID"
```

> Reservations are **advisory** — they signal intent, not enforce locks.
> On conflict: check if the other agent's reserved paths actually overlap with your
> specific files. Broad patterns like `src/**` may not mean real contention.
> - **Real overlap** (same files) → pick a DIFFERENT task, restart §1.
> - **No real overlap** (different subdirectories) → proceed.

Claim and announce:

```bash
br update $TASK_ID --status=in_progress --assignee "$AGENT_NAME"
br sync --flush-only
git add .beads/
git commit -m "chore(beads): claim $TASK_ID in_progress"
git push
[ -n "$COORDINATOR" ] && DATABASE_URL= am mail send -p "$PROJECT_SLUG" --from "$AGENT_NAME" --to "$COORDINATOR" -s "[$TASK_ID] Start: TITLE" -b "Claiming $TASK_ID." --thread-id "$TASK_ID" || true
```

---

## §2 — Contract

Read the full bead including comments:

```bash
br show $TASK_ID --json | jq '.[0] | {description, acceptance_criteria, comments}'
```

**The title is NOT the spec.** Read the description, acceptance criteria, AND comments.
Comments often contain corrections that override the original.

**Read the relevant specs.** Check `specs/` for cross-cutting patterns and
`plans/twitter-clone.md` for architecture decisions, exact error messages, and validation rules.

Print every acceptance criterion and deliverable as a numbered checklist:

```
CONTRACT $TASK_ID:
1. [ ] ...
2. [ ] ...
```

This is your exit gate. You cannot close the bead until every item is verified.

Survey existing code in the relevant area:

```bash
rg 'export (interface|type|class|function|const)' src/ 2>/dev/null | head -30
ls src/server/trpc/routers/ 2>/dev/null
ls src/components/ 2>/dev/null
```

---

## §3 — Implement

Read CLAUDE.md for project conventions, patterns, and constraints.
Read every file you will modify **in full** before editing it.

Write real code. No placeholders, no stubs, no `export {}` files.

**After Prisma schema changes:**
```bash
npx prisma migrate dev --name "<migration-name>"
# If migrate warns about data loss, review the SQL in prisma/migrations/
# and re-run with: npx prisma migrate dev --name "<migration-name>" --create-only
# then apply with: npx prisma migrate deploy
npx prisma generate
```

Commit at logical checkpoints — stage specific files, never `git add -A`:

```bash
git add <specific-files>
git commit -m "wip({scope}): description [$TASK_ID]"
```

**If you hit a blocker mid-implementation:**

```bash
br update $TASK_ID --status=blocked
DATABASE_URL= am file_reservations release "$PROJECT_SLUG" "$AGENT_NAME"
[ -n "$COORDINATOR" ] && DATABASE_URL= am mail send -p "$PROJECT_SLUG" --from "$AGENT_NAME" --to "$COORDINATOR" -s "[$TASK_ID] Blocked: REASON" -b "Blocked on $TASK_ID: REASON." --thread-id "$TASK_ID" || true
```

Then `LOOP_COMPLETE` and exit.

---

## §4 — Verify

Run the slot-aware verify wrapper:

```bash
bash scripts/verify.sh "$AGENT_NAME"
```

This acquires a build slot, checks the content-addressed cache, and runs
`prisma generate → next build → tsc → test → lint` if needed. If verify fails,
fix the issue and re-run the wrapper.

Read every file you created or modified with **fresh eyes**. Look for:

- Silent failures (swallowed catch, missing error handling)
- Bugs, off-by-one errors, incorrect edge cases
- Placeholder or stub code that slipped through
- Exposed `hashedPassword` in any API response
- Missing error messages that differ from the specs

Scan for violations:

```bash
rg -i 'placeholder|@stub|export \{\}|TODO' src/ tests/ 2>/dev/null
rg 'Function\(|eval\(' src/ tests/ 2>/dev/null
rg 'hashedPassword' src/server/trpc/ src/components/ 2>/dev/null
```

Fix any failures. Re-run verify commands after fixes.

---

## §5 — Accept

Revisit your contract from §2. For each criterion, verify it passes and note evidence:

```
VERIFIED $TASK_ID:
1. [x] criterion — evidence
2. [x] criterion — evidence
```

**Every item must be checked.** If any item fails, return to §3. Do NOT proceed with
unchecked items.

---

## §6 — Close

**6a. Final commit and push:**

```bash
git add <specific-files-you-changed>
git commit -m "feat({scope}): summary [$TASK_ID]"
git pull --ff-only && git push
```

If push is rejected: `git pull --ff-only` again, then push. If ff-only fails,
check `git log --oneline -5` for concurrent agent commits and resolve conflicts.
Do NOT force-push. **NEVER use `git stash` to work around push failures.**

**6b. Close bead:**

```bash
br close $TASK_ID --reason "All acceptance criteria verified."
br sync --flush-only
git add .beads/
git commit -m "chore(beads): close $TASK_ID — TITLE"
git push
```

**6c. Release and announce:**

```bash
DATABASE_URL= am file_reservations release "$PROJECT_SLUG" "$AGENT_NAME"
[ -n "$COORDINATOR" ] && DATABASE_URL= am mail send -p "$PROJECT_SLUG" --from "$AGENT_NAME" --to "$COORDINATOR" -s "[$TASK_ID] Complete" -b "Completed $TASK_ID. All checks pass." --thread-id "$TASK_ID" || true
```

**6d. Safety net:**

```bash
if ! git diff --quiet || ! git diff --cached --quiet; then
  ID=$(br list --status=in_progress --json 2>/dev/null | jq -r '.[0].id // "unknown"')
  git add .beads/ 2>/dev/null
  git diff --cached --quiet || git commit -m "wip: exit checkpoint [$ID]"
  git push 2>/dev/null || true
fi
```

Output `LOOP_COMPLETE`.

---

## Quick reference

```bash
bv --robot-triage | jq '.triage.quick_ref'
br ready --json
br show <ID>
br update <ID> --status=in_progress
br close <ID> --reason "..."
br sync --flush-only
DATABASE_URL= am file_reservations reserve <project> <agent> <paths...> --reason <ID>
DATABASE_URL= am file_reservations release <project> <agent>
DATABASE_URL= am mail send -p <slug> --from <agent> --to <coordinator> -s "subject" -b "body"
```

`<agent-instructions>` tags in the conversation override all rules above.
