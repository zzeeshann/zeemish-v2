#!/usr/bin/env bash
#
# seed-categories.sh — Area 2 sub-task 2.3.
#
# One-time backfill: invoke CategoriserAgent against every published
# daily piece, oldest first. Idempotent on pieces that already have
# piece_categories rows (the agent short-circuits with skipped=true).
#
# Why oldest first: Categoriser is strongly biased toward reusing
# existing categories. Running the earliest pieces first lets the
# initial taxonomy form from real pieces; later pieces see that
# taxonomy and mostly reuse rather than proliferate.
#
# Why sequential (not parallel): Piece A's categorisation needs to
# commit to the `categories` table before Piece B's categoriser reads
# the list — otherwise each piece fires against a fresh taxonomy and
# the reuse-bias collapses into novelty-every-piece. Script polls
# `piece_categories` for each piece's completion before firing the
# next.
#
# Usage:
#   ADMIN_SECRET=sk_... ./scripts/seed-categories.sh
#
# Optional:
#   DRY_RUN=1  — print what would be categorised, fire nothing.
#   AGENTS_URL=... — override the agents worker URL (defaults to prod).
#
# Safety:
#   - Idempotent. Re-running is safe; already-categorised pieces are
#     skipped at the agent layer (no Claude call, no writes).
#   - Non-destructive. Script only INSERTs category assignments via
#     the agent; it does not DELETE or mutate `daily_pieces`,
#     `categories` (except as the agent creates new rows), or
#     `piece_categories` (except as the agent writes new rows).

set -euo pipefail

AGENTS_URL="${AGENTS_URL:-https://zeemish-agents.zzeeshann.workers.dev}"
DRY_RUN="${DRY_RUN:-0}"
POLL_TIMEOUT_SECONDS=90
POLL_INTERVAL_SECONDS=3

if [[ "$DRY_RUN" != "1" && -z "${ADMIN_SECRET:-}" ]]; then
  echo "✗ ADMIN_SECRET env var not set (required unless DRY_RUN=1)" >&2
  echo "  Example: export ADMIN_SECRET=\$(wrangler secret list ...)" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "seed-categories — Area 2 sub-task 2.3"
echo "Agents: $AGENTS_URL"
[[ "$DRY_RUN" == "1" ]] && echo "Mode: DRY RUN (no HTTP calls)"
echo ""

# ── Pull every piece, oldest first ──────────────────────────────────
echo "[1/3] Fetching published pieces ordered by published_at ASC..."
pieces_json=$(npx wrangler d1 execute zeemish --remote --json --command \
  "SELECT id, date, headline, published_at FROM daily_pieces ORDER BY published_at ASC, date ASC" 2>/dev/null)

# Parse the wrangler JSON envelope with node — same pattern as
# reset-today.sh. Emit one line per piece: "id|date|headline".
read -r -d '' NODE_SCRIPT <<'EOF' || true
const fs = require('fs');
const env = JSON.parse(fs.readFileSync(0, 'utf8'));
const rows = env[0]?.results ?? [];
for (const r of rows) {
  // Escape pipes in headlines so the shell split stays clean.
  const headline = String(r.headline ?? '').replace(/\|/g, '/');
  process.stdout.write(`${r.id}|${r.date}|${headline}\n`);
}
EOF
pieces=$(echo "$pieces_json" | node -e "$NODE_SCRIPT")
total=$(echo "$pieces" | grep -c '^' || true)

if [[ "$total" -eq 0 ]]; then
  echo "      (no published pieces — nothing to do)"
  exit 0
fi

echo "      $total piece(s) to consider."
echo ""

# ── Iterate oldest → newest, firing categoriser per piece ────────────
echo "[2/3] Firing categoriser per piece (sequential, oldest first)..."
echo ""

index=0
fired=0
skipped=0
failed=0

while IFS='|' read -r piece_id piece_date headline; do
  index=$((index + 1))
  [[ -z "$piece_id" ]] && continue

  # Idempotence pre-check at the SQL layer — saves a round-trip to the
  # agent when we already know the piece is done. (The agent also
  # checks internally; this is just a nicer progress print.)
  existing_count=$(npx wrangler d1 execute zeemish --remote --json --command \
    "SELECT COUNT(*) AS n FROM piece_categories WHERE piece_id = '$piece_id'" 2>/dev/null \
    | node -e "const e=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(e[0]?.results?.[0]?.n ?? 0));")

  if [[ "$existing_count" -gt 0 ]]; then
    echo "  [$index/$total] $piece_date — already categorised ($existing_count assignment(s)), skipping."
    skipped=$((skipped + 1))
    continue
  fi

  echo "  [$index/$total] $piece_date — firing categoriser for \"$headline\""
  echo "               piece_id: $piece_id"

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "               (dry run — would POST to /categorise-trigger)"
    continue
  fi

  http_status=$(curl -sS -o /tmp/seed-categories-response.json -w "%{http_code}" \
    -X POST "$AGENTS_URL/categorise-trigger?piece_id=$piece_id" \
    -H "Authorization: Bearer $ADMIN_SECRET")

  if [[ "$http_status" != "202" && "$http_status" != "200" ]]; then
    echo "               ✗ HTTP $http_status — $(cat /tmp/seed-categories-response.json)" >&2
    failed=$((failed + 1))
    continue
  fi

  # Poll piece_categories until this piece has rows OR timeout.
  # Categoriser is an off-pipeline alarm — waitUntil returns 202 immediately,
  # the actual Claude call + DB writes happen asynchronously. Need to
  # wait for completion before firing the next piece so the taxonomy
  # is visible to the next call's SELECT.
  waited=0
  while true; do
    sleep "$POLL_INTERVAL_SECONDS"
    waited=$((waited + POLL_INTERVAL_SECONDS))
    rows=$(npx wrangler d1 execute zeemish --remote --json --command \
      "SELECT COUNT(*) AS n FROM piece_categories WHERE piece_id = '$piece_id'" 2>/dev/null \
      | node -e "const e=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(e[0]?.results?.[0]?.n ?? 0));")
    if [[ "$rows" -gt 0 ]]; then
      # Pull the slug(s) for a one-line summary.
      assigned=$(npx wrangler d1 execute zeemish --remote --json --command \
        "SELECT c.slug, pc.confidence FROM piece_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.piece_id = '$piece_id' ORDER BY pc.confidence DESC" 2>/dev/null \
        | node -e "
          const env = JSON.parse(require('fs').readFileSync(0, 'utf8'));
          const rows = env[0]?.results ?? [];
          process.stdout.write(rows.map(r => r.slug + '@' + r.confidence).join(', '));
        ")
      echo "               ✓ done in ~${waited}s — $assigned"
      fired=$((fired + 1))
      break
    fi
    if [[ "$waited" -ge "$POLL_TIMEOUT_SECONDS" ]]; then
      echo "               ✗ timeout after ${POLL_TIMEOUT_SECONDS}s — piece_categories still empty. Check observer_events." >&2
      failed=$((failed + 1))
      break
    fi
  done

  echo ""
done <<< "$pieces"

# ── Summary ──────────────────────────────────────────────────────────
echo ""
echo "[3/3] Done."
echo "      fired:   $fired"
echo "      skipped: $skipped (already categorised)"
echo "      failed:  $failed"
echo ""
echo "Taxonomy after run:"
npx wrangler d1 execute zeemish --remote --command \
  "SELECT slug, name, piece_count FROM categories ORDER BY piece_count DESC, name ASC" 2>/dev/null

if [[ "$failed" -gt 0 ]]; then
  exit 1
fi
