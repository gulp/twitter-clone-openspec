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
#   --status      Show slot holder and cache stats
set -euo pipefail

AGENT="${1:-${AGENT_NAME:-anonymous}}"
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE_DIR="$PROJECT/.verify-cache"
LOCK_DIR="$CACHE_DIR/locks"
LOCK_FILE="$LOCK_DIR/verify.lock"
TTL=300

# ── Subcommands ──────────────────────────────────────────────────────────────
if [ "${1:-}" = "--invalidate" ]; then
  rm -f "$CACHE_DIR"/[0-9a-f]* 2>/dev/null
  echo "verify: cache cleared" >&2
  exit 0
fi
if [ "${1:-}" = "--status" ]; then
  echo "=== Slot ===" >&2
  cat "$LOCK_DIR/verify.holder" 2>/dev/null || echo "(free)" >&2
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

# ── Clean stale cache entries (older than 1 hour) ────────────────────────────
find "$CACHE_DIR" -maxdepth 1 -type f ! -name '.gitignore' -mmin +60 -delete 2>/dev/null || true

echo "verify: cache miss, acquiring lock ($AGENT)..." >&2

# ── Acquire flock and run ────────────────────────────────────────────────────
(
  flock -w "$TTL" 9 || { echo "verify: timeout waiting for lock" >&2; exit 1; }

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

  # Pipeline: generate → build → typecheck → test → lint
  # Guard: only run prisma generate if schema exists
  if [ -f prisma/schema.prisma ]; then
    npx prisma generate
  fi
  npm run build && \
  npx tsc --noEmit && \
  npm test && \
  npm run lint

  # Write cache inside the lock so waiters see it immediately
  touch "$CACHE_DIR/$CACHE_KEY"
  rm -f "$LOCK_DIR/verify.holder"
  echo "verify: pass, cached ($CACHE_KEY)" >&2
) 9>"$LOCK_FILE"
