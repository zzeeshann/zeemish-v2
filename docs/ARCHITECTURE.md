# Zeemish v2 — Living Architecture

The canonical architecture is in `handoff/ZEEMISH-V2-ARCHITECTURE-REVISED.md`. This file tracks what's **actually built** vs. what's planned.

## What's built

### Stage 1 — Foundation (complete)
- [x] Directory skeleton matching architecture Section 6
- [x] Astro + Tailwind + MDX + TypeScript strict
- [x] Cloudflare Workers deploy (wrangler.toml + Static Assets)
- [x] GitHub Actions CI/CD (auto-deploy on push to main)

### Stage 2 — Reader Surface (complete)
- [x] Content collections (courses + lessons) with Zod schemas
- [x] `<lesson-shell>` + `<lesson-beat>` Web Components for beat navigation
- [x] Dummy lesson: "The body you're in" (5 beats)
- [x] Course page, catalogue, home page with course cards
- [x] AudioPlayer shell component (visual only, no real audio)
- [x] BaseLayout + LessonLayout with breadcrumbs

### Stage 3 — Reader Accounts & Progress (complete)
- [x] Astro with Cloudflare adapter (static pages + server-rendered API)
- [x] D1 database: users, progress, submissions, zita_messages
- [x] Anonymous-first auth middleware (auto cookie on first API call)
- [x] Progress API: save beat position, mark lesson complete, fetch progress
- [x] Auth API: email upgrade, login, logout
- [x] Password hashing via Web Crypto API (PBKDF2)
- [x] Account page with progress display
- [x] Login page with email+password
- [x] Security headers (_headers file)
- [x] lesson-shell POSTs progress to API (fire-and-forget, offline-safe)

### Stage 4 — Agent Team, Week 7 (in progress)
- [x] Separate `agents/` Worker with Cloudflare Agents SDK
- [x] DirectorAgent (supervisor, manual trigger, status)
- [x] CuratorAgent (lesson planning via Claude API)
- [x] DrafterAgent (MDX generation via Claude API)
- [x] Voice contract and subject values files
- [x] Manual trigger endpoint: POST /trigger?course=slug&lesson=number
- [x] Status endpoint: GET /status
- [x] Tested end-to-end: Curator + Drafter produce lesson MDX
- [x] VoiceAuditorAgent (scores voice compliance 0-100, ≥85 to pass)
- [x] StructureEditorAgent (reviews beat structure, pacing, length)
- [x] FactCheckerAgent (verifies factual claims)
- [x] IntegratorAgent (merges feedback, revises draft, up to 3 rounds)
- [x] Full pipeline: Curate → Draft → 3 auditors in parallel → Revise loop
- [x] PublisherAgent (commits MDX to repo via GitHub Contents API, triggers deploy)
- [x] First agent-authored lesson published end-to-end
- [ ] Audio-Producer, Audio-Auditor (ElevenLabs)
- [ ] Observer + dashboard

## What's not yet built
- Stage 4 weeks 8-11: Quality gates, publisher, audio, observer
- Stage 5: First real course (agent-produced)
- Stage 6: Self-improvement loop
- Stage 7: Zita

## Deviations from plan
1. **Single Worker instead of separate site + API workers.** Astro's Cloudflare adapter serves both static pages and API routes from one Worker. Simpler than two separate deploys and avoids CORS. Can split later if needed.
2. **No `output: 'hybrid'` — Astro 5 removed it.** Pages are static by default; individual routes opt into server rendering with `export const prerender = false`.
3. **Passphrase auth deferred.** Core email+password flow built first. Passphrase (6 BIP39 words) can be added later without schema changes.
