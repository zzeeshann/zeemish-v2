# Zeemish v2 — Runbook

How to run, deploy, operate, and troubleshoot. Written for a developer who just cloned the repo.

> **URLs:** The site lives at `https://zeemish.io` (custom domain bound to the `zeemish-v2` worker, launched 2026-04-18). The workers.dev URL `https://zeemish-v2.zzeeshann.workers.dev` is still active as a fallback but no longer the canonical entrypoint. The agents worker remains on `https://zeemish-agents.zzeeshann.workers.dev` — internal API, not user-facing.

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
There are 15 migrations (`0001_init.sql` … `0015_daily_piece_audio_piece_id_pk.sql`).
Apply them (idempotent — skips any already recorded in `d1_migrations`):
```bash
wrangler d1 migrations apply zeemish --remote

# Check what's in the database
wrangler d1 execute zeemish --remote --command="SELECT name FROM sqlite_master WHERE type='table'"
```
See `### Migration tracker hygiene` below before applying on a live DB — the tracker must be in sync or `migrations apply` will try to replay everything.

### Query the database
```bash
wrangler d1 execute zeemish --remote --command="SELECT * FROM users LIMIT 5"
wrangler d1 execute zeemish --remote --command="SELECT * FROM observer_events ORDER BY created_at DESC LIMIT 10"
```

### Migration tracker hygiene
Migrations are tracked in the `d1_migrations` table. As of 2026-04-21 the tracker is in sync (15 rows, 0001–0015). Keep it that way:

- **Use `wrangler d1 migrations apply zeemish --remote`** for any new migration on a live DB — not `wrangler d1 execute --file=...` and not `wrangler d1 execute --command=...`. Only `migrations apply` writes to `d1_migrations`; the other paths run the SQL but leave the tracker blind, which is how we got into the 2026-04-20 mess.
- **Pre-flight check** before applying:
  ```bash
  wrangler d1 execute zeemish --remote --command="SELECT name FROM d1_migrations ORDER BY id"
  ```
  The result should list every `.sql` file in `migrations/` except the pending one. If rows are missing, the tracker is drifted and `migrations apply` will try to replay everything — likely hitting `duplicate column name` on an `ALTER TABLE ADD COLUMN` that's already live.
- **If drift is detected:** recovery is to manually `INSERT INTO d1_migrations (name) VALUES ('NNNN_…')` for the already-applied rows the tracker is missing, then re-run `migrations apply`. Full procedure and the specific rows inserted on 2026-04-20 are documented in [DECISIONS.md](DECISIONS.md) 2026-04-20 "Surfacing the learning loop" (operational-notes bullet on the migration-apply snag).

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
- Single piece in D1 after completion: `wrangler d1 execute zeemish --remote --command="SELECT date, headline, voice_score FROM daily_pieces WHERE date = date('now')"`
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
- `severity: 'info'`, title `Zita synthesis skipped: …` — P1.5 fired at
  01:45 UTC but the piece had fewer than 5 reader messages. Expected at
  current traffic levels.
- `severity: 'info'`, title `Zita synthesis: …` — P1.5 produced at
  least one Zita-source learning; tokens-in/out + latency in the body.
- `severity: 'warn'`, titles starting `Zita …` without "synthesis" —
  site-origin events: `zita_history_truncated` (long session past the
  40-message cap, full row count in context), `zita_rate_limited`
  (user exceeded 20/15min), `zita_claude_error` (Claude API non-OK,
  upstream body in context), `zita_handler_error` (unhandled
  exception in the chat handler). The first three are expected
  occasional signal; `zita_handler_error` warrants investigation.

## Zita operations

### How the synthesis fires (automatic is the default)
The P1.5 synthesis runs **automatically**, you don't need to do anything:

- Every day a new piece publishes at 02:00 UTC. That same run schedules a synthesis for 01:45 UTC **on the next day**, targeting **today's piece**. The 23h45m gap lets a full day of reader traffic accumulate before the synthesis looks at the chats.
- If the piece got ≥5 reader messages, the synthesis runs, writes up to 10 `source='zita'` rows into `learnings`, and those rows flow into the next Drafter prompt via `getRecentLearnings(10)`.
- If it got fewer than 5, the synthesis skips silently (one `info` observer event, zero Claude cost).
- Failures are non-retriable: one `warn` observer event ("Zita synthesis missed: …"), and the loop moves on. The piece is already live and permanent — a missed batch of learnings is recoverable via manual trigger.

The **Run synthesis** button on `/dashboard/admin/piece/[date]/` is there for the recovery case (a scheduled run failed and you want to retry) and the testing case (verify the synthesis works against an older piece). Under normal operation you never need it.

### Admin surfaces
- **Reader chats:** `/dashboard/admin/zita/` (ADMIN_EMAIL only) — 30-day window, conversations grouped by reader × piece, expandable transcripts.
- **Per-piece chats:** `/dashboard/admin/piece/[date]/` → "Questions from readers" section.
- **Run synthesis button:** on the same per-piece page, next to the "Questions from readers" header. Uses your admin session, no secret to type.

### Manual trigger via curl (if you prefer)
```bash
curl -X POST "https://zeemish-agents.zzeeshann.workers.dev/zita-synthesis-trigger?date=2026-04-20" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
# Returns 202 {"status":"started","date":"2026-04-20","title":"…"}.
# Observer event lands within ~10s on success (logZitaSynthesisMetered),
# a few seconds on the skip path.
```

### Inspect what synthesis produced
```bash
wrangler d1 execute zeemish --remote --command="SELECT source, category, observation FROM learnings WHERE piece_date = '2026-04-20' AND source = 'zita'"
```

### Cost metering
Every synthesis run — skipped or success — writes a `logZitaSynthesisMetered` observer event with `{tokensIn, tokensOut, durationMs}`. First real run (2026-04-21, against the 2026-04-20 Hormuz piece): 1,636 in / 368 out / 10.7s / 5 learnings written. ~$0.01 at current Sonnet 4.5 prices. Watch drift there before it matters.

### Limits & knobs (all code-level constants, single-file edits)

| Knob | Value | Where | Purpose |
|---|---|---|---|
| Max reader message length | 2,000 chars | [`src/pages/api/zita/chat.ts`](../src/pages/api/zita/chat.ts) input guard | Stops paste-bomb abuse |
| Reader rate limit | 20 msgs / 15 min / user | same file, `checkRateLimit(…, 20, 900)` | Stops runaway clients; 429 fires `zita_rate_limited` observer event |
| Per-turn history sent to Claude | Last 40 messages | `ZITA_HISTORY_LIMIT` | Bounds per-turn cost; clipping logs `zita_history_truncated` |
| Max stored content length | 4,000 chars | `ZITA_STORED_CONTENT_CAP` | Hard ceiling on what lands in `zita_messages.content` — appends `[…truncated]` marker if hit |
| Synthesis minimum threshold | 5 reader messages per piece | `ZITA_SYNTHESIS_MIN_USER_MESSAGES` in [`agents/src/learner.ts`](../agents/src/learner.ts) | Below this, synthesis skips without calling Claude |
| Synthesis write cap | 10 learnings per run | `ZITA_LEARNINGS_WRITE_CAP` | If Claude produces more, overflow is logged via observer |
| Synthesis schedule | 01:45 UTC on day+1 | [`agents/src/director.ts`](../agents/src/director.ts) `triggerDailyPiece` | Just before next 02:00 UTC pipeline; gives readers a full day to chat |
| Claude model + max_tokens | Sonnet 4.5, 300 per turn | chat.ts | Short replies enforced at the API level |
| Synthesis max_tokens | 2,000 | `learner.ts` synthesis call | Enough for 10 learnings |

## Dashboard API endpoints (site worker)
```bash
# Public (no auth):
GET /api/dashboard/recent     # Last 7 pieces
GET /api/dashboard/stats      # Library counters
GET /api/dashboard/memory     # Learning-loop counts + latest observation

# Admin only (ADMIN_EMAIL):
GET  /api/dashboard/analytics # Engagement data
GET  /api/dashboard/observer  # Observer events
POST /api/dashboard/observer  # Acknowledge event { eventId }
```
Admin Astro pages (also ADMIN_EMAIL-gated): `/dashboard/admin/`, `/dashboard/admin/piece/[date]/`, `/dashboard/admin/zita/`.

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
