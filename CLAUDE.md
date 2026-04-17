# Zeemish v2 — Claude Code Context

## Current stage
**All 7 stages built. All 13 agents built.** System is functional end-to-end with audio generation. Remaining gap: Cloudflare Workflows v2 for durability.

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
- Backend: Cloudflare Workers (Astro adapter) + D1 + R2 (zeemish-audio bucket)
- Agents: Cloudflare Agents SDK v0.11.1 (Durable Objects) — separate Worker
- AI: Anthropic Claude (Sonnet 4.5)
- Audio: ElevenLabs (Frederick Surrey voice, saves to R2)
- Deploy: GitHub Actions → Cloudflare (both site and agents worker)

## Key architecture notes
- Single Astro Worker serves static pages + API routes
- Separate agents/ Worker for all 13 AI agents
- Auth middleware only runs on /api/, /account, /login routes
- D1 database `zeemish` with 9 tables (see `docs/SCHEMA.md`)
- Passwords hashed with PBKDF2 via Web Crypto API
- Pipeline: Curate → Draft → 3 parallel auditors → Revise loop → Audio → Publish

## Known gaps (honest list)
- Voice contract duplicated in .md and .ts (drift risk)
- Resend domain verified — emails send from hello@zeemish.io

## Completed (previously gaps)
- ✅ Cloudflare Workflows v2 (PublishLessonWorkflow with durable steps)
- ✅ Fact-Checker web search (two-pass: Claude reasoning + DuckDuckGo verification)
- ✅ Magic link login (Resend email, 30-min token, verify page)
- ✅ Learnings database (StructureEditor writes patterns, Director reviews)

## Cancelled
- Passphrase auth (6 BIP39 words) — cancelled, magic link replaces it

## Fixed (previously gaps)
- ✅ Auth on agents trigger endpoint (ADMIN_SECRET bearer token)
- ✅ Auth on dashboard page (requires email account)
- ✅ Scheduled Director runs (daily 8am UTC cron)
- ✅ Rate limiting on login (5 attempts per 15 min per IP)
- ✅ CSP security header added
- ✅ audit_results D1 table created and populated by Director
- ✅ GitHub Actions deploys both site and agents worker

## Key rules
- TypeScript strict everywhere
- No React/Vue as whole-site framework (Astro islands OK)
- No new dependencies without justification
- Docs updated alongside code, same commit
- Explain decisions as you build (Zishan is learning)
