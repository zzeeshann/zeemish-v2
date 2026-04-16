# Zeemish v2 — Claude Code Context

## Current stage
**All 7 stages built.** System is functional end-to-end. Key gaps remain: audio agents, Workflows v2, auth on agents endpoint.

## What was last worked on (most recent first)
- Documentation cleanup: all docs updated to match reality
- Stage 7: Zita Socratic learning guide (chat API + Web Component)
- Stage 6: EngagementAnalyst + Reviser agents, engagement tracking API
- Stage 5: 12-lesson "body" course produced by agent team
- Stage 4 weeks 10-11: ObserverAgent, dashboard page
- Stage 4 week 9: PublisherAgent, end-to-end auto-publishing
- Stage 4 week 8: VoiceAuditor, StructureEditor, FactChecker, Integrator
- Stage 4 week 7: DirectorAgent, CuratorAgent, DrafterAgent
- Stage 3: anonymous-first auth, D1 database, progress API, account/login
- Stage 2: lesson Web Components, beat navigation, content collections
- Stage 1: repo skeleton, Astro + Tailwind + MDX, Cloudflare deploy

## Architecture source of truth
`docs/handoff/ZEEMISH-V2-ARCHITECTURE-REVISED.md` — read this before making any technical decisions.

## Stack
- Frontend: Astro + MDX + TypeScript strict + Tailwind
- Backend: Cloudflare Workers (Astro adapter) + D1 + R2 (not yet configured)
- Agents: Cloudflare Agents SDK v0.11.1 (Durable Objects) — separate Worker
- AI: Anthropic Claude (Sonnet 4.5)
- Audio: ElevenLabs (NOT YET INTEGRATED)
- Deploy: GitHub Actions → Cloudflare (site only; agents deployed manually)

## Key architecture notes
- Single Astro Worker serves static pages + API routes
- Separate agents/ Worker for the 11 AI agents
- Auth middleware only runs on /api/, /account, /login routes
- D1 database `zeemish` with 8 tables (see `docs/SCHEMA.md`)
- Passwords hashed with PBKDF2 via Web Crypto API
- Pipeline: Curate → Draft → 3 parallel auditors → Revise loop → Publish

## Known gaps (honest list)
- Audio-Producer and Audio-Auditor agents NOT BUILT (no ElevenLabs)
- No R2 bucket configured for audio storage
- No Cloudflare Workflows v2 (pipeline is synchronous RPC)
- No auth on agents trigger endpoint (security risk)
- No auth on dashboard page
- No scheduled Director/EngagementAnalyst runs (manual only)
- No rate limiting
- Fact-Checker has no web search (Claude reasoning only)
- Passphrase auth not implemented
- Magic link / password reset not built
- `audit_results` D1 table not created
- GitHub Actions does not deploy agents worker
- Voice contract duplicated in .md and .ts (drift risk)

## Key rules
- TypeScript strict everywhere
- No React/Vue as whole-site framework (Astro islands OK)
- No new dependencies without justification
- Docs updated alongside code, same commit
- Explain decisions as you build (Zishan is learning)
