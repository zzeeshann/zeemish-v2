# Zeemish v2 — Living Architecture

The canonical architecture is in `handoff/ZEEMISH-V2-ARCHITECTURE-REVISED.md`. This file tracks what's **actually built** vs. what's planned.

## What's built

### Stage 1 — Foundation (complete)
- [x] Directory skeleton
- [x] Astro + Tailwind + MDX + TypeScript strict
- [x] Cloudflare Workers deploy (wrangler.toml + Static Assets)
- [x] GitHub Actions CI/CD (auto-deploys both site and agents on push to main)

### Stage 2 — Reader Surface (complete)
- [x] Content collections (courses + lessons) with Zod schemas
- [x] `<lesson-shell>` + `<lesson-beat>` Web Components for beat navigation
- [x] 12 lessons in "The body you live in" course
- [x] Course page, catalogue, home page with course cards
- [x] AudioPlayer component (shell — real audio via R2 when generated)
- [x] BaseLayout + LessonLayout with breadcrumbs
- [x] Progressive enhancement (without JS, beats show as long scroll)

### Stage 3 — Reader Accounts & Progress (complete)
- [x] Astro Cloudflare adapter (static pages + server-rendered API routes)
- [x] D1 database: 9 tables (see `docs/SCHEMA.md`)
- [x] Anonymous-first auth middleware (cookie on first API call)
- [x] Progress API: save beat, mark complete, fetch progress
- [x] Auth API: email upgrade, login, logout
- [x] PBKDF2 password hashing via Web Crypto API
- [x] Account page, login page
- [x] Security headers (`public/_headers` — X-Frame, CSP, XSS, etc.)
- [x] Rate limiting on login (5 attempts per 15 min per IP)
- [x] lesson-shell POSTs progress (fire-and-forget, offline-safe)

### Stage 4 — Agent Team (complete — all 13 agents built)
- [x] Separate `agents/` Worker with Cloudflare Agents SDK (v0.11.1)
- [x] DirectorAgent — supervisor, scheduled daily at 8am UTC, manual trigger
- [x] CuratorAgent — lesson planning via Claude API
- [x] DrafterAgent — MDX generation via Claude API
- [x] VoiceAuditorAgent — scores voice compliance 0-100, ≥85 to pass
- [x] StructureEditorAgent — reviews beat structure, pacing
- [x] FactCheckerAgent — verifies claims (Claude reasoning only, no web search yet)
- [x] IntegratorAgent — merges audit feedback, revises draft, up to 3 rounds
- [x] AudioProducerAgent — ElevenLabs TTS (Frederick Surrey), saves MP3 to R2
- [x] AudioAuditorAgent — verifies audio files in R2, checks sizes
- [x] PublisherAgent — commits MDX to GitHub via Contents API
- [x] ObserverAgent — logs events, provides digest/events endpoints
- [x] EngagementAnalystAgent — reads completion/drop-off data from D1
- [x] ReviserAgent — proposes revisions from engagement signals via Claude
- [x] Full pipeline: Curate → Draft → 3 parallel auditors → Revise → Audio → Publish
- [x] Auth on trigger endpoint (ADMIN_SECRET bearer token)
- [x] Dashboard at `/dashboard/` (requires email account, has manual trigger)
- [x] Audit results persisted to D1 `audit_results` table
- [x] R2 bucket `zeemish-audio` for audio storage

### Stage 5 — First Real Course (complete)
- [x] 12 lessons for "The body you live in" — all agent-authored
- [x] Each passed voice, structure, and fact-check gates
- [x] Published via PublisherAgent to GitHub

### Stage 6 — Self-Improvement Loop (partially complete)
- [x] EngagementAnalystAgent built and deployed
- [x] ReviserAgent built and deployed
- [x] Engagement tracking API (`/api/engagement/track`)
- [x] lesson-shell tracks views and completions
- [x] D1 tables: engagement, learnings
- [ ] Learnings database not yet populated by any agent
- [ ] Prompt-improvement loop not yet built

### Stage 7 — Zita (complete)
- [x] Zita chat API (`/api/zita/chat`) — Socratic guide via Claude API
- [x] `<zita-chat>` Web Component — floating chat on lesson pages
- [x] Per-user per-lesson conversation history in D1
- [x] Integrated into LessonLayout

## What's NOT built (honest gaps)

### Small remaining items
- Resend email uses test domain — needs verified sending domain for production
- Voice contract duplicated in .md and .ts — manual sync required
- Per-day spending cap is hardcoded (MAX_LESSONS_PER_DAY = 2), not an env var

## Deviations from plan
1. **Single Astro Worker for site + API** instead of separate workers. Avoids CORS.
2. **Workflows v2 added** — PublishLessonWorkflow wraps the pipeline in durable steps.
3. **Agent code is flat files** (`curator.ts`) not subdirectories (`curator/agent.ts`).
4. **Dashboard is in Astro site** not a separate `dashboard/` project.
5. **Fact-Checker uses Claude reasoning only**, not Workers AI Search.
6. **Lesson titles differ from original course spine** — agents chose their own topics.
7. **Audio failure doesn't block publishing** — text lesson still ships, audio issue logged.
