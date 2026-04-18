# Zeemish v2 — Runbook

How to run, deploy, operate, and troubleshoot. Written for a developer who just cloned the repo.

> **URLs:** The site lives at `https://zeemish.io` (custom domain bound to the `zeemish-v2` worker). The workers.dev URL `https://zeemish.io` is still active as a fallback but no longer the canonical entrypoint. The agents worker remains on `https://zeemish-agents.zzeeshann.workers.dev` — internal API, not user-facing.

## Prerequisites
- Node.js 20+
- pnpm (`npm install -g pnpm`)
- wrangler (`npm install -g wrangler`, then `wrangler login`)

## Run locally

### Site (Astro)
```bash
cd zeemish-v2
pnpm install
pnpm dev
# Open http://localhost:4321
```

### Agents worker
```bash
cd agents
pnpm install
pnpm dev
# Runs at http://localhost:8787
```

## Build for production
```bash
pnpm build
# Output in dist/
```

## Deploy

### Site
```bash
pnpm build
wrangler deploy
# Deploys to https://zeemish.io (workers.dev URL still active as fallback)
```
Also auto-deploys on every push to `main` via GitHub Actions.

### Agents
```bash
cd agents
wrangler deploy
# Deploys to https://zeemish-agents.zzeeshann.workers.dev
```
Also auto-deploys on every push to `main` via GitHub Actions (same as site).

## Secrets

### Site worker
```bash
wrangler secret put ANTHROPIC_API_KEY    # For Zita chat
wrangler secret put AGENTS_ADMIN_SECRET  # For dashboard trigger proxy
wrangler secret put RESEND_API_KEY       # For magic link emails
wrangler secret put ADMIN_EMAIL          # For admin dashboard access
```

### Agents worker
```bash
cd agents
wrangler secret put ANTHROPIC_API_KEY   # For Claude API calls
wrangler secret put GITHUB_TOKEN        # For Publisher commits
wrangler secret put ELEVENLABS_API_KEY  # For Audio-Producer TTS
wrangler secret put ADMIN_SECRET        # For trigger endpoint auth
```

### Optional agents-worker settings
```bash
# Override Scanner's RSS feed list without a redeploy.
# Shape: {"CATEGORY": "https://feed.url/...", ...}
# Malformed JSON falls back to the hardcoded defaults in scanner.ts.
wrangler secret put SCANNER_RSS_FEEDS_JSON
```

## D1 Database

### Run migrations
There are 10 migrations (`0001_init.sql` … `0010_audio_pipeline.sql`).
Run them in order on a fresh database:
```bash
for f in migrations/*.sql; do
  wrangler d1 execute zeemish --remote --file="$f"
done

# Check what's in the database
wrangler d1 execute zeemish --remote --command="SELECT name FROM sqlite_master WHERE type='table'"
```

### Query the database
```bash
wrangler d1 execute zeemish --remote --command="SELECT * FROM users LIMIT 5"
wrangler d1 execute zeemish --remote --command="SELECT * FROM observer_events ORDER BY created_at DESC LIMIT 10"
```

## Trigger a daily piece

Daily pieces are the only content type. The manual trigger and the
scheduled run use the same `/daily-trigger` endpoint.

### Via curl (requires ADMIN_SECRET)
```bash
curl -X POST "https://zeemish-agents.zzeeshann.workers.dev/daily-trigger" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
```

### Via dashboard
Visit https://zeemish.io/dashboard/admin/ and use
the trigger button (requires ADMIN_EMAIL login).

### Automatic
The Director runs every day at 2:00 AM UTC (including weekends). It
scans news, picks the most teachable story, drafts, audits, and
publishes. Piece is ready by ~4:00 AM UTC. If the news is thin (rare,
but possible on quiet weekends), Curator's skip path logs "No teachable
stories" via Observer and the day is left blank.

### Check Director status
```bash
# /status requires auth — it's an admin endpoint
curl "https://zeemish-agents.zzeeshann.workers.dev/status" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
```

### View daily pieces
- Archive: https://zeemish.io/daily/
- Single piece: https://zeemish.io/daily/YYYY-MM-DD/

## Reset today (clean slate for a dev-mode re-test)

"One piece per day" is the product (see `docs/DECISIONS.md` — 2026-04-17
entry on this). The admin manual trigger bypasses the duplicate-publish
guard so you can test end-to-end during development, but that can leave
duplicate state from multiple runs.

### One command
```bash
export ADMIN_SECRET="..."   # same as AGENTS_ADMIN_SECRET
./scripts/reset-today.sh
```
The script does the three steps below (git rm + D1 clear + trigger) in
order, pushes the cleanup commit, and prints the run's HTTP status.
Runs in under a minute including the push wait. See
`scripts/reset-today.sh` for what it actually executes.

### Verify
- Pipeline monitor on `/dashboard/admin/` shows step-by-step progress
- Public pipeline data: `curl /api/dashboard/pipeline` (no auth)
- Single piece in D1 after completion: `curl /api/dashboard/today` (no auth)
- Live URL: `/daily/YYYY-MM-DD/` should return 200 after the post-publish deploy completes (~30s)

### Manual fallback (if the script misbehaves)
#### 1. Remove today's MDX file(s) from git
```bash
git rm content/daily-pieces/$(date -u +%Y-%m-%d)-*.mdx
git commit -m "test: reset for pipeline re-test"
git push
# Wait ~30s for auto-deploy to strip them from the live site
```

#### 2. Clear today's D1 rows across all 5 tables
```bash
DATE=$(date -u +%Y-%m-%d)
npx wrangler d1 execute zeemish --remote --command \
  "DELETE FROM daily_pieces WHERE date = '$DATE'; \
   DELETE FROM daily_candidates WHERE date = '$DATE'; \
   DELETE FROM daily_piece_audio WHERE date = '$DATE'; \
   DELETE FROM pipeline_log WHERE run_id = '$DATE'; \
   DELETE FROM audit_results WHERE task_id LIKE 'daily/$DATE%'; \
   DELETE FROM observer_events WHERE created_at >= (strftime('%s','now','start of day') * 1000);"
```
Note: `observer_events` uses an epoch-ms `created_at` timestamp (not a
date string), so the cutoff is computed inside SQL with
`strftime(...,'start of day')`. A prior version of this runbook used a
shell `DATE_MS` formula that reused the current time-of-day on macOS
BSD `date`, leaving morning-run events behind after an afternoon
reset. If you forget this table, the admin dashboard Observer feed
still shows earlier "Published: …" events even after the underlying
pieces are deleted — accurate history but visually confusing during a
reset.

#### 3. Trigger a fresh run
Either press "Trigger Daily Piece" on `/dashboard/admin/`, or curl as above.

## Check what agents have been doing
All three endpoints are admin-only and require `ADMIN_SECRET`.
```bash
# Last 24 hours digest
curl "https://zeemish-agents.zzeeshann.workers.dev/digest" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"

# Recent events
curl "https://zeemish-agents.zzeeshann.workers.dev/events?limit=10" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"

# Engagement report
curl "https://zeemish-agents.zzeeshann.workers.dev/engagement?course=daily" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
```

### What to watch for on a fresh run
- `severity: 'info'`, title `Published: …` — the happy path
- `severity: 'escalation'`, title `Escalation: …` — failed 3 revision rounds
- `severity: 'warn'`, title `Error: fact-check` — web search (DuckDuckGo)
  was unreachable, so fact-checking used Claude's first-pass assessment
  only. Pipeline continued, but unverified claims may have slipped past.
  Worth re-running or spot-checking the piece.

## Dashboard API endpoints (site worker)
```bash
# Public (no auth):
GET /api/dashboard/today      # Today's pipeline status + scores
GET /api/dashboard/recent     # Last 7 pieces
GET /api/dashboard/stats      # Library counters

# Admin only (ADMIN_EMAIL):
GET  /api/dashboard/analytics # Engagement data
GET  /api/dashboard/observer  # Observer events
POST /api/dashboard/observer  # Acknowledge event { eventId }
```

## Audio — retry, troubleshooting, cost

### Retry audio for a piece
If an audio phase failed (observer escalation titled `Audio failure: …`), visit `/dashboard/admin/piece/{date}/` and press **Retry audio**. That proxies to `POST /audio-retry?date={date}` on the agents worker, which re-reads the committed MDX from GitHub and re-runs Producer → Auditor → publishAudio. Idempotent: R2 head-check skips already-generated beats; `INSERT OR REPLACE` refreshes rows; `publishAudio` detects identical content and returns without a new commit.

Via curl:
```bash
curl -X POST "https://zeemish-agents.zzeeshann.workers.dev/audio-retry?date=2026-04-18" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
```

### Audio failure modes — what Observer will say
- **"Audio failure: {title}"** phase `producer` + reason "Over 20000-char cap…" — piece is longer than the budget. Shorten the piece (trim beats) or bump `CHAR_CAP` in `audio-producer.ts`.
- **"Audio failure: {title}"** phase `producer` + reason "ElevenLabs 401/403" — bad/expired `ELEVENLABS_API_KEY`. Rotate it via `wrangler secret put`.
- **"Audio failure: {title}"** phase `producer` + reason "ElevenLabs 429" — concurrency or rate limit. Wait and retry. If recurring, upgrade the ElevenLabs plan tier.
- **"Audio failure: {title}"** phase `auditor` + reason "Audio file missing in R2…" — producer wrote a row but R2 put silently failed (rare). Retry.
- **"Audio failure: {title}"** phase `auditor` + reason "Audio suspiciously small…" — truncated download. Retry.
- **"Audio failure: {title}"** phase `publisher` + reason "GitHub API error…" — token expired or repo write permissions changed. Check `GITHUB_TOKEN`.

### Cost monitoring
`daily_piece_audio.character_count` is the source of truth for ElevenLabs spend. At $0.10 / 1k chars on pay-as-you-go:
```bash
# Chars used in the last 30 days
npx wrangler d1 execute zeemish --remote --command \
  "SELECT SUM(character_count) as chars FROM daily_piece_audio WHERE date >= date('now', '-30 day');"

# Chars used today
npx wrangler d1 execute zeemish --remote --command \
  "SELECT COALESCE(SUM(character_count), 0) as chars FROM daily_piece_audio WHERE date = date('now');"
```

### Force-regenerate one beat's audio
(Rare — normally covered by the retry flow above.) Delete the R2 object + row, then retry:
```bash
# Delete from R2 (set BUCKET to zeemish-audio)
npx wrangler r2 object delete zeemish-audio/audio/daily/2026-04-18/hook.mp3

# Delete the row
npx wrangler d1 execute zeemish --remote --command \
  "DELETE FROM daily_piece_audio WHERE date = '2026-04-18' AND beat_name = 'hook';"

# Retry
curl -X POST "https://zeemish-agents.zzeeshann.workers.dev/audio-retry?date=2026-04-18" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
```

## Revert a bad publish
The PublisherAgent commits directly to `main`. To revert:
```bash
git log --oneline | head -10           # Find the bad commit
git revert <commit-sha>                # Creates a revert commit
git push                               # Triggers auto-deploy
```

## Add a daily piece manually
Create an MDX file at `content/daily-pieces/YYYY-MM-DD-{slug}.mdx`:
```yaml
---
title: "How interest rates actually work"
date: "2026-04-17"
newsSource: "Reuters"
underlyingSubject: "monetary policy"
estimatedTime: "10 min"
beatCount: 5
description: "The ECB just cut rates. Here's what that means."
---

<lesson-shell>
<lesson-beat name="hook">
Your hook text here.
</lesson-beat>
<!-- more beats -->
</lesson-shell>
```
Then commit and push — GitHub Actions rebuilds and deploys the site
automatically. Don't `wrangler deploy` locally without committing, as
the next auto-deploy will rebuild from `main` and strip the
uncommitted file.

## Project structure
```
zeemish-v2/
├── src/                    Astro site (pages, components, layouts)
│   ├── pages/              Routes (index, daily, library, account, login, dashboard, API)
│   ├── components/         Astro components (AudioPlayer)
│   ├── layouts/            BaseLayout, LessonLayout
│   ├── interactive/        Web Components (lesson-shell, lesson-beat, zita-chat)
│   ├── lib/                Auth + DB helpers
│   ├── styles/             Global CSS
│   └── middleware.ts       Anonymous auth middleware
├── content/                MDX content
│   ├── daily-pieces/       Daily teaching pieces (YYYY-MM-DD-slug.mdx)
│   ├── voice-contract.md   Voice rules for agents
│   └── subject-values.json Subject priorities
├── agents/                 Separate Cloudflare Worker
│   ├── src/                Agent code (13 agents, one file each)
│   └── wrangler.toml       Agent worker config
├── migrations/             D1 schema migrations
├── docs/                   Living documentation
│   ├── handoff/            Original architecture docs
│   ├── ARCHITECTURE.md     What's built vs. planned
│   ├── AGENTS.md           Agent documentation
│   ├── SCHEMA.md           D1 database schema
│   ├── DECISIONS.md        Technical decision log
│   └── RUNBOOK.md          This file
├── .github/workflows/      CI/CD
├── CLAUDE.md               Context for Claude Code sessions
└── wrangler.toml           Site worker config
```
