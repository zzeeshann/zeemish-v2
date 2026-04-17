# Zeemish v2 — Agent Team

## Overview
The agent team is a separate Cloudflare Worker (`agents/`) using the Cloudflare Agents SDK (v0.11.1). Each agent is a Durable Object with its own SQLite database and isolated state. Agents communicate via sub-agent RPC.

**Worker URL:** `https://zeemish-agents.zzeeshann.workers.dev`
**13 agents deployed** (13 from the original architecture + ScannerAgent for Daily Pieces).

## Hard rule for all agents

**Published pieces are permanent. Any agent can READ old pieces to learn from them. No agent WRITES to, revises, regenerates, or updates any published piece. All improvements feed forward into the learnings database and improve future pieces only.**

## Agents (13 total — 12 public + Observer internal)

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
- **Role:** Verifies factual claims. Two-pass: Claude identifies claims, DuckDuckGo verifies unconfirmed ones.
- **Limitation:** Web search uses DuckDuckGo instant answers (limited depth).
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

### LearnerAgent
- **Role:** Watches reader engagement data (completions, drop-offs, audio vs text, return rate) AND writes patterns into the learnings database for future pieces. Merged from the former EngagementAnalyst + Reviser.
- **Methods:** `analyse(courseId, days)` — engagement report; `analyseAndLearn(lessonData)` — extract learnings
- **Output:** Engagement reports + learnings written to D1 `learnings` table
- **Does NOT touch published content.** Published pieces are permanent.
- **File:** `agents/src/learner.ts`

### AudioProducerAgent
- **Role:** Generates MP3 audio for each beat via ElevenLabs TTS, saves to R2.
- **Voice:** Frederick Surrey (British, calm, narrative) — `j9jfwdrw7BRfcR43Qohk`
- **Process:** Extract text from each `<lesson-beat>` → strip tags → call ElevenLabs → save MP3 to R2
- **Audio generated once per lesson, served forever** (zero cost per play)
- **File:** `agents/src/audio-producer.ts`

### AudioAuditorAgent
- **Role:** Checks generated audio quality — verifies files exist in R2, checks sizes, flags issues.
- **Checks:** File exists, not empty, not suspiciously large, text wasn't too short
- **Note:** Does not do STT round-trip yet (can be added when Workers AI supports it)
- **File:** `agents/src/audio-auditor.ts`

### ScannerAgent
- **Role:** Fetches news from Google News RSS (6 categories), deduplicates, stores candidates in D1.
- **Sources:** TOP, TECHNOLOGY, SCIENCE, BUSINESS, HEALTH, WORLD feeds
- **Output:** 30-50 daily candidates in `daily_candidates` table
- **No API key needed** — uses free Google News RSS
- **File:** `agents/src/scanner.ts`

## Endpoints

```bash
# Trigger a lesson pipeline (requires auth)
POST /trigger?course=attention&lesson=1
# Header: Authorization: Bearer <ADMIN_SECRET>

# Director status
GET /status

# Observer daily digest (last 24 hours)
GET /digest

# Recent observer events
GET /events?limit=20

# Trigger a daily piece (requires auth)
POST /daily-trigger
# Header: Authorization: Bearer <ADMIN_SECRET>

# Engagement report for a course
GET /engagement?course=attention
```

## How to deploy
```bash
cd agents
wrangler deploy
```

## Secrets (set via `wrangler secret put` in `agents/`)
- `ANTHROPIC_API_KEY` — Claude API key for all agents
- `GITHUB_TOKEN` — GitHub token for Publisher commits
- `ELEVENLABS_API_KEY` — ElevenLabs API key for Audio-Producer
- `ADMIN_SECRET` — Bearer token for trigger endpoint auth

## Key shared files
- `agents/src/types.ts` — Env, state types, LessonBrief, DraftResult
- `agents/src/shared/prompts.ts` — system prompts for Curator + Drafter
- `agents/src/shared/voice-contract.ts` — voice contract as string constant
- `agents/src/shared/parse-json.ts` — robust JSON extraction from LLM responses

## Workflow
- **PublishLessonWorkflow** — durable multi-step pipeline (curate → draft → audit → revise → audio → publish)
- Each step is a checkpoint — survives Worker restarts
- File: `agents/src/workflows/publish-lesson.ts`

## Known limitations
- Audio-Auditor does basic file checks only (no STT round-trip yet)
- Voice contract duplicated in .md and .ts (manual sync required)
- Fact-Checker web search uses DuckDuckGo instant answers (limited depth)
- Scanner XML parsing uses regex (fragile with malformed RSS)
- Weekend daily pieces not yet implemented (weekdays only)
