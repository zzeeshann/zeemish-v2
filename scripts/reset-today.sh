#!/usr/bin/env bash
#
# reset-today.sh — wipe today's daily piece and trigger a fresh pipeline run.
#
# What it does (in order):
#   1. git rm today's MDX file(s), commit, push  (auto-deploy strips them live)
#   2. DELETE today's rows from the 5 D1 tables that track a daily run
#   3. POST /daily-trigger on the agents worker so the pipeline runs again
#
# Requires:
#   - git checkout of zeemish-v2 at the repo root (script figures out its path)
#   - wrangler authenticated for the 'zeemish' D1 database
#   - ADMIN_SECRET env var (the AGENTS_ADMIN_SECRET value)
#
# Usage:
#   ADMIN_SECRET=sk_... ./scripts/reset-today.sh
#
# Why a script instead of the 3-step manual procedure in RUNBOOK:
#   The manual procedure is correct but easy to get wrong (wrong date format,
#   forgetting observer_events' epoch-ms cutoff, etc). Zishan asked for a
#   single command during dev iteration. This is that command.

set -euo pipefail

# ── config ───────────────────────────────────────────────────────────
AGENTS_URL="${AGENTS_URL:-https://zeemish-agents.zzeeshann.workers.dev}"
DATE="$(date -u +%Y-%m-%d)"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ -z "${ADMIN_SECRET:-}" ]]; then
  echo "✗ ADMIN_SECRET env var not set — source it from your secrets manager." >&2
  echo "  Example: export ADMIN_SECRET=\$(wrangler secret list ... )" >&2
  exit 1
fi

echo "Reset-today: $DATE"
echo "Repo: $REPO_ROOT"
echo "Agents: $AGENTS_URL"
echo ""

# ── step 1: git rm today's MDX ───────────────────────────────────────
echo "[1/3] Removing today's MDX file(s) from git..."
shopt -s nullglob
mdx_files=(content/daily-pieces/"$DATE"-*.mdx)
shopt -u nullglob

if [[ ${#mdx_files[@]} -eq 0 ]]; then
  echo "      (no MDX for $DATE — skipping)"
else
  for f in "${mdx_files[@]}"; do
    echo "      - $f"
    git rm "$f"
  done
  git commit -m "test: reset $DATE for pipeline re-test"
  git push
  echo "      Pushed. Auto-deploy will strip them live within ~30s."
fi
echo ""

# ── step 2: clear D1 rows ────────────────────────────────────────────
echo "[2/3] Clearing D1 rows for $DATE across 5 tables..."
# Note: observer_events.created_at is epoch-ms; use strftime in SQL so the
# cutoff is computed inside SQLite (avoids timezone drift from shell 'date').
npx wrangler d1 execute zeemish --remote --command \
  "DELETE FROM daily_pieces WHERE date = '$DATE'; \
   DELETE FROM daily_candidates WHERE date = '$DATE'; \
   DELETE FROM pipeline_log WHERE run_id = '$DATE'; \
   DELETE FROM audit_results WHERE task_id LIKE 'daily/$DATE%'; \
   DELETE FROM observer_events WHERE created_at >= (strftime('%s','now','start of day') * 1000);"
echo ""

# ── step 3: trigger a fresh pipeline run ─────────────────────────────
echo "[3/3] Triggering fresh pipeline run..."
http_status=$(curl -sS -o /tmp/reset-today-response.json -w "%{http_code}" \
  -X POST "$AGENTS_URL/daily-trigger" \
  -H "Authorization: Bearer $ADMIN_SECRET")

echo "      HTTP $http_status"
echo "      Response: $(cat /tmp/reset-today-response.json)"
echo ""

if [[ "$http_status" != "202" && "$http_status" != "200" ]]; then
  echo "✗ Trigger failed." >&2
  exit 1
fi

echo "✓ Done. Watch progress at:"
echo "    https://zeemish-v2.zzeeshann.workers.dev/dashboard/admin/"
echo "  Or curl:"
echo "    curl -s https://zeemish-v2.zzeeshann.workers.dev/api/dashboard/pipeline"
