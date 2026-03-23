#!/bin/bash
# Pre-flight for PROMPT_build.md — deterministic, no inference needed.
# Outputs structured JSON for the agent to consume.
set -euo pipefail

PROJECT="/home/gulp/projects/enterprise-vibecoding/twitter-clone-openspec"
cd "$PROJECT"

# ── Pane identity (static config, not runtime state) ─────────────────────
PANE="${WEZTERM_PANE:-}"
AGENT_NAME=""
COORDINATOR=$(jq -r '.["0"] // empty' .claude/agent-panes.json 2>/dev/null || true)
if [ -n "$PANE" ] && [ -f .claude/agent-panes.json ]; then
  AGENT_NAME=$(jq -r --arg p "$PANE" '.[$p] // empty' .claude/agent-panes.json 2>/dev/null || true)
fi
if [ -z "$AGENT_NAME" ]; then
  jq -n --arg pane "$PANE" '{"error":"No agent name for pane","pane":$pane}'
  exit 1
fi

# ── Integrity check ───────────────────────────────────────────────────────
CLAUDE_LINES=$(wc -l < CLAUDE.md 2>/dev/null || echo 0)
if [ "$CLAUDE_LINES" -lt 20 ]; then
  jq -n --arg lines "$CLAUDE_LINES" '{"error":"CLAUDE.md wiped","lines":($lines|tonumber)}'
  exit 1
fi

# ── Git sync ──────────────────────────────────────────────────────────────
git pull --ff-only 2>/dev/null || true
mkdir -p .verify-cache

# ── Agent mail registration ───────────────────────────────────────────────
export DATABASE_URL="sqlite:////home/gulp/projects/mcp_agent_mail_rust/storage.sqlite3"
SESSION=$(am macros start-session \
  --project "$PROJECT" \
  --program claude-code \
  --model loop \
  --agent-name "$AGENT_NAME" \
  --json 2>/dev/null || echo '{}')

PROJECT_SLUG=$(echo "$SESSION" | jq -r '.project.slug // empty')
INBOX=$(echo "$SESSION" | jq -c '.inbox // []')

# ── Triage + ready ────────────────────────────────────────────────────────
TRIAGE=$(bv --robot-triage 2>/dev/null | jq -c '.triage.quick_ref' || echo '{}')
READY=$(br ready --json 2>/dev/null | jq -c '[.[] | {id, title, priority}]' || echo '[]')

# ── Output ────────────────────────────────────────────────────────────────
jq -n \
  --arg agent "$AGENT_NAME" \
  --arg pane "$PANE" \
  --arg project "$PROJECT" \
  --arg project_slug "${PROJECT_SLUG:-home-gulp-projects-enterprise-vibecoding-twitter-clone-openspec}" \
  --arg coordinator "$COORDINATOR" \
  --argjson inbox "$INBOX" \
  --argjson triage "$TRIAGE" \
  --argjson ready "$READY" \
  '{agent: $agent, pane: $pane, project: $project, project_slug: $project_slug, coordinator: $coordinator, inbox: $inbox, triage: $triage, ready: $ready}'
