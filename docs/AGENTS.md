# Zeemish v2 — Agent Team

## Overview
The agent team is a separate Cloudflare Worker (`agents/`) using the Cloudflare Agents SDK (v0.11.1). Each agent is a Durable Object with its own SQLite database and isolated state. Agents communicate via sub-agent RPC.

**Worker URL:** `https://zeemish-agents.zzeeshann.workers.dev`

## Built agents (11 of 13)

### DirectorAgent
- **Role:** Top-level supervisor. Orchestrates the full publishing pipeline.
- **State:** `{ status, currentTask, lastLesson, error }`
- **Methods:** `triggerLesson(courseSlug, lessonNumber)`, `getStatus()`
- **Spawns:** All other agents as sub-agents
- **File:** `agents/src/director.ts`

### CuratorAgent
- **Role:** Plans individual lessons within a course.
- **Input:** Subject, course title, lesson number, existing lessons, voice contract
- **Output:** `LessonBrief` — title, objective, hooks, beat plans
- **Model:** Claude Sonnet 4.5
- **File:** `agents/src/curator.ts`

### DrafterAgent
- **Role:** Writes complete lesson MDX from a brief.
- **Input:** LessonBrief + voice contract
- **Output:** `DraftResult` — complete MDX, token count
- **Model:** Claude Sonnet 4.5
- **File:** `agents/src/drafter.ts`

### VoiceAuditorAgent
- **Role:** Reviews drafts against the voice contract. Scores 0-100, must be ≥85.
- **Flags:** Tribe words, flattery, jargon without explanation, padding
- **File:** `agents/src/voice-auditor.ts`

### StructureEditorAgent
- **Role:** Reviews beat structure, pacing, length. Checks hook, teaching, close rules.
- **Checks:** 3-6 beats, one idea per beat, valid frontmatter, no filler
- **File:** `agents/src/structure-editor.ts`

### FactCheckerAgent
- **Role:** Verifies factual claims. Flags unverified or incorrect claims.
- **Limitation:** Uses Claude reasoning only — no web search tool yet.
- **File:** `agents/src/fact-checker.ts`

### IntegratorAgent
- **Role:** Takes feedback from all three gates, revises draft, resubmits.
- **Retry:** Up to 3 revision passes before escalation.
- **File:** `agents/src/integrator.ts`

### PublisherAgent
- **Role:** Commits approved MDX to GitHub repo via Contents API.
- **Only runs when:** All three quality gates pass.
- **Output:** Commit SHA, commit URL, file path
- **File:** `agents/src/publisher.ts`

### ObserverAgent
- **Role:** Logs events (published, escalated, errors) to D1. Powers dashboard.
- **Methods:** `logPublished()`, `logEscalation()`, `logError()`, `getRecentEvents()`, `getDailyDigest()`
- **File:** `agents/src/observer.ts`

### EngagementAnalystAgent
- **Role:** Reads completion rates, drop-off beats. Identifies underperforming lessons.
- **Threshold:** Lessons with <50% completion and ≥10 views flagged.
- **File:** `agents/src/engagement-analyst.ts`

### ReviserAgent
- **Role:** Takes engagement signals + lesson MDX, proposes revisions via Claude.
- **Output:** Revised MDX ready for re-audit through pipeline.
- **File:** `agents/src/reviser.ts`

## NOT built (2 of 13)

### Audio-Producer
- **Planned role:** Generate MP3 per beat via ElevenLabs, upload to R2.
- **Blocked by:** No ElevenLabs API key, no R2 bucket configured.
- **File:** `agents/src/audio-producer/` (empty directory)

### Audio-Auditor
- **Planned role:** STT round-trip + listening check for mispronunciations.
- **Blocked by:** Audio-Producer must be built first.
- **File:** `agents/src/audio-auditor/` (empty directory)

## Endpoints

```bash
# Trigger a lesson pipeline
POST /trigger?course=body&lesson=3

# Director status
GET /status

# Observer daily digest (last 24 hours)
GET /digest

# Recent observer events
GET /events?limit=20

# Engagement report for a course
GET /engagement?course=body
```

## How to deploy
```bash
cd agents
wrangler deploy
```

## Secrets (set via `wrangler secret put` in `agents/`)
- `ANTHROPIC_API_KEY` — Claude API key
- `GITHUB_TOKEN` — GitHub token for Publisher commits

## Key shared files
- `agents/src/types.ts` — Env, state types, LessonBrief, DraftResult
- `agents/src/shared/prompts.ts` — system prompts for Curator + Drafter
- `agents/src/shared/voice-contract.ts` — voice contract as string constant
- `agents/src/shared/parse-json.ts` — robust JSON extraction from LLM responses

## Known limitations
- No Cloudflare Workflows v2 — pipeline is synchronous RPC, not durable
- No scheduled runs — Director must be triggered manually
- No auth on trigger endpoint — anyone with the URL can trigger
- Fact-Checker has no web search — uses Claude reasoning only
- `audit_results` table not populated — audits only stored in agent state
