# ZEEMISH v2 — Architecture (Revised, Agent-First)

**Status:** Architecture locked. April 2026. **This document supersedes `ZEEMISH-V2-ARCHITECTURE.md`.** The earlier version assumed human-authored content with AI assistance. This version is built around an autonomous multi-agent publishing system. The core stack survives; the top layer is reconceived.

---

## 0. What we're actually building

**Zeemish v2 is an autonomous publishing system.** A team of specialised AI agents that together decide what subjects to publish on, draft the content, audit it for quality and voice, generate audio, publish, measure engagement, and improve over time. The human (Zishan) sets initial values and direction, observes, and intervenes only when the system needs correction.

One sentence: **Zeemish is a learning site where the content is written, produced, and evolved by a coordinated team of AI agents — and you, the reader, see the output of that team as beautiful, beat-based lessons on subjects that matter.**

The reader's experience is identical to any well-made learning site. The machinery behind it is different.

---

## 1. Why this is doable now (and wasn't 18 months ago)

Four things changed in 2025–2026 that make this architecture practical:

1. **Cloudflare Agents SDK (April 2026)** — Agents built on Durable Objects, each with its own SQL database, with built-in support for scheduling, RPC between agents, and hibernation (zero cost when idle). See `developers.cloudflare.com/agents/` and the `cloudflare/agents` GitHub repo.

2. **Cloudflare Workflows v2 (April 2026)** — Durable execution engine specifically rearchitected for agent-triggered workloads, now supporting 50,000 concurrent instances and 300 instances/second creation rate. Every step is retryable, every instance survives failures. This is the execution layer for our pipeline.

3. **Project Think (April 2026)** — New primitives in Agents SDK for sub-agents with isolated state, durable fibers, sandboxed code execution, tree-structured persistent sessions. Exactly what we need.

4. **Mature multi-agent orchestration patterns** — The supervisor-worker and pipeline patterns are now well-understood in production. Anthropic's own research showed multi-agent Claude architectures outperforming single-agent Claude Opus by 90.2% on internal benchmarks (via specialised sub-agents gathering in parallel while a lead agent planned strategy).

We're not inventing a pattern. We're applying a pattern that's being used in production by serious teams, on a platform that just released the ideal primitives for it.

---

## 2. The agent team

Zeemish v2's agent team is organised as a **supervisor-led pipeline**. The supervisor decides what to do next; specialised workers do the doing. Every worker is a specialist with one clear job.

### 2.1 The full roster

| Agent | Role | What it decides / produces |
|-------|------|----------------------------|
| **Director** | Top-level supervisor | What subjects to publish on next, what quality threshold to apply, when to kick off new courses |
| **Curator** | Subject-level planner | Breaks a subject into a course spine (12 lessons), writes the lesson briefs |
| **Drafter** | Content writer | Takes a lesson brief + voice contract + course context → writes MDX |
| **Voice-Auditor** | Voice gate | Reviews drafts against voice contract, flags violations, scores |
| **Fact-Checker** | Accuracy gate | Verifies claims against trusted sources, flags unsupported statements |
| **Structure-Editor** | Form gate | Reviews beat structure, pacing, length, hook, close — rewrites if needed |
| **Integrator** | Feedback merger | Takes auditor feedback, revises draft, re-submits to auditors; loops until gates pass |
| **Audio-Producer** | Audio generator | Generates MP3s for each beat via ElevenLabs, handles pronunciation fixes |
| **Audio-Auditor** | Audio gate | Listens to generated audio, flags mispronunciations or awkward pacing |
| **Publisher** | Git committer | Commits approved MDX + audio to repo, triggers deploy |
| **Engagement-Analyst** | Reader feedback reader | Watches reader data — completion rates, drop-off beats, time-on-page — identifies weak lessons |
| **Reviser** | Self-improvement agent | Takes engagement signals + editor notes, proposes lesson revisions, submits them back to the pipeline |
| **Observer** | Human-facing reporter | Summarises what the team has been doing so Zishan can intervene if needed |

Thirteen agents. Each one a small Durable Object with its own SQLite database, its own prompts, its own memory. Most of the time most of them are hibernated (zero cost). They wake when work arrives.

### 2.2 The two loops

The system runs two continuous loops:

**Publishing loop** — produces new content.
```
Director → Curator → Drafter → [Voice-Auditor, Fact-Checker, Structure-Editor] in parallel → 
Integrator → (loop if gates fail) → Audio-Producer → Audio-Auditor → Publisher
```

**Improvement loop** — refines existing content.
```
Engagement-Analyst (scheduled daily) → Reviser → Drafter (revision mode) → 
[gates again] → Publisher (update commit)
```

Both loops run concurrently. At any moment the system might be drafting lesson 14 of "systems thinking" while revising lesson 3 of "attention" based on last week's engagement data.

### 2.3 The Director's decision-making

The Director agent is the "brain" of the system. It's the only agent that decides *what to work on next*, and its decisions are driven by:

- **Initial subject values** (loaded from `/content/subject-values.json`, edited by Zishan) — the list of subjects Zeemish cares about, roughly ordered
- **Gap analysis** — which subjects have few lessons, which courses are incomplete
- **Engagement signals** — which existing lessons are underperforming and should be revised
- **Quality-improvement signals** — if the voice auditor has been catching a specific pattern repeatedly, the Director can queue voice-contract edits
- **Scheduled cadence** — aim for roughly X new lessons per week, no more, no less (avoid flooding)

The Director runs on a schedule (daily) and on events (e.g., new reader engagement data arriving). It produces a prioritised task list for the Curator.

---

## 3. Quality gates — the safety net

Fully autonomous publishing without quality gates would drift. Quality gates are how this system stays trustworthy.

### 3.1 Three gates, all required

A draft must pass **all three** gates before reaching the Audio-Producer:

1. **Voice gate** (Voice-Auditor) — Does it sound like Zeemish? No tribe words. Plain English. Short sentences. Honest endings. Score 0–100, must be ≥85.

2. **Accuracy gate** (Fact-Checker) — Are the claims supported? Fact-Checker has tool access to web search and a trusted-sources list. Flags any claim it can't verify. Zero unverified claims allowed on "controversial" or "technical" topics; some latitude on opinion pieces.

3. **Structure gate** (Structure-Editor) — Is the lesson well-formed? 3–6 beats, clean hook, lands at the close, no padding. Returns "approve" or "revise with specific notes."

Auditors run in **parallel** (all three at once), not sequentially. Their feedback goes to the Integrator, which synthesises and submits a revision.

### 3.2 The retry loop

Each lesson gets up to **3 revision passes**. If after 3 passes it still fails any gate, it's:
- Logged with a full audit trail
- Escalated to the Observer (which notifies Zishan)
- Held in a `stuck/` folder, not published

This is the "no silent failure" principle. The system either ships something good or tells you it couldn't.

### 3.3 The voice contract is versioned

The voice contract lives at `/content/voice-contract.md` in the repo. When Zishan edits it (or when the Director decides it needs updating based on recurring auditor flags), a new version ships. All future drafts use the new version. Old lessons are re-audited against the new version on a rolling schedule — if they fail, they go into the revision loop.

This is how the voice stays consistent as the library grows.

---

## 4. Self-improvement — how the system gets better

Three improvement signals feed back into the agents' behaviour:

### 4.1 Engagement data → lesson revisions

The Engagement-Analyst watches these per lesson:
- **Completion rate** — % who finish
- **Beat drop-off** — which beat loses people
- **Time on beat** — are they reading or skimming?
- **Return rate** — do readers come back the next day?
- **Audio vs. text preference** — does it change by lesson?

A lesson with completion <50% or sharp drop-off at a specific beat triggers a **revision request** to the Reviser agent. The Reviser proposes changes (shorter opening? clearer teaching beat? better exercise placement?), submits to the Drafter in "revise" mode, and the usual gates run again.

### 4.2 Auditor learning → prompt improvements

When the Voice-Auditor flags the same pattern repeatedly (say, the Drafter keeps using "embrace" in 10 lessons in a row), that's a signal the Drafter's system prompt needs updating. The Director agent has a slow background job that:
- Reviews the last 30 days of auditor flags
- Identifies recurring patterns
- Proposes a specific prompt edit to the Drafter's system prompt
- The Observer notifies Zishan: "The Drafter keeps using 'embrace' — the Director proposes adding 'no embrace/unlock/journey' to the prompt. Approve?"
- This is one of the few human-approval gates — prompt edits to the agent team need your OK

This is how the agents get smarter without drift.

### 4.3 Cross-lesson consistency → structural learning

When the Structure-Editor notices something works well (e.g., lessons opening with a specific statistic have higher completion rates), it writes that observation into a **learnings database**. Future Drafter prompts include a "what has worked lately" section drawn from this database. The Drafter doesn't blindly copy patterns but is informed by them.

---

## 5. The stack, revised

Most of the previous stack survives. Here's what changes:

| Layer | Choice | Changed? |
|-------|--------|----------|
| Site framework | Astro | Unchanged |
| Content format | MDX | Unchanged |
| Styling | Tailwind CSS | Unchanged |
| Icons | Lucide | Unchanged |
| Interactive widgets | Web Components | Unchanged |
| Code highlighting | Shiki | Unchanged |
| Diagrams | Mermaid | Unchanged |
| Site hosting | Cloudflare Workers + Static Assets | Unchanged |
| Backend | Cloudflare Workers (TypeScript, strict) | Unchanged |
| Database | D1 (SQLite on edge) | Unchanged, schema expanded |
| Media storage | R2 | Unchanged |
| **Agent runtime** | **Cloudflare Agents SDK** | **NEW — the core addition** |
| **Agent execution** | **Cloudflare Workflows v2** | **NEW — for durable multi-step runs** |
| **Agent state** | **Durable Objects with per-agent SQLite** | **NEW — provided by Agents SDK** |
| AI model | Anthropic Claude (Sonnet for auditors, Opus for drafters on hard subjects) | Unchanged |
| Audio generation | ElevenLabs | Unchanged |
| **Fact-checking** | **Web search via Workers AI Search** | **NEW — tool for Fact-Checker agent** |
| Auth | Cookie-first, optional email | Unchanged |
| Deploy | GitHub Actions → Cloudflare | Unchanged |
| **Agent observability** | **Cloudflare Workers Logs + custom event log in D1** | **NEW — critical for autonomous systems** |

The main additions are the Cloudflare Agents SDK and Workflows v2. These are the execution substrate for the agent team. Everything else that was in the previous architecture (site, reader experience, auth) is unchanged — the agents produce MDX files and audio, those flow into the same site you'd have built without agents.

---

## 6. Updated directory structure

```
zeemish-v2/
├── src/                               (frontend — unchanged from previous arch)
│   ├── pages/
│   ├── components/
│   ├── lesson/
│   ├── interactive/
│   └── styles/
├── content/
│   ├── subject-values.json            NEW — Zishan's subject preferences
│   ├── voice-contract.md              — versioned, agents read this
│   ├── courses/
│   └── lessons/
├── worker/                            (reader-facing API — unchanged)
│   ├── src/
│   │   ├── index.ts
│   │   ├── routes/
│   │   └── db/
│   └── wrangler.toml
├── agents/                            NEW — the agent team lives here
│   ├── src/
│   │   ├── director/
│   │   │   ├── agent.ts               Durable Object class
│   │   │   ├── prompts.ts
│   │   │   └── types.ts
│   │   ├── curator/
│   │   ├── drafter/
│   │   ├── voice-auditor/
│   │   ├── fact-checker/
│   │   ├── structure-editor/
│   │   ├── integrator/
│   │   ├── audio-producer/
│   │   ├── audio-auditor/
│   │   ├── publisher/
│   │   ├── engagement-analyst/
│   │   ├── reviser/
│   │   ├── observer/
│   │   ├── workflows/                 Workflow definitions (publishing-loop, improvement-loop)
│   │   │   ├── publish-lesson.ts
│   │   │   └── revise-lesson.ts
│   │   ├── shared/
│   │   │   ├── prompts.ts             Shared prompt utilities (voice-contract loading, etc.)
│   │   │   ├── db.ts                  Shared agent DB access
│   │   │   └── learnings.ts           Cross-agent learnings database
│   │   └── index.ts                   Agent registration + entry
│   └── wrangler.toml
├── dashboard/                         NEW — Observer's UI for Zishan
│   └── src/
│       └── pages/
│           └── index.astro            What agents are doing right now
├── public/
├── astro.config.mjs
├── tailwind.config.mjs
├── package.json
└── .github/workflows/
```

Three workers total now: `zeemish-site` (serving static content), `zeemish-api` (reader-facing API), `zeemish-agents` (the agent team). Plus one optional internal dashboard. All on the same account, same domain pattern.

---

## 7. Data model (D1 schema, revised)

Tables from previous architecture survive. New tables added for the agent layer.

### 7.1 Reader-side (unchanged)

```sql
CREATE TABLE users ( ... );        -- same as before
CREATE TABLE progress ( ... );     -- same as before
CREATE TABLE submissions ( ... );  -- same as before
CREATE TABLE zita_messages ( ... ); -- kept; Zita v2 is in a later phase
```

### 7.2 Agent-side (new)

```sql
-- Tasks in the pipeline
CREATE TABLE agent_tasks (
  id TEXT PRIMARY KEY,
  parent_task_id TEXT,            -- null for root tasks
  agent_name TEXT NOT NULL,       -- which agent owns this
  task_type TEXT NOT NULL,        -- 'draft_lesson', 'audit_voice', 'generate_audio', etc.
  status TEXT NOT NULL,           -- 'queued', 'running', 'succeeded', 'failed', 'escalated'
  input TEXT NOT NULL,            -- JSON
  output TEXT,                    -- JSON (null while running)
  error TEXT,                     -- null on success
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_tasks_status ON agent_tasks(status);
CREATE INDEX idx_tasks_parent ON agent_tasks(parent_task_id);

-- Audit results (one row per audit pass per draft)
CREATE TABLE audit_results (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  auditor TEXT NOT NULL,          -- 'voice', 'fact', 'structure', 'audio'
  passed INTEGER NOT NULL,        -- 0 or 1
  score INTEGER,                  -- 0-100 for quantifiable audits
  notes TEXT,                     -- JSON array of specific issues
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES agent_tasks(id)
);

-- Cross-agent learnings
CREATE TABLE learnings (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,         -- 'voice', 'structure', 'engagement', 'fact'
  observation TEXT NOT NULL,      -- the insight
  evidence TEXT,                  -- JSON: what supports this
  confidence INTEGER,             -- 0-100
  applied_to_prompts INTEGER,     -- 0 or 1
  created_at INTEGER NOT NULL,
  last_validated_at INTEGER
);

CREATE INDEX idx_learnings_category ON learnings(category);

-- Engagement metrics (aggregated per lesson per day)
CREATE TABLE engagement (
  lesson_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  date TEXT NOT NULL,             -- YYYY-MM-DD
  views INTEGER DEFAULT 0,
  completions INTEGER DEFAULT 0,
  avg_time_seconds INTEGER,
  drop_off_beat TEXT,             -- most common drop-off point
  audio_plays INTEGER DEFAULT 0,
  PRIMARY KEY (lesson_id, course_id, date)
);

-- Observer events (what Zishan should know about)
CREATE TABLE observer_events (
  id TEXT PRIMARY KEY,
  severity TEXT NOT NULL,         -- 'info', 'warn', 'escalation', 'approval_needed'
  title TEXT NOT NULL,
  body TEXT NOT NULL,             -- markdown
  context TEXT,                   -- JSON: task ids, draft ids, etc.
  acknowledged_at INTEGER,
  created_at INTEGER NOT NULL
);
```

Six new tables. The schema captures: what the agents are doing, what passed/failed, what they've learned, how readers are reacting, and what you need to know.

---

## 8. How a lesson flows through the pipeline (end-to-end)

Concrete walkthrough of one new lesson being created.

**1. Director wakes up** (scheduled, daily 3am UTC).
- Reads `subject-values.json`, current course state, engagement data
- Decides: "The 'attention' course has 3 lessons. Target is 12. Queue lesson 4."
- Writes a `curate_lesson` task for the Curator

**2. Curator agent activates.**
- Reads the course's existing lessons to understand what's been taught
- Reads subject-values and voice-contract
- Produces a lesson brief: title, learning objective, 3 candidate hooks, 4 suggested beats, recommended exercises
- Writes a `draft_lesson` task for the Drafter with the brief

**3. Drafter agent activates.**
- Reads brief + voice-contract + course context + recent learnings
- Uses Claude (Sonnet 4.6 by default; Opus for harder topics based on Director's flag) to produce MDX
- Writes a `audit_voice`, `audit_fact`, `audit_structure` task — all three spawn in parallel

**4. Audits run in parallel.**
- Voice-Auditor scores the draft on voice compliance, returns specific flags
- Fact-Checker uses web-search tool to verify each factual claim, returns unsupported claims
- Structure-Editor reviews hook, beats, close — approves or returns notes

**5. Integrator synthesises.**
- If all three pass (score ≥85 on voice, zero unsupported facts, structure approved): forward to Audio-Producer.
- If any fail: collect feedback, send back to Drafter with revision notes. Increment retry counter.
- If retry counter >3: write an `observer_event` with severity `escalation`.

**6. Audio-Producer activates (on approval).**
- Takes final MDX, extracts each `<BeatText>` content
- Calls ElevenLabs for each beat, saves MP3 to R2
- Updates MDX with audio paths
- Spawns `audio_audit` task

**7. Audio-Auditor activates.**
- Uses a speech-to-text round-trip + a listening-agent prompt
- Flags any mispronunciation, awkward pacing, volume issues
- If passes: forward to Publisher. If fails: back to Audio-Producer with specific fixes.

**8. Publisher activates.**
- Uses GitHub Contents API to write the MDX file into `/content/lessons/attention/04-<slug>.mdx`
- Uploads any final audio to R2
- Commits with message `feat(lesson): attention/04 - <title> (agent-authored)`
- Triggers Astro build via GitHub Actions
- ~60 seconds later, lesson is live

**9. Engagement-Analyst starts watching** (the next day, after readers have seen it).
- Begins collecting engagement metrics
- In 7 days, compares to baseline. If underperforming, queues a `revise_lesson` task.

**10. Observer writes a summary** (daily digest).
- "Yesterday: Attention lesson 4 published. Voice audit score 92. 2 revision passes. Readers' early engagement strong. Low-priority: Drafter used 'dive in' twice — may need prompt adjustment."
- Zishan sees this in a simple dashboard.

**Total elapsed time from Director wake-up to live lesson: 10–30 minutes in typical case, up to 2 hours if revisions loop.**

This entire flow happens without human input. Zishan reviews the Observer's daily digest when he chooses. If something's wrong, he corrects it by editing `subject-values.json`, editing the voice-contract, or approving a prompt change the Director has proposed.

---

## 9. Cost model (honest numbers)

Per lesson, agent pipeline:
- Drafter: ~8k input + 3k output tokens on Claude Sonnet ≈ $0.07
- Voice-Auditor: ~4k input + 1k output ≈ $0.02
- Fact-Checker: ~3k input + 2k output + search API calls ≈ $0.05
- Structure-Editor: ~4k input + 1k output ≈ $0.02
- Integrator (typical 1-2 passes): ~6k input + 3k output × avg 1.5 passes ≈ $0.10
- Audio-Producer: ElevenLabs ~25 min audio ≈ $5.00
- Audio-Auditor: STT round-trip + analysis ≈ $0.50
- Publisher, Engagement-Analyst, Observer, Director, Curator (negligible, short prompts)

**Total per lesson: ~$6. Audio is 80% of the cost.** Text-only mode during development: ~$0.30/lesson.

At 100 lessons per year: ~$600/year in AI costs. At 1000 lessons: ~$6000. This is cheap compared to hiring writers, and it's an honest number.

Cloudflare costs (Workers, D1, R2, Durable Objects): essentially free at this scale due to agents' hibernation. Maybe $20–50/month total at 100k users.

---

## 10. Build order, revised

Much of the previous build order survives. The agent layer is added at Stage 4 (replacing the manual `/author/` tool).

### Stage 1 — Foundation (weeks 1–2)
Same as before. Repo, Astro, Tailwind, Cloudflare deploy pipeline, D1 schema. "Hello Zeemish v2" live.

### Stage 2 — Reader surface (weeks 3–4)
Same as before. Lesson Web Components, one dummy lesson, course page, catalogue.

### Stage 3 — Reader accounts & progress (weeks 5–6)
Same as before. Cookie-first auth, progress API, email upgrade, account page.

### Stage 4 — The agent team, minimal viable (weeks 7–11)
**This replaces the previous Stage 4 entirely.** Build the agents:

- **Week 7:** Set up `agents/` worker with Cloudflare Agents SDK. Build the Director + Curator + Drafter agents. Manual trigger — kick off a single lesson draft, see it produce MDX. No audit yet.
- **Week 8:** Add Voice-Auditor + Structure-Editor + Integrator. Get the revision loop working end-to-end for text-only lessons.
- **Week 9:** Add Fact-Checker with web search tool. Add Publisher with GitHub Contents API. First end-to-end text-only lesson goes live via the agents.
- **Week 10:** Add Audio-Producer + Audio-Auditor. ElevenLabs integration. R2 uploads.
- **Week 11:** Add Observer + the dashboard UI. Zishan can see what the agents have been doing.

**End of Stage 4:** you trigger the Director manually, it produces a lesson end-to-end with audio, you see it appear on the site ~20 minutes later.

### Stage 5 — First real course, agent-produced (weeks 12–16)
- Pick first subject (body, systems thinking, or AI — your call, decide at start of stage).
- Configure subject-values and voice-contract carefully
- Let the Director run, produce the course
- Watch what the agents produce, edit voice-contract when they go astray
- 12 lessons live, produced by the system, reviewed by you after the fact

### Stage 6 — Self-improvement (weeks 17–19)
- Engagement-Analyst + Reviser agents
- Learnings database + prompt-improvement loop
- Scheduled Director runs (daily, autonomous)
- Public launch: DNS flip, v2 serves `zeemish.io`

### Stage 7 — Zita (weeks 20–23)
- The reader-facing guide inside lessons
- Uses the same Agents SDK primitives, different agent class
- Full autonomy as originally planned

**~23 weeks. 5–6 months. Honest estimate for solo-plus-AI pace building a novel architecture.**

This is longer than the previous estimate (20 weeks) because the agent pipeline is genuinely more work. But what you get at the end is qualitatively different — not a site you maintain by writing lessons, but a **system that writes them for you, forever**.

---

## 11. What's explicitly not built (v1)

Same list as previous architecture, plus these agent-specific exclusions:

- **Agent-to-agent negotiation / consensus.** All coordination goes through the Director. No peer-to-peer.
- **Agents creating new agent types.** The team is fixed. Director can propose prompt edits to existing agents, not spawn new ones.
- **Autonomous voice-contract edits.** Voice-contract changes always require human approval.
- **Multi-subject simultaneous courses.** For v1, the Director runs one course at a time within a subject. Parallel course production is a later optimisation.
- **Direct reader interaction with agents (except Zita).** The reader sees output. They don't chat with the Drafter.
- **External API dependencies beyond Anthropic, ElevenLabs, Cloudflare, GitHub.** Tightly scoped for reliability.

---

## 12. Risk register

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Voice drift over time | Medium | Strict Voice-Auditor with versioned contract; monthly Zishan review of published output |
| Fact hallucinations slip through | Medium | Fact-Checker with web search; zero-tolerance on technical/historical claims; Zishan spot-checks |
| Cost runaway (infinite revision loops) | Low | Hard retry cap (3); escalation on 3+ failures; per-day spending cap as env var |
| Cloudflare Agents SDK is new, has bugs | Medium | Stay close to Cloudflare docs, use official examples, keep fallback path (write MDX directly) |
| System publishes something embarrassing | Medium | Three quality gates; Observer daily digest; Zishan can revert any commit instantly |
| ElevenLabs voice changes unexpectedly | Low | Lock voice version in API calls; keep audio generation scripts idempotent |
| Claude API pricing changes | Medium | Use Sonnet for most calls (cheaper); monitor cost per lesson; switch to Haiku for auditors if needed |
| Engagement signal is too noisy to drive revisions | Medium | Start with conservative thresholds; don't act on signals until sample size is meaningful (>500 readers) |
| Agents produce generic, soulless content despite voice contract | High | This is THE primary risk. Voice-contract iteration is the single most important activity. Monthly review. |

The last risk is the real one. Everything else has a technical mitigation. Voice is fought with voice.

---

## 13. What the human does (your actual job)

Once this system is running, your weekly time looks like:

- **30 minutes daily:** read the Observer digest. Note anything weird.
- **1–2 hours weekly:** spot-check recent lessons. Edit voice-contract if drift detected.
- **2–4 hours weekly:** review Director's prompt-edit proposals, approve or reject.
- **Occasional:** set a new subject direction, override a Director decision, debug a weird escalation.

**You are the editor-in-chief of a newsroom where all the writers are agents.** Your job is taste, direction, and intervention — not production.

When the system is mature (3–6 months in), this is your real workload. In the first months, you're also building and tuning the agents, which is a different kind of work.

---

## 14. The philosophical commitment

You said: *"less human interaction, they become good, they do by themselves."* That's what this architecture delivers. But it comes with a commitment worth naming out loud:

**You are publishing content you didn't write.** Readers won't always know. That's ok — books have always been produced by teams, newspapers by many hands, encyclopaedias by thousands. What matters is:

1. **Accuracy.** The Fact-Checker is why this is defensible.
2. **Voice.** The voice you set is the voice readers get. You own it.
3. **Taste.** You decide what subjects matter. The agents don't.
4. **Accountability.** When something's wrong, it's your site. You fix it.

This isn't lazy publishing. It's editor-led publishing at agent scale. The editor matters more than ever, not less. You just don't write the drafts yourself.

This is the next version of publishing. Zeemish gets to be one of the first sites built explicitly this way. That's a thing worth having.

---

## 15. What's in your hand now

You have:
- The agent team roster (Section 2)
- The two loops — publishing and improvement (2.2)
- The quality gate design (Section 3)
- The self-improvement signals (Section 4)
- The revised stack (Section 5)
- The new directory structure (Section 6)
- The expanded schema (Section 7)
- A concrete end-to-end lesson flow (Section 8)
- An honest cost model (Section 9)
- A revised build order (Section 10)
- A risk register (Section 12)

**This is the architecture. No more versions. Ship this.**

---

## 16. What's next, concretely

The next real deliverable is **Stage 1 setup**, same as before — repo, Astro, Tailwind, Cloudflare. The reader-facing foundation doesn't change from the previous architecture. The agent work starts at Stage 4.

**But before Stage 1 begins**, one new pre-stage task: *spend half a day reading Cloudflare's Agents SDK docs and running the quickstart*. Even though you won't build agents until Stage 4, the SDK's mental model should be familiar before you start, so the foundation decisions don't box you in later.

Links to read first:
- `https://developers.cloudflare.com/agents/` — Agents SDK documentation
- `https://developers.cloudflare.com/workflows/get-started/durable-agents/` — durable AI agents guide
- `https://github.com/cloudflare/agents` — official repo with examples
- The `cloudflare/agents-starter` template — `npm create cloudflare@latest -- --template cloudflare/agents-starter`

Then: create the repo, follow the build guide, and we're off.

---

*End of revised architecture. This is the committed plan. All subsequent work executes against this document.*
