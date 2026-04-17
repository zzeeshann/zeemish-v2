# Zeemish v2 — Claude Code Context

**Read this first. Then read `docs/handoff/ZEEMISH-V2-ARCHITECTURE-REVISED.md` for the original architecture and `docs/handoff/ZEEMISH-DAILY-PIECES.md` for the daily content system.**

## The Zeemish Protocol

**"Educate myself for humble decisions."**

Every piece, every agent, every design choice serves this purpose.

## What Zeemish v2 is

An autonomous multi-agent publishing system. 14 AI agents scan the news, decide what to teach, draft pieces, audit them through quality gates, generate audio, and publish — all without human intervention. Readers see a daily teaching piece anchored in today's news, with a growing library of past pieces.

## Current state

**Complete.** All stages built + Daily Pieces system. 14 agents deployed, 12-lesson course live, daily news-driven teaching operational. Security hardened.

## What was built (in order)

1. **Stage 1 — Foundation:** Astro + Tailwind + MDX + TypeScript strict, Cloudflare Workers, GitHub Actions CI/CD
2. **Stage 2 — Reader Surface:** Beat-by-beat navigation Web Components, content collections, course pages
3. **Stage 3 — Accounts & Progress:** Anonymous-first auth, D1 database, progress tracking, email upgrade, magic link login
4. **Stage 4 — Agent Team:** 14 agents (13 core + ScannerAgent) + Workflows v2, full publishing pipeline with quality gates
5. **Stage 5 — First Course:** (course content removed — daily pieces are now primary)
6. **Stage 6 — Self-Improvement:** Engagement tracking, EngagementAnalyst + Reviser agents, learnings database
7. **Stage 7 — Zita:** Socratic learning guide in every piece
8. **Daily Pieces System:** ScannerAgent (#14), Director daily mode, news-driven teaching every weekday morning
9. **Content Cleanup:** Courses removed, Library replaces Courses, nav: Daily · Library · Dashboard · Account

## Architecture

### Two Workers
- **zeemish-v2** (`wrangler.toml`) — Astro site: pages + API routes. `https://zeemish-v2.zzeeshann.workers.dev`
- **zeemish-agents** (`agents/wrangler.toml`) — 14 agents as Durable Objects. `https://zeemish-agents.zzeeshann.workers.dev`

### Stack
- Frontend: Astro + MDX + TypeScript strict + Tailwind + Web Components
- Backend: Cloudflare Workers (Astro adapter) + D1 (12 tables) + R2 (audio)
- Agents: Cloudflare Agents SDK v0.11.1 + Workflows v2
- AI: Anthropic Claude Sonnet 4.5
- Audio: ElevenLabs (Frederick Surrey voice)
- Email: Resend (magic link login from hello@zeemish.io)
- Deploy: GitHub Actions → Cloudflare (both workers auto-deploy on push)

### The 14 Agents
1. **DirectorAgent** — supervisor, scheduled daily 6am + 8am UTC
2. **CuratorAgent** — plans lessons from subject values
3. **DrafterAgent** — writes MDX via Claude
4. **VoiceAuditorAgent** — voice compliance gate (≥85/100)
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

### Database (D1 — 12 tables, 6 migrations)
See `docs/SCHEMA.md` for full details.
- Reader: users, progress, submissions, zita_messages, magic_tokens
- Agent: agent_tasks, observer_events, engagement, learnings, audit_results
- Daily: daily_candidates, daily_pieces

### Key directories
```
src/pages/              Astro pages + API routes
src/pages/daily/        Daily piece pages
src/interactive/        Web Components (lesson-shell, lesson-beat, zita-chat)
src/lib/                Auth, DB helpers, rate limiting
src/layouts/            BaseLayout, LessonLayout
content/lessons/        MDX lesson files (reserved for future use)
content/daily-pieces/   Daily teaching pieces (YYYY-MM-DD-slug.mdx)
content/voice-contract.md  Voice rules + Zeemish Protocol
agents/src/             All 14 agent files + workflows + shared code
migrations/             D1 schema migrations (0001-0006)
docs/                   Living documentation
docs/handoff/           Original architecture + daily pieces documents
```

### Security measures
- Session cookies: HttpOnly, Secure, SameSite=Lax
- Password hashing: PBKDF2 100k iterations with timing-safe comparison
- CSRF: Origin header check (strict URL parsing) on all POST requests
- Rate limiting: login (5/15min), Zita chat (20/15min), upgrade (5/15min)
- Agents: ADMIN_SECRET bearer token on all admin endpoints + CORS preflight
- Dashboard: requires authenticated user with email
- Input validation: JSON try-catch, message length limits
- CSP header, X-Frame-Options DENY, restricted CORS origins

### Secrets (never in code)
**Site worker:** ANTHROPIC_API_KEY, RESEND_API_KEY, AGENTS_ADMIN_SECRET
**Agents worker:** ANTHROPIC_API_KEY, GITHUB_TOKEN, ELEVENLABS_API_KEY, ADMIN_SECRET

## Documentation index
- `docs/ARCHITECTURE.md` — what's built vs. what's planned, deviations
- `docs/AGENTS.md` — all 14 agents, endpoints, secrets, limitations
- `docs/SCHEMA.md` — all 12 D1 tables with column details, 6 migrations
- `docs/RUNBOOK.md` — how to run, deploy, trigger, query, revert
- `docs/DECISIONS.md` — technical decisions (append-only log)
- `docs/handoff/ZEEMISH-V2-ARCHITECTURE-REVISED.md` — the original plan
- `docs/handoff/ZEEMISH-DAILY-PIECES.md` — daily content system design

## Remaining minor items
- Voice contract duplicated in `content/voice-contract.md` and `agents/src/shared/voice-contract.ts`
- Rate limiter is in-memory (resets on Worker restart)
- Audio-Auditor does file checks only (no STT round-trip)
- CSP uses `unsafe-inline` for scripts (required by Astro)
- Weekend daily pieces not yet implemented (weekdays only)

## Key rules
- TypeScript strict everywhere
- No React/Vue as whole-site framework (Astro islands OK)
- No new dependencies without justification
- Docs updated alongside code, same commit
- Explain decisions as you build (Zishan is learning)
- Voice contract: plain English, no jargon, no tribe words, short sentences
