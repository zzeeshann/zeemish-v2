# Zeemish v2 — Living Architecture

The canonical architecture is in `handoff/ZEEMISH-V2-ARCHITECTURE-REVISED.md`. This file tracks what's **actually built** vs. what's planned.

## Hard rule: published content is permanent

**Published pieces are permanent. Any agent can READ old pieces to learn from them. No agent WRITES to, revises, regenerates, or updates any published piece. All improvements feed forward into the learnings database and improve future pieces only.**

This applies to every agent. No exceptions. The past stays. The future gets better.

## What's built

### Stage 1 — Foundation (complete)
- [x] Directory skeleton
- [x] Astro + Tailwind + MDX + TypeScript strict
- [x] Cloudflare Workers deploy (wrangler.toml + Static Assets)
- [x] GitHub Actions CI/CD (auto-deploys both site and agents on push to main)

### Stage 2 — Reader Surface (complete)
- [x] Content collections (dailyPieces) with Zod schemas
- [x] `<lesson-shell>` + `<lesson-beat>` Web Components for beat navigation (one beat at a time)
- [x] Beat CSS in standalone `src/styles/beats.css` (not Tailwind-processed, survives purging)
- [x] AudioPlayer component (shell — real audio via R2 when generated)
- [x] BaseLayout + LessonLayout with breadcrumbs
- [x] Progressive enhancement (without JS, beats show as long scroll)
- [x] `formatDate()` and `formatTime()` helpers in `src/lib/format.ts`

### Stage 3 — Reader Accounts & Progress (complete)
- [x] Astro Cloudflare adapter (static pages + server-rendered API routes)
- [x] D1 database: 12 tables (see `docs/SCHEMA.md`)
- [x] Anonymous-first auth middleware (cookie on first API call)
- [x] Progress API: save beat, mark complete, fetch progress
- [x] Auth API: email upgrade, login, logout
- [x] PBKDF2 password hashing via Web Crypto API
- [x] Account page, login page
- [x] Security headers (`public/_headers` — X-Frame, CSP, XSS, etc.)
- [x] Rate limiting on login (5 attempts per 15 min per IP)
- [x] lesson-shell POSTs progress (fire-and-forget, offline-safe)

### Stage 4 — Agent Team (complete — 13 agents, 2 paused)
- [x] Separate `agents/` Worker with Cloudflare Agents SDK (v0.11.1)
- [x] DirectorAgent — pure orchestrator, zero LLM calls, scheduled daily at 2am UTC, manual trigger
- [x] CuratorAgent — picks most teachable story, plans beats (restored from v10 deletion; owns its prompt file)
- [x] DrafterAgent — writes MDX from brief (restored from v10 deletion; owns its prompt file)
- [x] VoiceAuditorAgent — scores voice compliance 0-100, ≥85 to pass (owns its prompt file)
- [x] StructureEditorAgent — reviews beat structure, pacing; writes learnings for both passing (confidence 60) and failing (40) drafts (owns its prompt file)
- [x] FactCheckerAgent — verifies claims (two-pass: Claude + DuckDuckGo web search); exposes `searchAvailable` on result, Director logs an Observer warn when search fails so the pipeline honours the "no silent failure" principle (owns its prompt file)
- [x] IntegratorAgent — merges audit feedback, revises draft, up to 3 rounds; stateless (fresh DO per day: `integrator-daily-${today}`) (owns its prompt file)
- [x] AudioProducerAgent — ElevenLabs TTS (Frederick Surrey), saves MP3 to R2 — **paused** (excluded from pipeline)
- [x] AudioAuditorAgent — verifies audio files in R2, checks sizes — **paused** (excluded from pipeline)
- [x] PublisherAgent — commits MDX to GitHub via Contents API
- [x] ObserverAgent — logs events, provides digest/events endpoints
- [x] LearnerAgent — watches engagement + writes learnings for future pieces; uses shared `extractJson` parser (merged from EngagementAnalyst + Reviser; owns its prompt file)
- [x] Full pipeline: Scanner → Curator → Drafter → 3 parallel auditors → Integrator (if any gate fails) → Publisher
- [x] Auth on trigger endpoint (ADMIN_SECRET bearer token)
- [x] Dashboard: `/dashboard/` (public factory floor) + `/dashboard/admin/` (ADMIN_EMAIL gated)
- [x] Audit results persisted to D1 `audit_results` table (migration 0008 fixed the orphaned FK that had silently blocked all writes — see DECISIONS.md)
- [x] R2 bucket `zeemish-audio` for audio storage (unused while audio paused)
- [x] Optional `SCANNER_RSS_FEEDS_JSON` env override lets ops change Scanner's feed list without a redeploy

### Stage 5 — First Course (removed)
- Course content deleted — daily pieces are now the primary content unit
- "The body you live in" served its purpose as a testing ground for the pipeline
- Library page at /library/ replaces /courses/

### Stage 6 — Self-Improvement Loop (partially complete)
- [x] EngagementAnalystAgent built and deployed
- [x] LearnerAgent built (merged from EngagementAnalyst + Reviser)
- [x] Engagement tracking API (`/api/engagement/track`)
- [x] lesson-shell tracks views and completions
- [x] D1 tables: engagement, learnings
- [x] StructureEditorAgent writes learnings (both passing and failing drafts) into the learnings DB
- [x] LearnerAgent writes engagement-driven learnings (when underperforming pieces are analysed)
- [ ] Prompt-improvement loop not yet built — Director doesn't consume learnings to propose prompt edits

### Stage 7 — Zita (complete)
- [x] Zita chat API (`/api/zita/chat`) — Socratic guide via Claude API
- [x] `<zita-chat>` Web Component — floating chat on lesson pages
- [x] Per-user per-lesson conversation history in D1
- [x] Integrated into LessonLayout

### Daily Pieces System (complete)
- [x] ScannerAgent (#14) — fetches Google News RSS across 6 categories
- [x] Director daily mode — picks most teachable story, writes brief, runs pipeline
- [x] Daily piece pages at /daily/ and /daily/YYYY-MM-DD/
- [x] Home page redesign — today's piece prominent, library below
- [x] D1 tables: daily_candidates, daily_pieces (migration 0006)
- [x] Content collection: dailyPieces with date/newsSource/underlyingSubject schema
- [x] Scheduled: Scanner + Director at 2am UTC weekdays
- [x] First daily piece published and live
- [ ] Weekend evergreen mode (weekdays only for now)

## What's NOT built (honest gaps)

### Small remaining items
- Voice contract duplicated in .md and .ts — manual sync required
- Weekend daily pieces not yet implemented

## Deviations from plan
1. **Single Astro Worker for site + API** instead of separate workers. Avoids CORS.
2. **Workflows v2 added** — PublishLessonWorkflow wraps the pipeline in durable steps.
3. **Agent code is flat files** (e.g. `scanner.ts`) not subdirectories.
4. **Dashboard is in Astro site** not a separate `dashboard/` project.
5. **Fact-Checker uses Claude reasoning only**, not Workers AI Search.
6. **Daily pieces only** — courses removed, daily news-driven teaching is the only content type.
7. **Audio failure doesn't block publishing** — text lesson still ships, audio issue logged (audio currently paused anyway).
8. **Audio agents paused by design** — Audio Producer and Audio Auditor exist as files but are not wired into Director's pipeline. Cost control until text pipeline is fully trusted.
9. **Per-agent prompt files** — every pipeline agent owns its prompt file: `curator-prompt.ts`, `drafter-prompt.ts`, `voice-auditor-prompt.ts`, `structure-editor-prompt.ts`, `fact-checker-prompt.ts`, `integrator-prompt.ts`, `learner-prompt.ts`. Matches the "one prompt per agent, co-located" principle in AGENTS.md. `shared/prompts.ts` is a tombstone.
10. **No silent failure enforcement** — Director logs an Observer warn (severity='warn') when FactChecker's web search is unavailable, so the draft is known to have been assessed by Claude's first-pass only.
