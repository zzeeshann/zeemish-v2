# Zeemish v2 — Claude Code Context

## Current stage
**Stage 4 — Agent Team** (weeks 7-11 complete). 9 agents, full pipeline, quality gates, auto-publishing, observer dashboard. Ready for Stage 5.

## What was last worked on
- Stage 4 weeks 10-11: ObserverAgent, dashboard page, event logging
- Stage 4 week 9: PublisherAgent, end-to-end publishing (first agent-authored lesson committed to repo)
- Stage 4 week 8: VoiceAuditor, StructureEditor, FactChecker, Integrator, revision loop
- Stage 4 week 7: agents/ Worker, DirectorAgent, CuratorAgent, DrafterAgent, manual trigger endpoint
- Stage 3: anonymous-first auth, D1 database, progress API, account/login pages
- Stage 2: lesson Web Components, beat navigation, content collections, course pages
- Stage 1: repo skeleton, Astro + Tailwind + MDX, Cloudflare deploy, GitHub Actions CI/CD

## Architecture source of truth
`docs/handoff/ZEEMISH-V2-ARCHITECTURE-REVISED.md` — read this before making any technical decisions.

## Stack
- Frontend: Astro + MDX + TypeScript strict + Tailwind
- Backend: Cloudflare Workers (Astro adapter) + D1 + R2
- Agents: Cloudflare Agents SDK + Workflows v2 (Stage 4+)
- AI: Anthropic Claude
- Audio: ElevenLabs
- Deploy: GitHub Actions → Cloudflare

## Key architecture notes
- Single Astro Worker serves both static pages and API routes (no separate worker/ project)
- Pages are prerendered by default; API routes + account/login are server-rendered (`prerender = false`)
- Auth middleware only runs on server-rendered routes (API, account, login)
- D1 database: `zeemish` (see `docs/SCHEMA.md` and `migrations/0001_init.sql`)
- Passwords hashed with PBKDF2 via Web Crypto API (no npm deps)

## Known issues / blockers
- Passphrase auth not yet implemented (email+password works)
- Magic link / password reset not yet built
- No rate limiting yet

## Key rules
- TypeScript strict everywhere
- No React/Vue as whole-site framework (Astro islands OK)
- No new dependencies without justification
- Docs updated alongside code, same commit
- Explain decisions as you build (Zishan is learning)
