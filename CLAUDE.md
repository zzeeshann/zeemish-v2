# Zeemish v2 — Claude Code Context

**Read this first. Then read `docs/handoff/ZEEMISH-V2-ARCHITECTURE-REVISED.md` for the full architecture.**

## What Zeemish v2 is

An autonomous multi-agent publishing system. 13 AI agents decide what to publish, draft lessons, audit them through quality gates, generate audio, and publish — all without human intervention. Readers see a polished learning site. Behind it runs the agent team.

## Current state

**Complete.** All 7 stages built + Daily Pieces system. 14 agents deployed, 12-lesson course + daily news-driven teaching. Security hardened.

## What was built (in order)

1. **Stage 1 — Foundation:** Astro + Tailwind + MDX + TypeScript strict, Cloudflare Workers, GitHub Actions CI/CD
2. **Stage 2 — Reader Surface:** `<lesson-shell>` + `<lesson-beat>` Web Components for beat-by-beat navigation, content collections, course/catalogue pages, progressive enhancement
3. **Stage 3 — Accounts & Progress:** Anonymous-first auth (cookie on first API call), D1 database, progress tracking, email upgrade, login/account pages, PBKDF2 password hashing
4. **Stage 4 — Agent Team:** 13 agents on Cloudflare Agents SDK, full publishing pipeline (Curate → Draft → 3 parallel auditors → Revise loop → Audio → Publish), quality gates, observer dashboard
5. **Stage 5 — First Course:** "The body you live in" — 12 lessons produced by the agent team
6. **Stage 6 — Self-Improvement:** Engagement tracking, EngagementAnalyst + Reviser agents, learnings database
7. **Stage 7 — Zita:** Socratic learning guide in every lesson, per-user conversation history

## Architecture

### Two Workers
- **zeemish-v2** (`wrangler.toml`) — Astro site serving pages + API routes. URL: `https://zeemish-v2.zzeeshann.workers.dev`
- **zeemish-agents** (`agents/wrangler.toml`) — 13 AI agents as Durable Objects. URL: `https://zeemish-agents.zzeeshann.workers.dev`

### Stack
- Frontend: Astro + MDX + TypeScript strict + Tailwind + Web Components
- Backend: Cloudflare Workers (Astro adapter) + D1 (10 tables) + R2 (audio)
- Agents: Cloudflare Agents SDK v0.11.1 + Workflows v2
- AI: Anthropic Claude Sonnet 4.5 (all agents + Zita)
- Audio: ElevenLabs (Frederick Surrey voice)
- Email: Resend (magic link login from hello@zeemish.io)
- Deploy: GitHub Actions → Cloudflare (both workers auto-deploy on push)

### The 14 Agents
1. **DirectorAgent** — supervisor, scheduled daily 8am UTC, orchestrates pipeline
2. **CuratorAgent** — plans lessons from subject values
3. **DrafterAgent** — writes MDX via Claude
4. **VoiceAuditorAgent** — voice compliance gate (≥85/100 to pass)
5. **StructureEditorAgent** — beat structure & pacing gate
6. **FactCheckerAgent** — verifies claims (two-pass: Claude + DuckDuckGo)
7. **IntegratorAgent** — merges audit feedback, revises (3 rounds max)
8. **AudioProducerAgent** — ElevenLabs TTS, saves MP3 to R2
9. **AudioAuditorAgent** — verifies audio files in R2
10. **PublisherAgent** — commits MDX to GitHub via Contents API
11. **ObserverAgent** — event logging, daily digest
12. **EngagementAnalystAgent** — reads completion/drop-off data
13. **ReviserAgent** — proposes improvements from engagement signals
14. **ScannerAgent** — fetches Google News RSS, stores daily candidates in D1

### Database (D1 — 10 tables)
See `docs/SCHEMA.md` for full details.
- Reader: users, progress, submissions, zita_messages, magic_tokens
- Agent: agent_tasks, observer_events, engagement, learnings, audit_results
- Daily: daily_candidates, daily_pieces

### Key directories
```
src/pages/           Astro pages + API routes
src/interactive/     Web Components (lesson-shell, lesson-beat, zita-chat)
src/lib/             Auth, DB helpers, rate limiting
src/layouts/         BaseLayout, LessonLayout
content/lessons/     MDX lesson files (by course)
content/daily-pieces/ Daily teaching pieces (YYYY-MM-DD-slug.mdx)
content/courses/     Course metadata
agents/src/          All 13 agent files + workflows + shared code
migrations/          D1 schema migrations (0001-0005)
docs/                Living documentation
docs/handoff/        Original architecture documents
```

### Security measures
- Session cookies: HttpOnly, Secure, SameSite=Lax
- Password hashing: PBKDF2 100k iterations with timing-safe comparison
- CSRF: Origin header check on all POST requests
- Rate limiting: login (5/15min), Zita chat (20/15min), upgrade (5/15min)
- Agents trigger: ADMIN_SECRET bearer token required
- Dashboard: requires authenticated user with email
- Input validation: JSON try-catch, message length limits
- CSP header with restricted sources
- CORS restricted to site domain on agents endpoints

### Secrets (never in code)
**Site worker:** ANTHROPIC_API_KEY, RESEND_API_KEY, AGENTS_ADMIN_SECRET
**Agents worker:** ANTHROPIC_API_KEY, GITHUB_TOKEN, ELEVENLABS_API_KEY, ADMIN_SECRET

## Documentation index
- `docs/ARCHITECTURE.md` — what's built vs. what's planned, deviations
- `docs/AGENTS.md` — all 13 agents, endpoints, secrets, limitations
- `docs/SCHEMA.md` — all 10 D1 tables with column details
- `docs/RUNBOOK.md` — how to run, deploy, trigger, query, revert
- `docs/DECISIONS.md` — 23 technical decisions (append-only log)
- `docs/handoff/ZEEMISH-V2-ARCHITECTURE-REVISED.md` — the original plan

## Remaining minor items
- Voice contract duplicated in `content/voice-contract.md` and `agents/src/shared/voice-contract.ts` — keep in sync manually
- Rate limiter is in-memory (resets on Worker restart) — acceptable for now
- Audio-Auditor does file checks only (no STT round-trip)
- CSP uses `unsafe-inline` for scripts (required by Astro)

## Key rules
- TypeScript strict everywhere
- No React/Vue as whole-site framework (Astro islands OK)
- No new dependencies without justification
- Docs updated alongside code, same commit
- Explain decisions as you build (Zishan is learning)
- Voice contract: plain English, no jargon, no tribe words, short sentences
