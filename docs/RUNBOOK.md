# Zeemish v2 — Runbook

How to run, deploy, operate, and troubleshoot. Written for a developer who just cloned the repo.

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
# Deploys to https://zeemish-v2.zzeeshann.workers.dev
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

## D1 Database

### Run migrations
```bash
# Run a migration on remote D1
wrangler d1 execute zeemish --remote --file=migrations/0001_init.sql

# Check what's in the database
wrangler d1 execute zeemish --remote --command="SELECT name FROM sqlite_master WHERE type='table'"
```

### Query the database
```bash
wrangler d1 execute zeemish --remote --command="SELECT * FROM users LIMIT 5"
wrangler d1 execute zeemish --remote --command="SELECT * FROM observer_events ORDER BY created_at DESC LIMIT 10"
```

## Trigger a lesson (agent pipeline)

### Via curl (requires ADMIN_SECRET)
```bash
curl -X POST "https://zeemish-agents.zzeeshann.workers.dev/daily-trigger" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
```

### Via dashboard
Visit https://zeemish-v2.zzeeshann.workers.dev/dashboard/admin/ and use the trigger button (requires ADMIN_EMAIL login).

### Check status
```bash
curl "https://zeemish-agents.zzeeshann.workers.dev/status"
```

## Trigger a daily piece

### Via curl (requires ADMIN_SECRET)
```bash
curl -X POST "https://zeemish-agents.zzeeshann.workers.dev/daily-trigger" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
```

### Automatic
The Director runs daily at 2:00 AM UTC. It scans news, picks the most teachable story, drafts, audits, and publishes. Piece is ready by ~4:00 AM UTC.

### View daily pieces
- Archive: https://zeemish-v2.zzeeshann.workers.dev/daily/
- Single piece: https://zeemish-v2.zzeeshann.workers.dev/daily/YYYY-MM-DD/

## Reset today (clean slate for a dev-mode re-test)

"One piece per day" is the product (see `docs/DECISIONS.md` — 2026-04-17
entry on this). The admin manual trigger bypasses the duplicate-publish
guard so you can test end-to-end during development, but that can leave
duplicate state from multiple runs. To re-test from scratch:

### 1. Remove today's MDX file(s) from git
```bash
git rm content/daily-pieces/$(date -u +%Y-%m-%d)-*.mdx
git commit -m "test: reset for pipeline re-test"
git push
# Wait ~30s for auto-deploy to strip them from the live site
```

### 2. Clear today's D1 rows across all 5 tables
```bash
DATE=$(date -u +%Y-%m-%d)
DATE_MS=$(($(date -u -j -f "%Y-%m-%d" "$DATE" "+%s") * 1000))
npx wrangler d1 execute zeemish --remote --command \
  "DELETE FROM daily_pieces WHERE date = '$DATE'; \
   DELETE FROM daily_candidates WHERE date = '$DATE'; \
   DELETE FROM pipeline_log WHERE run_id = '$DATE'; \
   DELETE FROM audit_results WHERE task_id LIKE 'daily/$DATE%'; \
   DELETE FROM observer_events WHERE created_at >= $DATE_MS;"
```
Note: `observer_events` uses an epoch-ms `created_at` timestamp (not a date
string), which is why it's filtered differently. If you forget this table,
the admin dashboard Observer feed still shows yesterday's "Published: …"
events even after the underlying pieces are deleted — accurate history but
visually confusing during a reset.

### 3. Trigger a fresh run
Either press "Trigger Daily Piece" on `/dashboard/admin/`, or curl as above.

### 4. Verify
- Pipeline monitor on `/dashboard/admin/` shows step-by-step progress
- Public pipeline data: `curl /api/dashboard/pipeline` (no auth)
- Single piece in D1 after completion: `curl /api/dashboard/today` (no auth)
- Live URL: `/daily/YYYY-MM-DD/` should return 200 after the post-publish deploy completes (~30s)

## Check what agents have been doing
```bash
# Last 24 hours digest
curl "https://zeemish-agents.zzeeshann.workers.dev/digest"

# Recent events
curl "https://zeemish-agents.zzeeshann.workers.dev/events?limit=10"

# Engagement report
curl "https://zeemish-agents.zzeeshann.workers.dev/engagement?course=daily" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
```

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
Then `pnpm build && wrangler deploy`.

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
