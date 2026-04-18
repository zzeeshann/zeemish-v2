# Zeemish v2 — Claude Code Context

**Read this first. Then read `docs/handoff/ZEEMISH-V2-ARCHITECTURE-REVISED.md` and `docs/handoff/ZEEMISH-DAILY-PIECES.md`.**

## The Zeemish Protocol

**"Educate myself for humble decisions."**

"Most human suffering — personal, in organisations, and across the world — comes from treating connected things as if they were separate. The cure is learning to see and work with the whole."

## What Zeemish v2 is

An autonomous multi-agent publishing system. 13 AI agents scan the news, decide what to teach, draft pieces, audit them through quality gates, and publish — all without human intervention. Readers see a daily teaching piece anchored in today's news, with a growing library of past pieces.

## Current state

**Complete.** 13 agents deployed, all wired. Daily news-driven teaching operational, public + admin dashboard, security hardened. Daily pieces are the only content type.

Each agent does one job and lives in one file. Director is a pure orchestrator — zero LLM calls. Curator picks the story, Drafter writes the MDX, auditors gate quality, Integrator revises, Publisher ships, Audio Producer narrates beat-by-beat via ElevenLabs, Audio Auditor verifies, Publisher second-commits the audio URLs into frontmatter. Audio runs in a ship-and-retry posture: text publishes the moment Integrator approves (a newspaper never skips a day); audio lands as a second commit when it's ready, or surfaces a retry button on the admin dashboard if it fails.

## What was built

1. **Foundation:** Astro + Tailwind + MDX + TypeScript strict, Cloudflare Workers, GitHub Actions CI/CD
2. **Reader Surface:** Beat-by-beat navigation Web Components (one beat at a time), content collections
3. **Accounts & Progress:** Anonymous-first auth, D1, progress tracking, magic link login (Resend)
4. **Agent Team:** 13 agents on Cloudflare Agents SDK, full pipeline with quality gates + audio narration
5. **Self-Improvement:** Engagement tracking, LearnerAgent, learnings database
6. **Zita:** Socratic learning guide in every piece
7. **Daily Pieces:** ScannerAgent, Director daily mode, news-driven teaching every day at 2am UTC
8. **Dashboard:** Public factory floor (/dashboard/) + admin control room (/dashboard/admin/)

## Architecture

### Two Workers
- **zeemish-v2** — Astro site: pages + API routes. `https://zeemish.io` (custom domain; workers.dev URL still active as fallback)
- **zeemish-agents** — 13 agents as Durable Objects. `https://zeemish-agents.zzeeshann.workers.dev`

### Stack
- Frontend: Astro + MDX + TypeScript strict + Tailwind + Web Components
- Backend: Cloudflare Workers (Astro adapter) + D1 (14 tables) + R2 (audio)
- Agents: Cloudflare Agents SDK v0.11.1
- AI: Anthropic Claude Sonnet 4.5
- Audio: ElevenLabs (Frederick Surrey voice)
- Email: Resend (magic link from hello@zeemish.io)
- Deploy: GitHub Actions → Cloudflare (both workers auto-deploy)

### The 13 Agents (one job per agent, one file per agent)

Pipeline: Scanner → Curator → Drafter → [Voice, Structure, Fact] → Integrator → Publisher → Audio Producer → Audio Auditor → Publisher.publishAudio (second commit splices audioBeats into frontmatter). Text ships first — audio is ship-and-retry so the day is never blank. Observer receives events throughout. Learner runs off-pipeline, watching readers.

1. **ScannerAgent** — reads the news every morning
2. **DirectorAgent** — pure orchestrator. Routes work between agents. Zero LLM calls. Scheduled 2am UTC every day.
3. **CuratorAgent** — picks the most teachable story from today's candidates, plans beats + hook + teaching angle
4. **DrafterAgent** — writes the MDX from the brief, enforces `<lesson-shell>` / `<lesson-beat>` format
5. **VoiceAuditorAgent** — voice compliance gate (≥85/100)
6. **FactCheckerAgent** — verifies every claim (two-pass: Claude + DuckDuckGo)
7. **StructureEditorAgent** — reviews flow and pacing
8. **IntegratorAgent** — handles revisions before approval (3 rounds max)
9. **AudioProducerAgent** — generates per-beat MP3 via ElevenLabs (Frederick Surrey, `eleven_multilingual_v2`, 96 kbps), saves to R2, writes `daily_piece_audio` rows. 20k-char hard cap per piece, 3-attempt retry on transient failures, request-stitching for prosodic continuity.
10. **AudioAuditorAgent** — reads `daily_piece_audio` rows, verifies R2 objects exist + file sizes are sane + total chars under cap. Passes/fails without touching git.
11. **PublisherAgent** — commits to GitHub, piece goes live
12. **LearnerAgent** — learns from reader behaviour, writes patterns for future pieces
13. **ObserverAgent** — logs every pipeline event for the admin dashboard

### Dashboard
- **Public** (`/dashboard/`) — anyone can visit. Shows pipeline status, quality scores, agent team, library stats, recent pieces. Transparency is the brand.
- **Admin** (`/dashboard/admin/`) — ADMIN_EMAIL only. Pipeline controls, observer events with acknowledge, engagement data, agent tasks.

### Database (D1 — 13 tables, 10 migrations)
See `docs/SCHEMA.md`.
- Reader: users, progress, submissions, zita_messages, magic_tokens
- Agent: observer_events, engagement, learnings, audit_results, pipeline_log
- Daily: daily_candidates, daily_pieces (+ `has_audio` col), daily_piece_audio (per-beat MP3 rows)

### Key directories
```
src/pages/              Routes (index, daily, library, dashboard, account, login, API)
src/pages/api/dashboard/ Dashboard API (today, recent, stats, analytics, observer)
src/interactive/        Web Components (lesson-shell, lesson-beat, zita-chat)
src/lib/                Auth, DB helpers, rate limiting, formatting (formatDate, formatTime)
src/styles/             global.css (Tailwind) + beats.css + zita.css (standalone, not Tailwind-processed)
src/layouts/            BaseLayout, LessonLayout
content/daily-pieces/   Daily teaching pieces (YYYY-MM-DD-slug.mdx)
agents/src/             13 agent files (one per agent) + per-agent prompt files + shared code
migrations/             D1 schema migrations (0001-0006)
docs/                   Living documentation
docs/handoff/           Original architecture + specs
```

### Security
- Session cookies: HttpOnly, Secure, SameSite=Lax
- Passwords: PBKDF2 100k iterations, timing-safe comparison
- CSRF: origin header check (strict URL parsing)
- Rate limiting: login (5/15min), Zita (20/15min), upgrade (5/15min)
- Agents: ADMIN_SECRET bearer token, CORS restricted to allowed origins + preflight
- Dashboard: public view (no auth), admin view (ADMIN_EMAIL gated)
- Input validation: JSON try-catch, message length limits
- CSP header, X-Frame-Options DENY

### Secrets (never in code)
**Site worker:** ANTHROPIC_API_KEY, RESEND_API_KEY, AGENTS_ADMIN_SECRET, ADMIN_EMAIL
**Agents worker:** ANTHROPIC_API_KEY, GITHUB_TOKEN, ELEVENLABS_API_KEY, ADMIN_SECRET

### Site navigation
**Daily · Library · Dashboard · Account**

## Documentation index
- `docs/ARCHITECTURE.md` — what's built, deviations from plan
- `docs/AGENTS.md` — all 13 agents, endpoints, secrets
- `docs/SCHEMA.md` — all 13 D1 tables, 10 migrations
- `docs/RUNBOOK.md` — how to run, deploy, trigger, revert
- `docs/DECISIONS.md` — technical decisions (append-only)
- `docs/handoff/` — original specs (architecture, daily pieces, dashboard, project brief, instructions)

## Remaining minor items
- Voice contract .ts has belief line synced, but may drift — .md is canonical
- Audio-Auditor does file checks only (no STT round-trip)
- Audio `/audio/*` route returns 200 with full body for Range requests instead of 206 partial — browsers buffer the whole clip rather than seek. Per-beat clips are small so it's tolerable; revisit if seek behaviour or bandwidth becomes a concern
- Rate limiter is KV-backed (Workers KV, eventually consistent)
- CSP uses `unsafe-inline` for scripts (required by Astro)
- Dashboard pipeline API's `isRunning` heuristic is buggy on the API itself — admin's consumer fixes it inline; if other consumers want the right answer, fix the endpoint properly
- Zita chat panel uses white background — feels off-brand vs the cream `zee-bg` used elsewhere; rebrand needed
- OG image is one static SVG for every page; per-piece dynamic OG (headline + tier rendered to PNG at the edge) is a future Worker route project
- No skip-to-content link for keyboard users; full WCAG audit deferred

## Design pass (2026-04-17)
- Beat navigation activated: `src/lib/rehype-beats.ts` wraps `##`-demarcated MDX sections in `<lesson-shell>`/`<lesson-beat>` at build time. No agent changes.
- Homepage: hero + "made by 13 agents" pipeline strip + recent list. Mission line moved to footer (`BaseLayout`).
- Library: month-grouped, filterable by title/subject, topic pills in gold. No quality filter — every published piece appears.
- Dashboard: three unified quality-score cards (score + tier + bar); avg voice score shows sample size; admin button guard hardened against undefined email match.
- Post-deploy triage (same day): avg voice score now reads `daily_pieces.voice_score` (final-round per piece) instead of `audit_results WHERE passed=1` — see DECISIONS.md. Library stats card 4 unified to match cards 1–3 (days running + "Since" subtitle). Account page: date eyebrow, title, reading stats (pieces completed / in progress), tidier actions.
- Transparency drawer (2026-04-18): every daily piece now has a "How this was made" drawer at the bottom. Shows full pipeline timeline, per-round auditor output (Voice / Facts / Structure), voice-contract rules applied, and candidates Scanner surfaced. Fed by new public endpoint `/api/daily/[date]/made` that aggregates `pipeline_log` + `audit_results` + `daily_candidates` + `daily_pieces`. Deep-linkable via `#made`. No schema, no agent changes.
- Dashboard refocused (2026-04-18): now the cross-piece, cross-day view (the drawer owns per-piece). Sections: live header subtitle (next run countdown), one-line today status, week's output stat grid (pieces / avg voice / tier mix / avg rounds), recent-runs feed, "How it's holding up" honest signals (unresolved escalations / fact-check web / candidates-per-day), agent team with active marker, footer with Voice contract + admin link. All queries against existing tables. Removed: redundant Today fat card, redundant Quality Scores grid, redundant Recent Pieces list, redundant Library stat grid, top-level Admin Panel CTA.
- Site polish bundle (2026-04-18): custom on-brand 404, OG/Twitter meta + branded SVG OG image, Google Fonts preconnect, library filter focus ring restored, drawer no longer fetches on every page mount (lazy-loads on first open), dashboard "How it's holding up" rows stack on mobile.
- Audio pipeline live (2026-04-18): un-paused the two audio agents. New migration `0010_audio_pipeline.sql` adds `daily_piece_audio` (per-beat rows: r2_key, public_url, character_count, request_id, model, voice_id) + `has_audio` on `daily_pieces`. Producer switched to `mp3_44100_96`, added `use_speaker_boost`/`speed: 0.95`/request-stitching/"Zeemish → Zee-mish" alias, 20k-char budget cap (`AudioBudgetExceededError`), 3-attempt retry on 5xx, 4xx fails fast. Auditor rewritten to read rows + HEAD R2 (0.3×–3× expected-size tolerance). Director gained `runAudioPipeline` (ship-and-retry after Publisher) + public `retryAudio(date)`. Publisher gained `publishAudio` (second commit, idempotent, metadata-only). AudioPlayer.astro is now a `<audio-player>` web component that listens for `lesson-beat:change` and auto-advances on clip end. Transparency drawer gains Audio section. Admin piece deep-dive gains Audio section + Retry button (proxies `/audio-retry` → Director). `publishToPath` still refuses to overwrite content — `publishAudio` is an allowed metadata-only carve-out (see DECISIONS 2026-04-18).
- Admin control room + per-piece deep-dive + login refresh (2026-04-18): `/dashboard/admin/` rewritten to match the design system — today's run, system-state stat grid, observer events (with in-place ack), all-pieces list with filter, pipeline history. New route `/dashboard/admin/piece/[date]/` shows everything about one day: full timeline, all rounds with full violations/claims/issues (no truncation), all 50 candidates (no cap), observer events for that day, raw JSON dumps. Login page updated to use the eyebrow/title/subtitle header. Engagement section dropped from admin (legacy lessons-era data), placeholder pointing to CLAUDE.md. `isRunning` heuristic fixed inline on admin's poller (step name + status, not just step name).

## Launch readiness (2026-04-18)
Pre-launch pass before pointing zeemish.io at the new worker. Audit revealed several "Remaining minor items" were already done (audio R2 wiring, /audio/* route, engagement writes via lesson-shell); the docs were drifting. Real fixes:
- **`audio_plays` engagement now wired**: `<audio-player>` dispatches `audio-player:firstplay` on first play in a session, `<lesson-shell>` listens and POSTs `event_type='audio_play'` once per session per piece. Previously the column was always 0 — silent gap. Files: [src/interactive/audio-player.ts](src/interactive/audio-player.ts), [src/interactive/lesson-shell.ts](src/interactive/lesson-shell.ts).
- **Admin engagement widget rendered**: `/dashboard/admin/` now shows per-piece views/completions/audio_plays/drop-off, aggregated across activity dates via `GROUP BY lesson_id` from the existing `engagement` table. Each row deep-links to the per-piece admin route. Replaces the honest placeholder. Reader-side data was already flowing from lesson-shell since the daily-pieces era — only the surface was missing.
- **Security headers moved into middleware**: `public/_headers` was silently ignored by Cloudflare Workers Static Assets (live response had zero security headers). Now `src/middleware.ts` applies CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy on every response. Required two coordinated fixes: (1) `run_worker_first = true` in `[assets]`, (2) `scripts/post-build.sh` overrides the Astro Cloudflare adapter's auto-generated `_routes.json` to put prerendered HTML (`/`, `/daily/*`, `/library`) BACK into the worker's reach — by default the adapter excludes them as a perf optimisation, which made middleware a no-op for those paths. Middleware also sets `Cache-Control: private, no-store` on `text/html` responses so the CDN edge cache can't intercept them before the worker runs. Static assets (`/_astro/*`, og image, robots.txt) still skip the worker — they don't need security headers and would just add overhead. CSP `connect-src 'self'` (Agents worker is reached via service binding, not browser fetch). `public/_headers` deleted to avoid future confusion.

**Critical lesson — Cloudflare Workers Static Assets (read this before touching cache or headers):** Three caching/routing layers interact and you have to defeat all of them to get headers on prerendered HTML.
1. **Adapter `_routes.json`** auto-excludes prerendered paths from the worker — overridden by `scripts/post-build.sh`.
2. **`run_worker_first`** in wrangler.toml asset binding — needed so the worker actually runs for the now-included paths.
3. **Cloudflare CDN edge cache** sits before the worker; cached HTML is served without ever invoking the worker — defeated by `Cache-Control: private, no-store` on `text/html` from middleware.
If you're debugging a "header missing on / but present on /api/..." problem in future, this is the trio to check.

## Quality surfacing (2026-04-17)
Every published piece shows a tier in the metadata line: `Polished` (voice ≥ 85), `Solid` (70–84), `Rough` (< 70). Derived at render time from `voiceScore` in MDX frontmatter via `src/lib/audit-tier.ts`. No archive filtering — a published piece is a published piece. Admin surface (`/dashboard/admin/`) keeps raw `Voice: N/100` + `LOW QUALITY` labels for operator truth. See `docs/DECISIONS.md` 2026-04-17 "Soften quality surfacing" for the full rationale.

## Dev-mode testing
One-command reset: `ADMIN_SECRET=... ./scripts/reset-today.sh` (git rm
MDX + D1 clear across 5 tables + trigger fresh pipeline). See
`docs/RUNBOOK.md` → "Reset today" for what it does and the manual
fallback.

## Hard rule
**Published pieces are permanent. No agent writes to, revises, regenerates, or updates any published piece. All improvements feed forward into the learnings database and improve future pieces only.**

## Key rules
- TypeScript strict everywhere
- No new dependencies without justification
- Docs updated alongside code, same commit
- Voice contract: plain English, no jargon, no tribe words, short sentences
- When in doubt: "Does this help someone educate themselves for humble decisions?"
