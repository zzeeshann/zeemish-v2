# Zeemish v2 — Agent Team

## Overview
The agent team is a separate Cloudflare Worker (`agents/`) using the Cloudflare Agents SDK (v0.11.1). Each agent is a Durable Object with its own SQLite database and isolated state. Agents communicate via sub-agent RPC.

**Worker URL:** `https://zeemish-agents.zzeeshann.workers.dev`
**13 agents total — all wired.** Audio Producer + Audio Auditor are live as of 2026-04-18, slotted in after Publisher as a ship-and-retry phase (text commits first; audio follows as a second commit). Hard 20k-char budget cap per piece protects against runaway ElevenLabs spend.

## Design principles (all agents)

1. **One agent = one job = one file.** No agent reaches into another agent's responsibility.
2. **One prompt per agent, co-located.** Prompts live in `{agent}-prompt.ts` next to the agent, not in a shared dumping ground.
3. **Director is a pure orchestrator.** Zero LLM calls. Only routes work between agents.
4. **Each agent owns its state.** Typed `Agent<Env, XState>` with its own `status` enum describing only its own work.
5. **Each agent exposes one primary method.** `scan()`, `curate()`, `draft()`, `audit()`, `check()`, `revise()`, `publish()`, `learn()`.
6. **Typed I/O at every boundary.** No `any`, no JSON blobs between agents.
7. **Every agent reports to Observer.** Standard event shape for the admin dashboard.

## Hard rule for all agents

**Published pieces are permanent. Any agent can READ old pieces to learn from them. No agent WRITES to, revises, regenerates, or updates any published piece. All improvements feed forward into the learnings database and improve future pieces only.**

## Pipeline

```
Scanner → Curator → Drafter → [Voice, Structure, Fact] parallel → Integrator → Publisher
                                                                       ↑             │
                                                          (up to 3 revision rounds)  ↓
                                                    Audio Producer → Audio Auditor → Publisher.publishAudio
                                                    (ship-and-retry: text is live before this; audio is
                                                     a second commit splicing audioBeats into frontmatter)

Observer: receives events from every agent throughout
Learner: runs off-pipeline on reader engagement data
```

## The 13 agents

### 1. ScannerAgent
- **Role:** Fetches news from Google News RSS (6 categories), deduplicates, stores candidates in D1.
- **Sources:** TOP, TECHNOLOGY, SCIENCE, BUSINESS, HEALTH, WORLD feeds
- **Output:** 30–50 daily candidates in `daily_candidates` table
- **No API key** — uses free Google News RSS
- **Method:** `scan()`
- **File:** `agents/src/scanner.ts`

### 2. DirectorAgent
- **Role:** Pure orchestrator. Routes work between agents. Zero LLM calls.
- **State:** `{ status: 'idle' | 'running' | 'error', currentPhase, currentTask, lastDailyPiece, error }`
- **Methods:** `triggerDailyPiece()`, `getStatus()`, `dailyRun()` (scheduled 2am UTC every day)
- **Spawns:** Scanner, Curator, Drafter, auditors, Integrator, Publisher, Observer as sub-agents
- **Writes `pipeline_log`:** step-by-step log visible in admin dashboard
- **File:** `agents/src/director.ts`

### 3. CuratorAgent
- **Role:** Picks the most teachable story from today's candidates and plans its structure (beats, hooks, teaching angle).
- **Selection criteria:** Teachability, universality, freshness, depth potential, no culture war.
- **Input:** `DailyCandidate[]` + recent piece headlines (30-day history)
- **Output:** `DailyPieceBrief` or `{ skip: true, reason }`
- **Method:** `curate(candidates, recentPieces)`
- **File:** `agents/src/curator.ts`
- **Prompt:** `agents/src/curator-prompt.ts`

### 4. DrafterAgent
- **Role:** Writes the MDX for a daily piece from a brief. Enforces `<lesson-shell>` / `<lesson-beat>` format and forces the correct date into frontmatter so it can't drift from the run date.
- **Input:** `DailyPieceBrief`
- **Output:** `{ mdx, wordCount }`
- **Method:** `draft(brief)`
- **Runtime context:** Before building its prompt, Drafter queries `getRecentLearnings(DB, 10)` and includes the results in a "Lessons from prior pieces" block positioned between the Voice Contract and the Brief (contract binds → lessons guide → brief specifies). Fail-open: if the DB read throws, the block is omitted and the draft proceeds. The block is also omitted when the `learnings` table is empty (day 1 of the closed loop) — no placeholder. See DECISIONS 2026-04-19 "Drafter reads learnings at runtime".
- **File:** `agents/src/drafter.ts`
- **Prompt:** `agents/src/drafter-prompt.ts`

### 5. VoiceAuditorAgent
- **Role:** Reviews drafts against the voice contract. Scores 0–100, must be ≥85.
- **Flags:** Tribe words, flattery, jargon without explanation, padding
- **Method:** `audit(mdx)`
- **File:** `agents/src/voice-auditor.ts`
- **Prompt:** `agents/src/voice-auditor-prompt.ts`

### 6. FactCheckerAgent
- **Role:** Verifies factual claims. Two-pass: Claude identifies claims, DuckDuckGo verifies unconfirmed ones.
- **Limitation:** Web search uses DuckDuckGo instant answers (limited depth)
- **Gate semantics:** Passes if no claim is `incorrect`; unverified claims are acceptable. When web search fails, result has `searchAvailable: false` and Director logs a warn via Observer — per the "no silent failure" principle.
- **Method:** `check(mdx)`
- **File:** `agents/src/fact-checker.ts`
- **Prompt:** `agents/src/fact-checker-prompt.ts`

### 7. StructureEditorAgent
- **Role:** Reviews beat structure, pacing, length. Checks hook, teaching, close rules.
- **Checks:** 3–6 beats, one idea per beat, valid frontmatter, no filler
- **Learnings:** Writes to the learnings DB for both passing drafts (suggestions, confidence 60) and failing drafts (issues, confidence 40). The learnings DB feeds Drafter's future prompts, so neutral sampling matters.
- **Method:** `review(mdx)`
- **File:** `agents/src/structure-editor.ts`
- **Prompt:** `agents/src/structure-editor-prompt.ts`

### 8. IntegratorAgent
- **Role:** Takes feedback from all three gates, revises draft, resubmits.
- **Retry:** Up to 3 revision passes before escalation.
- **Instance:** Fresh DO per day (`integrator-daily-${today}`) — daily pipelines are discrete events.
- **Method:** `revise(mdx, voice, structure, facts)`
- **File:** `agents/src/integrator.ts`
- **Prompt:** `agents/src/integrator-prompt.ts`

### 9. AudioProducerAgent
- **Role:** Generates per-beat MP3 audio via ElevenLabs, saves to R2, writes `daily_piece_audio` rows.
- **Voice:** Frederick Surrey (British, calm, narrative) — `j9jfwdrw7BRfcR43Qohk` (added to "My Voices" for stability against shared-library removal).
- **Model / format:** `eleven_multilingual_v2`, output `mp3_44100_96`, `use_speaker_boost: true`, `speed: 0.95`, `style: 0.3`, `stability: 0.6`, `similarity_boost: 0.75`.
- **Process:** Extract beats from MDX → `prepareForTTS` (strip tags + "Zeemish → Zee-mish" alias) → sum chars → reject if > CHAR_CAP → per beat: R2 head-check → POST to ElevenLabs (with `previous_request_ids` rolling-3 window for prosodic stitching) → R2 put → upsert `daily_piece_audio` row.
- **Budget:** 20,000-char hard cap per piece. Over-cap aborts BEFORE any API spend via `AudioBudgetExceededError` (Director catches, escalates to Observer).
- **Retry:** 3 attempts with 1s/2s/4s exponential backoff on 5xx / network errors. 4xx fails fast (bad key, bad voice, quota).
- **Separation:** Never touches git. Never sets `has_audio`. Never knows Publisher exists.
- **Method:** `generateAudio({ date }, mdx)`
- **File:** `agents/src/audio-producer.ts`

### 10. AudioAuditorAgent
- **Role:** Audits the persisted audio state for a date — reads `daily_piece_audio` rows + HEADs R2, returns pass/fail verdict.
- **Checks (majors fail audit):** missing rows, missing R2 object, 0-byte file, size <30% of expected (960 bytes/char at 96 kbps), total chars over 20k cap.
- **Checks (minors):** size >3× expected, beat text <50 chars.
- **No STT:** deliberately out of scope. STT catches hallucinations, which isn't what TTS gets wrong. Real-Cloudflare STT support isn't there yet anyway.
- **Method:** `audit({ date })`
- **File:** `agents/src/audio-auditor.ts`

### 11. PublisherAgent
- **Role:** Commits approved MDX to GitHub repo via Contents API. Two surfaces:
  - `publishToPath(filePath, mdx, commitMsg)` — first commit (text). **Refuses to overwrite existing files** — published content is permanent.
  - `publishAudio(filePath, audioBeats)` — second commit (metadata-only). Splices `audioBeats:` YAML block into frontmatter. Idempotent — re-running with the same beats returns the existing sha as a no-op.
  - `readPublishedMdx(filePath)` — public read helper for `Director.retryAudio`.
- **Metadata carve-out:** `publishAudio` modifies a published file. The "published pieces are permanent" rule governs teaching content (beats, narrative, facts); frontmatter metadata (voiceScore, qualityFlag, audioBeats) is an allowed exception. See `DECISIONS.md` 2026-04-18.
- **Output:** `PublishResult` — commit SHA, commit URL, file path.
- **File:** `agents/src/publisher.ts`

### 12. LearnerAgent
- **Role:** Writes patterns into the `learnings` database so tomorrow's Drafter can see what today's pipeline and readers taught us. Two signal sources wired, two more scaffolded:
  - **Producer-side (P1.3, wired 2026-04-19):** `analysePiecePostPublish(date)` reads the full quality record for a just-published piece — `daily_pieces`, `audit_results`, `pipeline_log`, `daily_candidates` — and writes `source='producer'` learnings. Fired by Director off-pipeline immediately after `publishing done`, via a 1-second `this.schedule(...)` so it never blocks the ship. Caps writes at 10 per run; overflow logs to observer_events. Non-retriable by design: a DB/Claude/JSON failure logs to observer_events and moves on.
  - **Reader-side (P1.5 pending traffic):** `analyse(courseId, days)` produces an engagement report from `engagement`; `analyseAndLearn(lessonData)` extracts learnings and writes `source='reader'`. Only fires when readers generate engagement events (no readers on the daily pieces yet).
  - **Self-reflection (P1.4 pending):** Drafter's own post-draft review, `source='self-reflection'`.
  - **Zita (P1.5 pending traffic):** patterns in reader Zita questions, `source='zita'`.
- **Output:** Producer post-publish result (`{date, written, overflowCount, considered}`) returned to Director for overflow logging; learning rows written to `learnings` with `source` populated.
- **Does NOT touch published content.** Published pieces are permanent. All improvements feed forward.
- **File:** `agents/src/learner.ts`
- **Prompts:** `agents/src/learner-prompt.ts` (`LEARNER_POST_PUBLISH_PROMPT` for producer-side, `LEARNER_ANALYSE_PROMPT` for reader-side)

### 13. ObserverAgent
- **Role:** Logs events (published, escalated, errors, audio failures, learner failures, learning overflow) to D1. Powers dashboard.
- **Methods:** `logPublished()`, `logEscalation()`, `logError()`, `logAudioPublished()`, `logAudioFailure()`, `logLearnerFailure()`, `logLearnerOverflow()`, `getRecentEvents()`, `getDailyDigest()`
- **File:** `agents/src/observer.ts`

## Endpoints

```bash
# Trigger a daily piece (requires auth)
POST /daily-trigger
# Header: Authorization: Bearer <ADMIN_SECRET>

# Retry audio only for an already-published piece (requires auth)
# Invoked by admin dashboard "Retry audio" button after an audio failure.
POST /audio-retry?date=YYYY-MM-DD

# Director status (requires auth)
GET /status

# Observer daily digest (requires auth)
GET /digest

# Recent observer events (requires auth)
GET /events?limit=20

# Engagement report (requires auth)
GET /engagement?course=daily
```

## How to deploy
```bash
cd agents
wrangler deploy
```

## Secrets (set via `wrangler secret put` in `agents/`)
- `ANTHROPIC_API_KEY` — Claude API key for all agents that use Claude
- `GITHUB_TOKEN` — GitHub token for Publisher commits
- `ELEVENLABS_API_KEY` — ElevenLabs API key for Audio Producer
- `ADMIN_SECRET` — Bearer token for trigger endpoint auth

## Key shared files
- `agents/src/types.ts` — Env, per-agent state types, DailyPieceBrief, DailyCandidate, CuratorResult, DrafterResult
- `agents/src/curator-prompt.ts` — Curator's system prompt + prompt builder
- `agents/src/drafter-prompt.ts` — Drafter's system prompt + prompt builder
- `agents/src/voice-auditor-prompt.ts` — VoiceAuditor's system prompt builder (interpolates VOICE_CONTRACT)
- `agents/src/structure-editor-prompt.ts` — StructureEditor's system prompt
- `agents/src/fact-checker-prompt.ts` — FactChecker's two-pass system prompts
- `agents/src/integrator-prompt.ts` — Integrator's system prompt builder (interpolates VOICE_CONTRACT)
- `agents/src/learner-prompt.ts` — Learner's analyse-and-learn system prompt
- `agents/src/shared/voice-contract.ts` — voice contract as string constant
- `agents/src/shared/parse-json.ts` — robust JSON extraction from LLM responses
- `agents/src/shared/prompts.ts` — tombstone; prompts moved to their owning agents

## Known limitations
- Audio Auditor does basic file checks only (no STT round-trip — deliberately out of scope; STT catches hallucinations, not TTS failure modes)
- Site worker needs R2 binding + `/audio/*` route for audio URLs to resolve in production (tracked in ARCHITECTURE deviation + Phase 9 deploy list)
- Voice contract duplicated in `.md` and `.ts` (manual sync required)
- Fact-Checker web search uses DuckDuckGo instant answers (limited depth)
- Scanner XML parsing uses regex (fragile with malformed RSS)
