# Zeemish v2 — Living Architecture

The canonical architecture is in `handoff/ZEEMISH-V2-ARCHITECTURE-REVISED.md`. This file tracks what's **actually built** vs. what's planned.

## What's built

### Stage 1 — Foundation (complete)
- [x] Directory skeleton
- [x] Astro + Tailwind + MDX + TypeScript strict
- [x] Cloudflare Workers deploy (wrangler.toml + Static Assets)
- [x] GitHub Actions CI/CD (auto-deploy site on push to main)

### Stage 2 — Reader Surface (complete)
- [x] Content collections (courses + lessons) with Zod schemas
- [x] `<lesson-shell>` + `<lesson-beat>` Web Components for beat navigation
- [x] 12 lessons in "The body you live in" course
- [x] Course page, catalogue, home page with course cards
- [x] AudioPlayer shell component (visual only — no real audio yet)
- [x] BaseLayout + LessonLayout with breadcrumbs
- [x] Progressive enhancement (without JS, beats show as long scroll)

### Stage 3 — Reader Accounts & Progress (complete)
- [x] Astro Cloudflare adapter (static pages + server-rendered API routes)
- [x] D1 database: users, progress, submissions, zita_messages
- [x] Anonymous-first auth middleware (cookie on first API call)
- [x] Progress API: save beat, mark complete, fetch progress
- [x] Auth API: email upgrade, login, logout
- [x] PBKDF2 password hashing via Web Crypto API
- [x] Account page, login page
- [x] Security headers (`public/_headers`)
- [x] lesson-shell POSTs progress (fire-and-forget, offline-safe)

### Stage 4 — Agent Team (mostly complete)
- [x] Separate `agents/` Worker with Cloudflare Agents SDK (v0.11.1)
- [x] DirectorAgent — supervisor, manual trigger, status
- [x] CuratorAgent — lesson planning via Claude API
- [x] DrafterAgent — MDX generation via Claude API
- [x] VoiceAuditorAgent — scores voice compliance 0-100, ≥85 to pass
- [x] StructureEditorAgent — reviews beat structure, pacing
- [x] FactCheckerAgent — verifies claims (Claude reasoning only, no web search yet)
- [x] IntegratorAgent — merges audit feedback, revises draft, up to 3 rounds
- [x] PublisherAgent — commits MDX to GitHub via Contents API
- [x] ObserverAgent — logs events, provides digest/events endpoints
- [x] Full pipeline: Curate → Draft → 3 parallel auditors → Revise loop → Publish
- [ ] **Audio-Producer agent** — NOT BUILT (needs ElevenLabs API)
- [ ] **Audio-Auditor agent** — NOT BUILT (needs STT round-trip)
- [ ] **Cloudflare Workflows v2** — NOT USED (pipeline is synchronous RPC)
- [ ] **Scheduled Director runs** — NOT BUILT (manual trigger only)
- [ ] Dashboard page at `/dashboard/` with manual trigger form

### Stage 5 — First Real Course (complete)
- [x] 12 lessons for "The body you live in" — all agent-authored
- [x] Each passed voice, structure, and fact-check gates
- [x] Published via PublisherAgent to GitHub

### Stage 6 — Self-Improvement Loop (partially complete)
- [x] EngagementAnalystAgent — reads completion/drop-off data
- [x] ReviserAgent — proposes revisions from engagement signals
- [x] Engagement tracking API (`/api/engagement/track`)
- [x] lesson-shell tracks views and completions
- [x] D1 tables: engagement, learnings
- [ ] **Scheduled EngagementAnalyst runs** — NOT BUILT
- [ ] **Learnings database populated** — table exists but no agent writes to it
- [ ] **Prompt-improvement loop** — NOT BUILT

### Stage 7 — Zita (complete)
- [x] Zita chat API (`/api/zita/chat`) — Socratic guide via Claude API
- [x] `<zita-chat>` Web Component — floating chat on lesson pages
- [x] Per-user per-lesson conversation history in D1
- [x] Integrated into LessonLayout

## What's NOT built (known gaps)

### Missing agents
- Audio-Producer (ElevenLabs TTS) — needs API key and R2 bucket
- Audio-Auditor (STT round-trip quality check)

### Missing infrastructure
- Cloudflare Workflows v2 for durable pipeline execution
- R2 bucket for audio storage
- `audit_results` D1 table for persistent audit trail
- Scheduled cron runs for Director and EngagementAnalyst
- Web search tool for Fact-Checker (Workers AI Search)

### Missing features
- Passphrase auth (6 BIP39 words)
- Magic link / password reset
- Rate limiting on all endpoints
- Auth on dashboard page and agents trigger endpoint
- Per-day spending cap
- CSP security header
- GitHub Actions workflow for agents deployment

## Deviations from plan
1. **Single Astro Worker for site + API** instead of separate workers. Avoids CORS.
2. **No Workflows v2** — pipeline uses synchronous sub-agent RPC calls. Works but not durable.
3. **Agent code is flat files** (`curator.ts`) not subdirectories (`curator/agent.ts`).
4. **Dashboard is in Astro site** not a separate `dashboard/` project.
5. **Fact-Checker uses Claude reasoning only**, not Workers AI Search.
6. **Lesson titles differ from original course spine** — agents chose their own topics.
