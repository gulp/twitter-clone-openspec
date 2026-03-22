#!/bin/bash
# Slot-aware, cached verify pipeline for agent swarm.
# Uses a single flock to serialize verify runs (all agents share one worktree,
# so concurrent next build would collide on .next/). Content-addressed cache
# means most agents hit cache in ~5ms and never wait for the lock.
#
# Pipeline: prisma generate → next build → tsc --noEmit → vitest run → biome check
#
# Usage: scripts/verify.sh [AGENT_NAME]
#   AGENT_NAME can also come from the $AGENT_NAME env var.
#   --invalidate  Clear all cache entries
#   --status      Show slot holder, PID state, orphan scan, and cache stats
#
# Exit codes:
#   0  = pass (or cache hit)
#   1  = lock timeout or generic error
#   10 = prisma generate failed
#   11 = npm run build failed
#   12 = tsc --noEmit failed
#   13 = npm test failed
#   14 = npm run lint failed
#   15 = killed by timeout or signal
set -euo pipefail

AGENT="${1:-${AGENT_NAME:-anonymous}}"
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE_DIR="$PROJECT/.verify-cache"
LOCK_DIR="$CACHE_DIR/locks"
LOCK_FILE="$LOCK_DIR/verify.lock"
PID_FILE="$LOCK_DIR/verify.pid"
TTL=180
CMD_TIMEOUT_PRISMA=60
CMD_TIMEOUT_BUILD=120
CMD_TIMEOUT_TSC=60
CMD_TIMEOUT_TEST=90
CMD_TIMEOUT_LINT=60

# ── Helpers ────────────────────────────────────────────────────────────────────

# Validate that a PID belongs to a verify/bash pipeline (not a recycled PID).
is_verify_pid() {
  local pid="$1"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  local cmdline
  cmdline=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null) || return 1
  [[ "$cmdline" == *bash* ]] || [[ "$cmdline" == *verify* ]]
}

# Kill a pipeline process group synchronously. Waits up to 10s for SIGTERM,
# then SIGKILL. Reaps the zombie so the flock subshell doesn't exit (and
# release the lock) until the pipeline is confirmed dead.
kill_pipeline() {
  local pid="${1:-}"
  [ -n "$pid" ] || return 0

  if is_verify_pid "$pid"; then
    echo "verify: killing pipeline pgid=$pid" >&2
    kill -TERM -"$pid" 2>/dev/null || true
    # Poll up to 10s for the process group to die
    local _wait
    for _wait in $(seq 1 10); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    # Force-kill any survivors
    kill -KILL -"$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi

  rm -f "$PID_FILE" "$LOCK_DIR/verify.holder"
}

# Kill orphaned vitest/node processes scoped to this project only.
# Uses /proc/$pid/cwd to verify project ownership, preventing accidental kills
# of vitest processes from other projects or intentional --watch sessions.
cleanup_stale() {
  # 1. Stale PID file: if the recorded PID is dead, clean up artifacts.
  if [ -f "$PID_FILE" ]; then
    local stale_pid
    stale_pid=$(cat "$PID_FILE" 2>/dev/null || echo "")
    if [ -n "$stale_pid" ] && ! kill -0 "$stale_pid" 2>/dev/null; then
      echo "verify: removing stale PID file (pid=$stale_pid)" >&2
      rm -f "$PID_FILE" "$LOCK_DIR/verify.holder"
    fi
  fi

  # 2. Project-scoped orphan kill: vitest processes older than 5 minutes
  #    whose cwd matches this project.
  local pid
  local stale_pids=()
  for pid in $(pgrep -f "vitest run" --older 300 2>/dev/null || true); do
    if [ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" = "$PROJECT" ]; then
      echo "verify: killing orphaned vitest (pid=$pid, age>300s)" >&2
      kill -TERM "$pid" 2>/dev/null || true
      stale_pids+=("$pid")
    fi
  done
  # Follow up with SIGKILL for any that ignored SIGTERM
  if [ ${#stale_pids[@]} -gt 0 ]; then
    sleep 2
    for pid in "${stale_pids[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        echo "verify: force-killing orphaned vitest (pid=$pid)" >&2
        kill -KILL "$pid" 2>/dev/null || true
      fi
    done
  fi
}

# ── Subcommands ────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--invalidate" ]; then
  rm -f "$CACHE_DIR"/[0-9a-f]* 2>/dev/null
  echo "verify: cache cleared" >&2
  exit 0
fi
if [ "${1:-}" = "--status" ]; then
  echo "=== Slot ===" >&2
  cat "$LOCK_DIR/verify.holder" 2>/dev/null || echo "(free)" >&2
  echo "=== PID ===" >&2
  if [ -f "$PID_FILE" ]; then
    local_pid=$(cat "$PID_FILE" 2>/dev/null || echo "")
    if [ -n "$local_pid" ] && kill -0 "$local_pid" 2>/dev/null; then
      echo "pid=$local_pid (alive)" >&2
    else
      echo "pid=$local_pid (dead/stale)" >&2
    fi
  else
    echo "(no pid file)" >&2
  fi
  echo "=== Orphan scan (project-scoped) ===" >&2
  found=0
  for pid in $(pgrep -f "vitest run" 2>/dev/null || true); do
    if [ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" = "$PROJECT" ]; then
      etime=$(ps -o etimes= -p "$pid" 2>/dev/null | tr -d ' ')
      echo "PID $pid vitest run (${etime}s)" >&2
      found=1
    fi
  done
  [ "$found" -gt 0 ] || echo "(none)" >&2
  echo "=== Cache entries ===" >&2
  find "$CACHE_DIR" -maxdepth 1 -type f -name '[0-9a-f]*' 2>/dev/null | wc -l | xargs -I{} echo "{} entries" >&2
  exit 0
fi

# ── Cache key (hash source files + config + lockfile — excludes .next/) ──────
mkdir -p "$CACHE_DIR" "$LOCK_DIR"
CACHE_KEY=$(cd "$PROJECT" && git ls-files -s \
  src/ prisma/schema.prisma tests/ package.json package-lock.json \
  tsconfig.json tailwind.config.ts postcss.config.js next.config.ts biome.json \
  2>/dev/null | sha256sum | cut -c1-40)

# ── Cache hit? ───────────────────────────────────────────────────────────────
if [ -f "$CACHE_DIR/$CACHE_KEY" ]; then
  echo "verify: cache hit ($CACHE_KEY)" >&2
  exit 0
fi

# ── Count-based cache cleanup (keep 20 most recent entries) ──────────────────
find "$CACHE_DIR" -maxdepth 1 -type f -name '[0-9a-f]*' -printf '%T@ %p\n' 2>/dev/null \
  | sort -rn | tail -n +21 | cut -d' ' -f2- | xargs -r rm -f

# ── Stale process cleanup (runs before lock acquisition) ─────────────────────
cleanup_stale

echo "verify: cache miss, acquiring lock ($AGENT)..." >&2

# ── Acquire flock and run ────────────────────────────────────────────────────
(
  flock -w "$TTL" 9 || {
    echo "verify: timeout waiting for lock after ${TTL}s" >&2
    # If we timed out, the holder may be stuck. Try to kill it.
    if [ -f "$PID_FILE" ]; then
      stale_pid=$(cat "$PID_FILE" 2>/dev/null || echo "")
      if [ -n "$stale_pid" ]; then
        echo "verify: killing stale holder (pid=$stale_pid)" >&2
        kill_pipeline "$stale_pid"
      fi
    fi
    exit 1
  }

  # Re-check cache (another agent filled it while we waited)
  if [ -f "$CACHE_DIR/$CACHE_KEY" ]; then
    echo "verify: cache hit after wait ($CACHE_KEY)" >&2
    exit 0
  fi

  # Write holder info for observability
  echo "$AGENT $$ $(date -Iseconds)" > "$LOCK_DIR/verify.holder"

  echo "verify: lock acquired, running suite..." >&2
  cd "$PROJECT"

  # Ensure Docker services are running
  if ! docker compose ps --status running 2>/dev/null | grep -q postgres; then
    echo "verify: starting Docker services..." >&2
    docker compose up -d --wait 2>/dev/null || true
  fi

  # Trap reads PID from file (not $!), because setsid forks a child whose
  # PID differs from the setsid wrapper PID that $! captures.
  # Registered BEFORE launching pipeline to close the signal-race window.
  # shellcheck disable=SC2329  # invoked via trap
  cleanup_on_exit() {
    if [ -f "$PID_FILE" ]; then
      local pgid
      pgid=$(cat "$PID_FILE" 2>/dev/null || echo "")
      kill_pipeline "$pgid"
    fi
    # Also kill the setsid wrapper if still alive
    [ -n "${SETSID_PID:-}" ] && kill "$SETSID_PID" 2>/dev/null || true
  }
  trap cleanup_on_exit EXIT TERM INT HUP

  # Run pipeline in a new process group via setsid so kill -PGID
  # reaches all children (vitest workers, tsc, node, etc.).
  # --wait makes setsid block until the child exits (so `wait $!` works)
  # and propagate the child's exit code.
  # shellcheck disable=SC2016
  setsid --wait bash -c '
    echo $$ > "'"$PID_FILE"'"
    cd "'"$PROJECT"'"

    run_step() {
      local label="$1" code="$2" secs="$3"
      shift 3
      echo "verify: [$label] starting..." >&2
      local t_start; t_start=$(date +%s)
      if timeout -k 10 "$secs" "$@"; then
        local elapsed=$(( $(date +%s) - t_start ))
        echo "verify: [$label] done (${elapsed}s)" >&2
      else
        local rc=$?
        local elapsed=$(( $(date +%s) - t_start ))
        if [ "$rc" -eq 124 ]; then
          echo "verify: [$label] TIMEOUT after ${secs}s" >&2
          exit 15
        else
          echo "verify: [$label] FAILED (exit $rc, ${elapsed}s)" >&2
          exit "$code"
        fi
      fi
    }

    if [ -f prisma/schema.prisma ]; then
      run_step prisma-generate 10 '"$CMD_TIMEOUT_PRISMA"' npx prisma generate
    fi
    run_step npm-build       11 '"$CMD_TIMEOUT_BUILD"' npm run build
    run_step tsc             12 '"$CMD_TIMEOUT_TSC"'   npx tsc --noEmit
    run_step npm-test        13 '"$CMD_TIMEOUT_TEST"'  npm test
    run_step npm-lint        14 '"$CMD_TIMEOUT_LINT"'  npm run lint
  ' &

  SETSID_PID=$!

  # Wait for setsid --wait (which blocks until pipeline exits)
  if wait "$SETSID_PID"; then
    # Disarm trap on success
    trap - EXIT TERM INT HUP
    rm -f "$PID_FILE" "$LOCK_DIR/verify.holder"

    # Write cache inside the lock so waiters see it immediately
    touch "$CACHE_DIR/$CACHE_KEY"
    echo "verify: pass, cached ($CACHE_KEY)" >&2
  else
    PIPELINE_EXIT=$?
    # Trap will fire on subshell exit and clean up
    echo "verify: pipeline failed (exit $PIPELINE_EXIT)" >&2
    exit "$PIPELINE_EXIT"
  fi
) 9>"$LOCK_FILE"
