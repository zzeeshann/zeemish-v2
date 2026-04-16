# Zeemish v2 — Agent Team

## Overview
The agent team is a separate Cloudflare Worker (`agents/`) using the Cloudflare Agents SDK. Each agent is a Durable Object with its own SQLite database, isolated state, and the ability to call Claude API.

**Worker URL:** `https://zeemish-agents.zzeeshann.workers.dev`

## Agents (built so far)

### DirectorAgent
- **Role:** Top-level supervisor. Decides what to work on, orchestrates the pipeline.
- **State:** `{ status, currentTask, lastLesson, error }`
- **Methods:**
  - `triggerLesson(courseSlug, lessonNumber)` — manually kick off a lesson
  - `getStatus()` — return current state
- **Spawns:** CuratorAgent, DrafterAgent as sub-agents

### CuratorAgent
- **Role:** Plans individual lessons within a course.
- **Input:** Subject, course title, lesson number, existing lessons, voice contract
- **Output:** `LessonBrief` — title, learning objective, hooks, beat plans
- **Model:** Claude Sonnet 4.5
- **Prompt:** `CURATOR_SYSTEM_PROMPT` in `agents/src/shared/prompts.ts`

### DrafterAgent
- **Role:** Writes complete lesson MDX from a brief.
- **Input:** LessonBrief, voice contract
- **Output:** `DraftResult` — complete MDX content
- **Model:** Claude Sonnet 4.5
- **Prompt:** `DRAFTER_SYSTEM_PROMPT` in `agents/src/shared/prompts.ts`

### VoiceAuditorAgent
- **Role:** Reviews drafts against the voice contract. Scores 0-100, must be ≥85 to pass.
- **Flags:** Tribe words, flattery, jargon without explanation, padding
- **Model:** Claude Sonnet 4.5

### StructureEditorAgent
- **Role:** Reviews beat structure, pacing, length. Checks hook, teaching, close rules.
- **Checks:** 3-6 beats, one idea per beat, valid frontmatter, no filler
- **Model:** Claude Sonnet 4.5

### FactCheckerAgent
- **Role:** Verifies every factual claim. Flags unverified or incorrect claims.
- **Output:** List of claims with status (verified/unverified/incorrect)
- **Model:** Claude Sonnet 4.5

### IntegratorAgent
- **Role:** Takes feedback from all three gates, revises the draft, resubmits.
- **Retry:** Up to 3 revision passes before escalation.
- **Model:** Claude Sonnet 4.5

## Not yet built
- Audio-Producer, Audio-Auditor (ElevenLabs)
- Publisher (Git commit + deploy)
- Engagement-Analyst, Reviser (self-improvement loop)
- Observer (daily digest for Zishan)

## How to trigger a lesson

```bash
# Trigger lesson 3 for the "body" course
curl -X POST "https://zeemish-agents.zzeeshann.workers.dev/trigger?course=body&lesson=3"

# Check Director status
curl "https://zeemish-agents.zzeeshann.workers.dev/status"
```

## How to test locally
```bash
cd agents
pnpm dev
# Then: curl -X POST "http://localhost:8787/trigger?course=body&lesson=2"
```

## Secrets
Set via `wrangler secret put` in the `agents/` directory:
- `ANTHROPIC_API_KEY` — Anthropic Claude API key

## Key files
- `agents/src/server.ts` — entry point, routing
- `agents/src/director.ts` — DirectorAgent
- `agents/src/curator.ts` — CuratorAgent
- `agents/src/drafter.ts` — DrafterAgent
- `agents/src/types.ts` — shared types
- `agents/src/shared/prompts.ts` — system prompts
- `agents/src/shared/voice-contract.ts` — voice contract as string
- `agents/wrangler.toml` — Cloudflare config with DO bindings
