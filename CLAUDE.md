# Zeemish v2 — Claude Code Context

**Read this first. Then read `docs/handoff/ZEEMISH-V2-ARCHITECTURE-REVISED.md` and `docs/handoff/ZEEMISH-DAILY-PIECES.md`.**

## The Zeemish Protocol

**"Educate myself for humble decisions."**

"Most human suffering — personal, in organisations, and across the world — comes from treating connected things as if they were separate. The cure is learning to see and work with the whole."

## What Zeemish v2 is

An autonomous multi-agent publishing system. 13 AI agents scan the news, decide what to teach, draft pieces, audit them through quality gates, and publish — all without human intervention. Readers see a daily teaching piece anchored in today's news, with a growing library of past pieces.

## Current state

**LAUNCHED 2026-04-18 at https://zeemish.io.** Tag: `v1.0.0`. Old breathing-tools site at zeemish.io retired (custom-domain binding moved from `zeemish-site` worker to `zeemish-v2` worker via Cloudflare dashboard). New site live with daily piece, audio, engagement tracking, public + admin dashboard, security headers on auth-touching surfaces. Workers.dev URL still active as fallback. The exact git commit at launch is what `v1.0.0` points at — use it as the reference if anyone asks "what shipped on day one".

13 agents deployed, all wired. Daily news-driven teaching operational, public + admin dashboard, security hardened on the routes that matter. Daily pieces are the only content type.

Each agent does one job and lives in one file. Director is a pure orchestrator — zero LLM calls. Curator picks the story, Drafter writes the MDX, auditors gate quality, Integrator revises, Publisher ships, Audio Producer narrates beat-by-beat via ElevenLabs, Audio Auditor verifies, Publisher second-commits the audio URLs into frontmatter. Audio runs in a ship-and-retry posture: text publishes the moment Integrator approves (a newspaper never skips a day); audio lands as a second commit when it's ready, or surfaces a retry button on the admin dashboard if it fails.

The 2026-04-19 improvement plan (`~/Downloads/ZEEMISH-IMPROVEMENT-PLAN-2026-04-19.md`, not committed) is ~90% closed as of 2026-04-20. Remaining items: **P1.2 Curator conceptual diversity** (in FOLLOWUPS as `[observing]`, unblock by 2026-04-26), **P2.2 Watch beat** (pending Zishan decision — enforce or drop from spec), **P1.5 Zita learning** (blocked on reader + Zita traffic). P2.1 heading-punctuation scoped out (the major bug shipped via `beatTitles` override; the title-case remainder is `[wontfix]`). P2.3 audio-on-2026-04-17 resolved — live at `zeemish.io/daily/2026-04-17/`. P3.1 dashboard agent-team live state scoped out.

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

### Database (D1 — 13 tables, 11 migrations)
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
- **Security headers on prerendered HTML (`/`, `/daily/*`, `/library`) — known gap.** Despite `_routes.json` `include: ["/*"]` + `run_worker_first = true` + middleware `Cache-Control: no-store` on HTML, Cloudflare Workers Static Assets serves prerendered `.html` files directly without invoking the worker. Server-rendered routes (`/dashboard/`, `/api/*`, `/audio/*`, `/account`, `/login`) DO get all 6 headers (CSP/HSTS/X-Frame-Options/X-Content-Type-Options/Referrer-Policy/Permissions-Policy) — those are the auth-touching, security-critical surfaces. The static reading pages have no auth, no cross-origin fetches, no third-party scripts beyond Google Fonts (preconnect only). Practical residual risk = clickjacking (low — there's no sensitive UI to overlay). Two future paths if we want to close it: (a) Cloudflare Transform Rule injecting headers at the edge (5 min UI work, ironclad), (b) `prerender = false` on those pages (worker runs every time, ~15-50ms perf hit). See `docs/DECISIONS.md` 2026-04-18 "Ship as-is despite header gap" for the full reasoning.
- DNS `R2 listens.zeemish.io` and `Worker api.zeemish.io → zeemish-api` are leftover from the OLD breathing-tools site. Different subdomains, not in the way of launch. Retire when convenient — they don't serve anything used by zeemish-v2.
- Cache-purge needed on every Cloudflare deploy to evict CDN-cached prerendered HTML — until the header-gap above is closed (any solution there fixes this too)
- Fact-checker's DDG leg uses the **Instant Answer API** (`api.duckduckgo.com/?q=...&format=json`) which only resolves Wikipedia-like topics — specific news claims ("fuel prices spiked 18% last month") legitimately return empty. After the 2026-04-19 refactor, `searchAvailable: false` now means genuinely unreachable; reachable-but-empty results return `searchAvailable: true, searchUsed: false` (dashboard signal is honest). Long-term upgrade: swap DDG IA for a richer backend (Brave Search API, Serper, or Claude's native web-search tool). DDG IA realistically only verifies ~5% of specific claims — most pieces' Facts ✓ gate currently lands on first-pass Claude.
- Drafter-declared `beatCount` in frontmatter can drift from actual `##` heading count in the MDX body. 2026-04-17 previously declared 6 but has 8 `##` headings — corrected to 8 via a frontmatter-only edit on 2026-04-19 (permitted under the metadata carve-out). Reader UI counts actual headings in `src/lib/rehype-beats.ts` and is correct regardless; the stored metadata in `daily_pieces.beat_count` is still the Drafter's declared number. Durable fix still pending: add a Structure-Editor gate (`beatCount` must equal number of `##` in body) or drop the frontmatter field and derive it at render time.
- Drafter authors beat headings in kebab-case (`## qvcs-original-advantage`), which `rehype-beats.ts` humanises for display. Lossy for acronyms and punctuation — "Qvcs Original Advantage" not "QVC's Original Advantage". Fixed via optional `beatTitles` frontmatter map (added 2026-04-19) that overrides `humanize(slug)` per beat. Parallel durable fix still pending: teach Drafter to write display-formatted `##` headings going forward so new pieces don't need the override. See DECISIONS 2026-04-19 "Frontmatter edits permitted for display-layer fixes".

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
- Audio hardening (2026-04-19): `callElevenLabs` gained a 30s `AbortSignal.timeout` per attempt (prior silent hang on stalled TCP is now a loud escalation). Director gained `retryAudioFresh(date)` — wipes R2 clips + `daily_piece_audio` rows + `has_audio` + `pipeline_log` audio-* rows, then calls `retryAudio`. `/audio-retry` accepts `?mode=continue|fresh`; admin piece deep-dive shows **Continue** + **Start over** buttons whenever `has_audio ≠ 1` (including partial state), Start over triggers a confirm() dialog showing clip count that will be deleted. See DECISIONS 2026-04-19 "Audio pipeline hardening" for why.
- Audio RPC budget (2026-04-19, later same day): Cloudflare Durable Object RPC calls have a ~30s wall-clock ceiling. Producer's `generateAudio` ran a loop over 6 beats × 10-15s ElevenLabs = 60-90s wall time, getting silently killed around beat 2 in every run. **Fix:** chunked generation. Producer method renamed to `generateAudioChunk(brief, mdx, maxBeats = 2)` — processes at most N new beats per call (always under budget), returns `{processedBeats, totalBeats, completedCount, totalCharacters}`. Director's `runAudioPipeline` replaces the single await with a bounded while-loop (≤10 iterations). Cross-chunk prosodic continuity preserved: each chunk loads last 3 `request_id`s from D1 for ElevenLabs `previous_request_ids` stitching. Publisher's `audioBeats` map is now read from D1 (source of truth covering multi-chunk accumulation + head-check skip from prior partials). See DECISIONS 2026-04-19 "Audio RPC wall-clock budget".
- DO eviction root cause (2026-04-19, even later): Phase F chunking helped but didn't fix the stall — next trigger died at 1/5 beats. The actual cause was **Agents SDK DO eviction after 70-140s of inactivity** (documented in `agents/node_modules/agents/dist/index.js:1671-1699`, not a Cloudflare platform limit). Text pipeline alone runs ~107s, so audio always straddled the eviction cliff regardless of how short each producer RPC call was. **Fix:** wrap `triggerDailyPiece`, `retryAudio`, `retryAudioFresh` with `const dispose = await this.keepAlive();` + try/finally. The SDK fires a 30s heartbeat alarm that resets the inactivity timer; reference-counted so nested calls are safe. Phase F chunking is still valuable for clean retry semantics, cross-chunk `request_id` stitching, and progress visibility — but `keepAlive()` is what actually unblocks single-shot completion. See DECISIONS 2026-04-19 "DO eviction was the real root cause".
- Audio runs on alarm, not inline (2026-04-19, finally): keepAlive still wasn't enough — next trigger stalled again at 2/5. Real Cloudflare docs: HTTP-triggered DO invocations risk eviction *"after 30s of compute between incoming network requests"* and **Durable Objects are single-threaded** so alarm heartbeats can't deliver while the current method is holding the DO. **Alarm handlers have a separate 15-minute wall-clock budget.** Fix: `triggerDailyPiece` no longer runs `runAudioPipeline` inline — it calls `this.schedule(1, 'runAudioPipelineScheduled', {date, filePath, title})` and returns. Alarm fires 1s later in a fresh invocation with the 15-min budget. New method `runAudioPipelineScheduled(payload)` re-reads MDX from GitHub (keeps SQLite payload small) and calls `runAudioPipeline`. Same for `retryAudio` — validates synchronously, then schedules. Phase F chunking + Phase G keepAlive are retained (cheap + defensive) but the alarm boundary is what actually works. See DECISIONS 2026-04-19 "Audio via alarm, not inline".

## Closing the self-improvement loop (2026-04-19)
Twelve of thirteen agents have been running identical prompts every day since launch. The `learnings` table was effectively write-only — StructureEditor and Learner wrote into it, but no agent's runtime prompt read from it. From 2026-04-19 the loop starts closing, incrementally.

- **P1.1 — Drafter reads learnings at runtime.** Before building its prompt, Drafter calls `getRecentLearnings(DB, 10)` and includes the results in a "Lessons from prior pieces" block positioned between the Voice Contract and the Brief. Contract binds → lessons guide → brief specifies. Voice contract still wins on conflict (explicit line in the block). Fail-open on DB errors; block is omitted when empty. `getRecentLearnings` signature widened from `(db, category, limit)` → `(db, limit)` — no source filter so producer/self-reflection/reader/zita origins compound in the same feed. See DECISIONS 2026-04-19 "Drafter reads learnings at runtime". Files: [agents/src/drafter.ts](agents/src/drafter.ts), [agents/src/drafter-prompt.ts](agents/src/drafter-prompt.ts), [agents/src/shared/learnings.ts](agents/src/shared/learnings.ts).
- **P1.3 — Learner writes producer-origin learnings post-publish.** Migration 0011 added `learnings.source` (reader/producer/self-reflection/zita, nullable TEXT, no CHECK). `writeLearning` now takes a required `source` argument; StructureEditor's auditor-time writes pass `'producer'`, Learner's engagement-analysis writes pass `'reader'`. New Learner method `analysePiecePostPublish(date)` reads the full quality record (`daily_pieces` + `audit_results` + `pipeline_log` + `daily_candidates`) and writes up to 10 producer-origin learnings per piece; Director fires it via `this.schedule(1, 'analyseProducerSignalsScheduled', ...)` immediately after `publishing done` so it's off-pipeline and non-blocking. Non-retriable on failure (logs via `observer.logLearnerFailure`); overflow beyond 10 rows logs via `observer.logLearnerOverflow`. See DECISIONS 2026-04-19 "Learner writes producer-origin learnings post-publish".
- **P1.4 — Drafter self-reflects post-publish.** After `publishing done`, Director fires `Drafter.reflect(brief, mdx, date)` via `this.schedule(1, 'reflectOnPieceScheduled', ...)` alongside the Learner schedule. Drafter re-reads the committed MDX from GitHub, evaluates it as a peer editor would (prompt explicitly names the stateless reality — "you didn't write this piece, a prior invocation did"), and writes up to 10 learnings with `source='self-reflection'`. Same cap/fail-silent semantics as P1.3. One Sonnet call per publish, metered via `observer.logReflectionMetered` (tokens-in/out + latency) for cost visibility. See DECISIONS 2026-04-19 "Drafter self-reflects post-publish".
- **P1.5 — pending.** Zita-question learning waits on readers + Zita traffic.

## Surfacing the learning loop (2026-04-20)
With P1.3 + P1.4 writing producer and self-reflection rows after every publish, the next step was making that visible. Two surfaces shipped same day, one commit each.

- **Dashboard "What we've learned so far" panel** (`/dashboard/`, commit [b96c8d6](https://github.com/zzeeshann/zeemish-v2/commit/b96c8d6)). Three counts (producer / self-reflection / total) plus the most recent observation as a blockquote with source attribution. Fed by `/api/dashboard/memory`. Inserted between "How it's holding up" and "The agent team". Hidden entirely when the learnings table is empty. Files: [src/pages/api/dashboard/memory.ts](src/pages/api/dashboard/memory.ts), [src/pages/dashboard/index.astro](src/pages/dashboard/index.astro).
- **Per-piece "What the system learned from this piece" section** in the How-this-was-made drawer (`/daily/[date]/`, commit [a0a9b22](https://github.com/zzeeshann/zeemish-v2/commit/a0a9b22)). Grouped by source in fixed order (Drafter self-reflection → Learner producer-side pattern → reader → zita). Absent entirely when the piece has no learnings. Required migration 0012 adding `learnings.piece_date TEXT`, plus a one-time backfill of 13 pre-migration rows (4 → 2026-04-17 QVC, 9 → 2026-04-20 Hormuz). Files: [src/pages/api/daily/[date]/made.ts](src/pages/api/daily/[date]/made.ts), [src/interactive/made-drawer.ts](src/interactive/made-drawer.ts), [src/styles/made.css](src/styles/made.css), [migrations/0012_learnings_piece_date.sql](migrations/0012_learnings_piece_date.sql).

Source labels shared across both surfaces — "Learner, producer-side pattern", "Drafter self-reflection", "Reader signal", "Zita question pattern" — so the vocabulary is stable from dashboard cross-piece view to per-piece drawer view. `writeLearning` now enforces non-null `pieceDate` at the application layer (same defensive shape as `source` from 0011). See DECISIONS 2026-04-20 "Surfacing the learning loop" for the full rationale, the D1 quirks hit during the backfill (migration-tracker drift, correlated-subquery limitation), and the grouping-order call.

## Launch readiness (2026-04-18)
Pre-launch pass before pointing zeemish.io at the new worker. Audit revealed several "Remaining minor items" were already done (audio R2 wiring, /audio/* route, engagement writes via lesson-shell); the docs were drifting. Real fixes:
- **`audio_plays` engagement now wired**: `<audio-player>` dispatches `audio-player:firstplay` on first play in a session, `<lesson-shell>` listens and POSTs `event_type='audio_play'` once per session per piece. Previously the column was always 0 — silent gap. Files: [src/interactive/audio-player.ts](src/interactive/audio-player.ts), [src/interactive/lesson-shell.ts](src/interactive/lesson-shell.ts).
- **Admin engagement widget rendered**: `/dashboard/admin/` now shows per-piece views/completions/audio_plays/drop-off, aggregated across activity dates via `GROUP BY lesson_id` from the existing `engagement` table. Each row deep-links to the per-piece admin route. Replaces the honest placeholder. Reader-side data was already flowing from lesson-shell since the daily-pieces era — only the surface was missing.
- **Security headers moved into middleware**: `public/_headers` was silently ignored by Cloudflare Workers Static Assets (live response had zero security headers). Now `src/middleware.ts` applies CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy on every response. Required two coordinated fixes: (1) `run_worker_first = true` in `[assets]`, (2) `scripts/post-build.sh` overrides the Astro Cloudflare adapter's auto-generated `_routes.json` to put prerendered HTML (`/`, `/daily/*`, `/library`) BACK into the worker's reach — by default the adapter excludes them as a perf optimisation, which made middleware a no-op for those paths. Middleware also sets `Cache-Control: private, no-store` on `text/html` responses so the CDN edge cache can't intercept them before the worker runs. Static assets (`/_astro/*`, og image, robots.txt) still skip the worker — they don't need security headers and would just add overhead. CSP `connect-src 'self'` (Agents worker is reached via service binding, not browser fetch). `public/_headers` deleted to avoid future confusion.

**Critical lesson — Cloudflare Workers Static Assets (read this before touching cache or headers):** Three caching/routing layers interact and you have to defeat all of them to get headers on prerendered HTML.
1. **Adapter `_routes.json`** auto-excludes prerendered paths from the worker — overridden by `scripts/post-build.sh`.
2. **`run_worker_first`** in wrangler.toml asset binding — needed so the worker actually runs for the now-included paths.
3. **Cloudflare CDN edge cache** sits before the worker; cached HTML is served without ever invoking the worker — defeated by `Cache-Control: private, no-store` on `text/html` from middleware.

**Update after launch (2026-04-18):** Even all three of the above did NOT get headers onto prerendered HTML in production. Cloudflare Workers Static Assets appears to serve `.html` files directly from the asset binding for filesystem-resolvable paths regardless of `_routes.json` and `run_worker_first`. Confirmed by: `_routes.json` deployed correctly (verified via `curl https://zeemish.io/_routes.json`), worker IS running on server-rendered routes (`/dashboard/` returns the new `Cache-Control: private, no-store` from middleware), but prerendered HTML continues to return Cloudflare's default `cache-control: public, max-age=0, must-revalidate` and zero security headers — including a brand-new random URL that resolves to the static `404.html`. We hit this as a hard wall and decided to ship — see DECISIONS 2026-04-18 "Ship as-is despite header gap". If a future Cloudflare release exposes a `routes.strategy = 'always-worker'` option, or if we add a Cloudflare Transform Rule, this gap closes.

## Launch (2026-04-18 — `v1.0.0`)
- Old `zeemish.io` worker (`zeemish-site`, breathing tools) custom-domain bindings removed
- New `zeemish-v2` worker bound to `zeemish.io` + `www.zeemish.io` via Cloudflare dashboard
- TLS cert auto-issued by Cloudflare
- DNS records left in place: `api.zeemish.io → zeemish-api` (old API, different subdomain), `listens.zeemish.io → zeemish-listens` R2 (old audio, different subdomain), Resend records (verified: resend._domainkey, send MX, send SPF)
- Three Cloudflare cache purges performed during cutover; future deploys may need a manual purge until the prerendered-HTML header gap is closed
- Final smoke check on zeemish.io: site renders, daily piece loads, audio plays, engagement tracks, magic-link login works (Resend domain verified), www → apex redirect works, robots.txt served, security headers on `/dashboard/` + `/api/*` + `/audio/*` confirmed
- Known launch-day gap: prerendered HTML lacks security headers (see Remaining minor items)

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
