#!/usr/bin/env bats
# Tests for scripts/verify.sh process isolation and cleanup.
#
# These tests validate the hardened verify pipeline: process group management,
# stale cleanup, cache behavior, exit codes, and --status output.

setup() {
  export PROJECT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  export VERIFY="$PROJECT/scripts/verify.sh"

  # Use a temporary cache dir so tests don't pollute real cache
  export TEST_CACHE_DIR="$(mktemp -d)"
  export TEST_LOCK_DIR="$TEST_CACHE_DIR/locks"
  mkdir -p "$TEST_LOCK_DIR"
}

teardown() {
  # Kill any leftover test processes
  if [ -f "$TEST_LOCK_DIR/verify.pid" ]; then
    local pid
    pid=$(cat "$TEST_LOCK_DIR/verify.pid" 2>/dev/null || echo "")
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -KILL -"$pid" 2>/dev/null || true
    fi
  fi
  rm -rf "$TEST_CACHE_DIR"
}

# ── --status subcommand ────────────────────────────────────────────────────────

@test "--status shows free slot when no holder" {
  run bash -c '"'"$VERIFY"'" --status 2>&1'
  [[ "$output" == *"(free)"* ]]
  [[ "$output" == *"(no pid file)"* ]]
  [[ "$output" == *"(none)"* ]]
}

@test "--status shows holder info when holder file exists" {
  # Write a holder file into the real lock dir
  mkdir -p "$PROJECT/.verify-cache/locks"
  echo "TestAgent 12345 2026-01-01T00:00:00+00:00" > "$PROJECT/.verify-cache/locks/verify.holder"

  run bash -c '"'"$VERIFY"'" --status 2>&1'
  [[ "$output" == *"TestAgent"* ]]

  # Clean up
  rm -f "$PROJECT/.verify-cache/locks/verify.holder"
}

@test "--status shows cache entry count" {
  run bash -c '"'"$VERIFY"'" --status 2>&1'
  # Output must contain a number followed by "entries"
  [[ "$output" =~ [0-9]+\ entries ]]
}

# ── --invalidate subcommand ────────────────────────────────────────────────────

@test "--invalidate clears cache" {
  run bash -c '"'"$VERIFY"'" --invalidate 2>&1'
  [ "$status" -eq 0 ]
  [[ "$output" == *"cache cleared"* ]]
}

# ── Cache behavior ─────────────────────────────────────────────────────────────

@test "cache hit exits 0 immediately" {
  # Compute the real cache key and pre-populate it
  CACHE_KEY=$(cd "$PROJECT" && git ls-files -s \
    src/ prisma/schema.prisma tests/ package.json package-lock.json \
    tsconfig.json tailwind.config.ts postcss.config.js next.config.ts biome.json \
    2>/dev/null | sha256sum | cut -c1-40)
  mkdir -p "$PROJECT/.verify-cache"
  touch "$PROJECT/.verify-cache/$CACHE_KEY"

  run bash -c '"'"$VERIFY"'" test-agent 2>&1'
  [ "$status" -eq 0 ]
  [[ "$output" == *"cache hit"* ]]
}

# ── Helper function unit tests ─────────────────────────────────────────────────

@test "is_verify_pid returns 1 for nonexistent PID" {
  run bash -c '
    source <(sed -n "/^is_verify_pid/,/^}/p" "'"$VERIFY"'")
    is_verify_pid 999999999
  '
  [ "$status" -ne 0 ]
}

@test "is_verify_pid returns 0 for own bash process" {
  run bash -c '
    source <(sed -n "/^is_verify_pid/,/^}/p" "'"$VERIFY"'")
    is_verify_pid $$
  '
  [ "$status" -eq 0 ]
}

# ── Process group cleanup ─────────────────────────────────────────────────────

@test "setsid pipeline children are killed when parent is terminated" {
  # Start a long-running setsid process group, similar to verify.sh's pipeline
  setsid bash -c '
    echo $$ > "'"$TEST_LOCK_DIR"'/test.pid"
    sleep 300 &
    sleep 300 &
    wait
  ' &
  local parent=$!
  sleep 1

  # Verify the setsid process is running
  local setsid_pid
  setsid_pid=$(cat "$TEST_LOCK_DIR/test.pid" 2>/dev/null)
  [ -n "$setsid_pid" ]
  kill -0 "$setsid_pid" 2>/dev/null

  # Kill the process group (same as kill_pipeline does)
  kill -TERM -"$setsid_pid" 2>/dev/null || true
  sleep 2

  # Verify all children are dead
  run kill -0 "$setsid_pid"
  [ "$status" -ne 0 ]
}

@test "cleanup_stale removes dead PID file" {
  # Write a PID file with a definitely-dead PID
  echo "999999999" > "$TEST_LOCK_DIR/verify.pid"
  echo "StaleAgent 999999999 2026-01-01" > "$TEST_LOCK_DIR/verify.holder"

  # Extract and run cleanup_stale
  bash -c '
    PROJECT="'"$PROJECT"'"
    PID_FILE="'"$TEST_LOCK_DIR"'/verify.pid"
    LOCK_DIR="'"$TEST_LOCK_DIR"'"
    source <(sed -n "/^cleanup_stale/,/^}/p" "'"$VERIFY"'")
    cleanup_stale
  '

  # PID file should be removed
  [ ! -f "$TEST_LOCK_DIR/verify.pid" ]
  [ ! -f "$TEST_LOCK_DIR/verify.holder" ]
}

# ── Count-based cache cleanup ──────────────────────────────────────────────────

@test "cache cleanup keeps only 20 most recent entries" {
  mkdir -p "$TEST_CACHE_DIR"
  # Create 25 fake cache entries with staggered mtimes
  for i in $(seq 1 25); do
    f="$TEST_CACHE_DIR/$(printf '%040x' "$i")"
    touch "$f"
    # Ensure distinct mtime ordering
    touch -d "2026-01-01 00:00:$(printf '%02d' "$i")" "$f" 2>/dev/null || true
  done

  # Run the cleanup logic (mirrors verify.sh's find -printf approach)
  find "$TEST_CACHE_DIR" -maxdepth 1 -type f -name '[0-9a-f]*' -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn | tail -n +21 | cut -d' ' -f2- | xargs -r rm -f

  local count
  count=$(find "$TEST_CACHE_DIR" -maxdepth 1 -type f -name '[0-9a-f]*' 2>/dev/null | wc -l)
  [ "$count" -eq 20 ]
}

# ── Exit code mapping ─────────────────────────────────────────────────────────

@test "run_step returns correct exit code on failure" {
  run bash -c '
    run_step() {
      local label="$1" code="$2" secs="$3"
      shift 3
      if timeout -k 10 "$secs" "$@"; then
        echo "done"
      else
        local rc=$?
        if [ "$rc" -eq 124 ]; then
          exit 15
        else
          exit "$code"
        fi
      fi
    }
    run_step "test-fail" 13 5 false
  '
  [ "$status" -eq 13 ]
}

@test "run_step returns 15 on timeout" {
  run bash -c '
    run_step() {
      local label="$1" code="$2" secs="$3"
      shift 3
      if timeout -k 10 "$secs" "$@"; then
        echo "done"
      else
        local rc=$?
        if [ "$rc" -eq 124 ]; then
          exit 15
        else
          exit "$code"
        fi
      fi
    }
    run_step "test-timeout" 13 1 sleep 30
  '
  [ "$status" -eq 15 ]
}
