# Zeemish Pipeline Monitor — Admin Feature Spec

## Why this exists

The overnight bug — 14 orphaned course lessons produced while nobody was watching — proved that an autonomous system needs visibility. The pipeline monitor lets Zishan watch the agents work in real time, see what data flows at each step, and catch problems before they cost money.

## What it looks like

### During a run (live, polling every 5s):

```
PIPELINE MONITOR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Scanner         47 candidates from 6 sources
✅ Director picks  "ECB cuts rates again"
                   Subject: monetary policy
✅ Drafter         1,247 words · 5 beats
✅ Voice Auditor   92/100 — no violations
✅ Fact Checker    Passed — 8 claims, all verified
✅ Structure       Passed — 5 beats, clean flow
⏳ Publisher       Committing to GitHub...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### With audit failure + revision:

```
✅ Scanner         47 candidates
✅ Director picks  "Supply chain disruption"
✅ Drafter         1,102 words · 4 beats
❌ Voice Auditor   78/100 — "used 'unlock' twice"
✅ Fact Checker    Passed
✅ Structure       Passed
⏳ Integrator      Revising (round 1 of 3)...
```

### When idle (last run summary):

```
LAST RUN: 17 April 2026, 2:03 AM UTC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Published: "Why your coffee went cold"
   Voice: 95/100 · 1 revision · 1,340 words
   Commit: github.com/commit/abc123

[Trigger Daily Piece]
```

## How it works

1. **Director writes to `pipeline_log` table** at each step
2. **Admin page polls `/api/dashboard/pipeline`** every 5 seconds
3. **Timeline renders** with status icons and data
4. **Stops polling** when pipeline finishes

## The pipeline_log table

```sql
CREATE TABLE pipeline_log (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,      -- YYYY-MM-DD
  step TEXT NOT NULL,        -- scanning, curating, drafting, auditing_r1, revising_r1, publishing, done, error
  status TEXT NOT NULL,      -- running, done, failed
  data TEXT,                 -- JSON with step-specific data
  created_at INTEGER NOT NULL
);
```

## Steps and their data

| Step | Status | Data |
|------|--------|------|
| scanning | done | `{ candidateCount: 47 }` |
| curating | done | `{ headline: "...", subject: "...", newsSource: "..." }` |
| drafting | done | `{ wordCount: 1247, beatCount: 5 }` |
| auditing_r1 | done/failed | `{ voiceScore: 92, voicePassed: true, factsPassed: true, structurePassed: true }` |
| revising_r1 | done | `{ failedGates: ["voice"], round: 1 }` |
| auditing_r2 | done | `{ voiceScore: 95, ... }` |
| publishing | done | `{ commitUrl: "...", filePath: "..." }` |
| done | done | `{ headline: "...", date: "2026-04-17" }` |
| error | failed | `{ error: "..." }` |
| skipped | done | `{ reason: "No teachable stories" }` |

## Design rules

- Each step is a row. Don't update rows — insert new ones. Append-only log.
- `run_id` is the date. Only one run per day (duplicate guard prevents more).
- The admin page clears old pipeline logs on trigger (fresh view for each run).
- The monitor shows the CURRENT run, not historical runs (those are in observer_events).
