# Zeemish v2 — Claude Code Context

**Read this first. Then read `docs/handoff/ZEEMISH-V2-ARCHITECTURE-REVISED.md` and `docs/handoff/ZEEMISH-DAILY-PIECES.md`.**

## The Zeemish Protocol

**"Educate myself for humble decisions."**

"Most human suffering — personal, in organisations, and across the world — comes from treating connected things as if they were separate. The cure is learning to see and work with the whole."

## What Zeemish v2 is

An autonomous multi-agent publishing system. 13 AI agents scan the news, decide what to teach, draft pieces, audit them through quality gates, and publish — all without human intervention. Readers see a daily teaching piece anchored in today's news, with a growing library of past pieces.

## Current state

**Complete.** 13 agents deployed (Audio Producer + Audio Auditor paused by design, to protect ElevenLabs spend until the text pipeline is fully trusted). Daily news-driven teaching operational, public + admin dashboard, security hardened. Daily pieces are the only content type.

Each agent does one job and lives in one file. Director is a pure orchestrator — zero LLM calls. Curator picks the story, Drafter writes the MDX, auditors gate quality, Integrator revises, Publisher ships. "Paused" is a structural fact, not a label: Director's pipeline does not reference the audio agents, so no ElevenLabs spend is possible by accident.

## What was built

1. **Foundation:** Astro + Tailwind + MDX + TypeScript strict, Cloudflare Workers, GitHub Actions CI/CD
2. **Reader Surface:** Beat-by-beat navigation Web Components (one beat at a time), content collections
3. **Accounts & Progress:** Anonymous-first auth, D1, progress tracking, magic link login (Resend)
4. **Agent Team:** 13 agents on Cloudflare Agents SDK, full pipeline with quality gates (2 paused)
5. **Self-Improvement:** Engagement tracking, LearnerAgent, learnings database
6. **Zita:** Socratic learning guide in every piece
7. **Daily Pieces:** ScannerAgent, Director daily mode, news-driven teaching every weekday at 2am UTC
8. **Dashboard:** Public factory floor (/dashboard/) + admin control room (/dashboard/admin/)

## Architecture

### Two Workers
- **zeemish-v2** — Astro site: pages + API routes. `https://zeemish-v2.zzeeshann.workers.dev`
- **zeemish-agents** — 13 agents as Durable Objects. `https://zeemish-agents.zzeeshann.workers.dev`

### Stack
- Frontend: Astro + MDX + TypeScript strict + Tailwind + Web Components
- Backend: Cloudflare Workers (Astro adapter) + D1 (13 tables) + R2 (audio)
- Agents: Cloudflare Agents SDK v0.11.1
- AI: Anthropic Claude Sonnet 4.5
- Audio: ElevenLabs (Frederick Surrey voice)
- Email: Resend (magic link from hello@zeemish.io)
- Deploy: GitHub Actions → Cloudflare (both workers auto-deploy)

### The 13 Agents (one job per agent, one file per agent)

Pipeline: Scanner → Curator → Drafter → [Voice, Structure, Fact] → Integrator → Publisher. Audio agents excluded from the pipeline (paused). Observer receives events throughout. Learner runs off-pipeline, watching readers.

1. **ScannerAgent** — reads the news every morning
2. **DirectorAgent** — pure orchestrator. Routes work between agents. Zero LLM calls. Scheduled daily 2am UTC weekdays.
3. **CuratorAgent** — picks the most teachable story from today's candidates, plans beats + hook + teaching angle
4. **DrafterAgent** — writes the MDX from the brief, enforces `<lesson-shell>` / `<lesson-beat>` format
5. **VoiceAuditorAgent** — voice compliance gate (≥85/100)
6. **FactCheckerAgent** — verifies every claim (two-pass: Claude + DuckDuckGo)
7. **StructureEditorAgent** — reviews flow and pacing
8. **IntegratorAgent** — handles revisions before approval (3 rounds max)
9. **AudioProducerAgent** — generates audio via ElevenLabs, saves to R2. **Paused.**
10. **AudioAuditorAgent** — checks pronunciation and audio quality. **Paused.**
11. **PublisherAgent** — commits to GitHub, piece goes live
12. **LearnerAgent** — learns from reader behaviour, writes patterns for future pieces
13. **ObserverAgent** — logs every pipeline event for the admin dashboard

### Dashboard
- **Public** (`/dashboard/`) — anyone can visit. Shows pipeline status, quality scores, agent team, library stats, recent pieces. Transparency is the brand.
- **Admin** (`/dashboard/admin/`) — ADMIN_EMAIL only. Pipeline controls, observer events with acknowledge, engagement data, agent tasks.

### Database (D1 — 13 tables, 7 migrations)
See `docs/SCHEMA.md`.
- Reader: users, progress, submissions, zita_messages, magic_tokens
- Agent: agent_tasks, observer_events, engagement, learnings, audit_results
- Daily: daily_candidates, daily_pieces

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
- `docs/SCHEMA.md` — all 13 D1 tables, 7 migrations
- `docs/RUNBOOK.md` — how to run, deploy, trigger, revert
- `docs/DECISIONS.md` — technical decisions (append-only)
- `docs/handoff/` — original specs (architecture, daily pieces, dashboard, project brief, instructions)

## Remaining minor items
- Voice contract .ts has belief line synced, but may drift — .md is canonical
- Audio-Auditor does file checks only (no STT round-trip)
- Weekend daily pieces not yet implemented (weekdays only)
- Rate limiter is in-memory (resets on Worker restart)
- CSP uses `unsafe-inline` for scripts (required by Astro)

## Hard rule
**Published pieces are permanent. No agent writes to, revises, regenerates, or updates any published piece. All improvements feed forward into the learnings database and improve future pieces only.**

## Key rules
- TypeScript strict everywhere
- No new dependencies without justification
- Docs updated alongside code, same commit
- Voice contract: plain English, no jargon, no tribe words, short sentences
- When in doubt: "Does this help someone educate themselves for humble decisions?"
