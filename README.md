# Zeemish

> **"Educate myself for humble decisions."**

Daily teaching, made by 13 AI agents, anchored in today's news. Read at **[zeemish.io](https://zeemish.io)**.

---

Every day at 2am UTC, 13 specialised AI agents scan the news, pick the most teachable story, draft a piece, audit it through quality gates, narrate it beat-by-beat via ElevenLabs, and publish it to the live site. No human in the loop.

You see the result the next morning — a daily teaching piece anchored in today's news, in plain English, with audio narration. A growing library of past pieces. No login needed to read.

The whole pipeline runs in public. Watch it on the [factory-floor dashboard](https://zeemish.io/dashboard/). Every published piece has a "How this was made" drawer at the bottom showing which agents touched it and what each round of audit said. Transparency is the brand.

## The 13 agents

Scanner → Curator → Drafter → [Voice / Fact / Structure auditors] → Integrator → Publisher → Audio Producer → Audio Auditor → Publisher (audio second-commit). Director orchestrates; zero LLM calls itself. Observer logs every event for the dashboard. Learner watches readers off-pipeline and writes patterns for future pieces.

Each agent does one job and lives in one file. See [agents/src/](agents/src/) and [docs/AGENTS.md](docs/AGENTS.md).

## Tech

Astro + MDX + Tailwind + TypeScript strict, on Cloudflare Workers. Two workers: the site (this repo's `src/`) and the agents (this repo's `agents/`). D1 for data, R2 for audio, the Cloudflare Agents SDK for the agent runtime, Claude Sonnet 4.5 for reasoning, ElevenLabs (Frederick Surrey voice) for narration, Resend for magic-link auth. GitHub Actions auto-deploys both workers on every push to `main`.

## How this was built

Largely built with Claude (Anthropic's assistant) as a development partner over a few weeks. The trade-offs and the *why* behind each non-obvious decision are captured in [docs/DECISIONS.md](docs/DECISIONS.md) — append-only, dated entries. The current-state document is [CLAUDE.md](CLAUDE.md) — read that first if you want to understand the system end-to-end.

Honest software: the README tells you how it was built, the dashboard shows you how it runs, the decision log explains why each piece is the way it is. No seams hidden.

## Repo map

```
agents/src/             13 agent files (one per agent)
content/daily-pieces/   Published daily pieces (YYYY-MM-DD-slug.mdx)
src/pages/              Site routes (Astro)
src/interactive/        Web Components (lesson-shell, audio-player, zita-chat)
migrations/             D1 schema (10 migrations)
scripts/                Build, deploy, and ops scripts
docs/                   Living documentation
docs/handoff/           Original architecture briefs (frozen)
```

## Documentation

- [CLAUDE.md](CLAUDE.md) — project context, current state, and "Critical lesson" sections worth reading before touching cache or headers
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — what's built, deviations from the original plan
- [docs/AGENTS.md](docs/AGENTS.md) — the 13 agents in detail, endpoints, secrets
- [docs/SCHEMA.md](docs/SCHEMA.md) — D1 tables and migrations
- [docs/RUNBOOK.md](docs/RUNBOOK.md) — how to run, deploy, trigger, revert
- [docs/DECISIONS.md](docs/DECISIONS.md) — append-only decisions, with the *why*

## Status

Launched 2026-04-18 at https://zeemish.io. Locked at tag `v1.0.0`.

The original Zeemish (a separate breathing-tools site, 2024) lived at the same domain until launch day. That codebase is preserved at [github.com/zzeeshann/zeemish](https://github.com/zzeeshann/zeemish) (archived).
