# Zeemish v2 — Claude Code Context

## Current stage
**Stage 1 — Foundation** (repo skeleton, Astro + Tailwind + MDX, deploy to Cloudflare)

## What was last worked on
- Initial repo setup: directory skeleton, Astro config, Tailwind config, TypeScript strict
- Placeholder home page created
- Handoff documents copied to `docs/handoff/`

## Architecture source of truth
`docs/handoff/ZEEMISH-V2-ARCHITECTURE-REVISED.md` — read this before making any technical decisions.

## Stack
- Frontend: Astro + MDX + TypeScript strict + Tailwind
- Backend: Cloudflare Workers + D1 + R2
- Agents: Cloudflare Agents SDK + Workflows v2 (Stage 4+)
- AI: Anthropic Claude
- Audio: ElevenLabs
- Deploy: GitHub Actions → Cloudflare

## Known issues / blockers
- None yet. Fresh repo.

## Key rules
- TypeScript strict everywhere
- No React/Vue as whole-site framework (Astro islands OK)
- No new dependencies without justification
- Docs updated alongside code, same commit
- Explain decisions as you build (Zishan is learning)
