# Zeemish v2 — Database Schema (D1)

Database: `zeemish` (Cloudflare D1, SQLite)
Database ID: `f3cdccbf-7cea-4af1-b524-20f6a6fe1dd4`
**13 tables across 10 migrations.**

## Reader-side tables

### users
Every visitor — anonymous and authenticated. Created on first API call.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID, generated on first visit |
| email | TEXT UNIQUE | Null for anonymous users, added on upgrade |
| password_hash | TEXT | PBKDF2 hash, null for anonymous |
| created_at | INTEGER | Unix timestamp ms |
| updated_at | INTEGER | Unix timestamp ms |

Migration: `0001_init.sql`

### progress
Tracks which beat a reader is on and which lessons they've completed.

| Column | Type | Notes |
|--------|------|-------|
| user_id | TEXT FK→users | |
| course_slug | TEXT | e.g. "body" |
| lesson_number | INTEGER | e.g. 1 |
| current_beat | TEXT | e.g. "teaching-1", null if not started or completed |
| completed_at | INTEGER | Unix timestamp ms, null if not finished |
| created_at | INTEGER | |
| updated_at | INTEGER | |

PK: (user_id, course_slug, lesson_number). Migration: `0001_init.sql`

### submissions
Optional practice data (breathing timer results, etc.).

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| user_id | TEXT FK→users | |
| course_slug | TEXT | |
| lesson_number | INTEGER | |
| practice_type | TEXT | e.g. "breathing" |
| data | TEXT | JSON blob |
| created_at | INTEGER | |

Migration: `0001_init.sql`

### zita_messages
Conversation history for the Zita learning guide.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| user_id | TEXT FK→users | |
| course_slug | TEXT | |
| lesson_number | INTEGER | |
| role | TEXT | "user" or "assistant" |
| content | TEXT | Message text |
| created_at | INTEGER | |

Migration: `0001_init.sql`

## Agent-side tables

### observer_events
What Zishan should know about — published lessons, escalations, errors.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| severity | TEXT | info, warn, escalation |
| title | TEXT | Short summary |
| body | TEXT | Markdown detail |
| context | TEXT | JSON with task IDs, scores, etc. |
| acknowledged_at | INTEGER | Null until Zishan acknowledges |
| created_at | INTEGER | |

Migration: `0002_observer_events.sql`

### engagement
Reader engagement metrics, aggregated per lesson per day.

| Column | Type | Notes |
|--------|------|-------|
| lesson_id | TEXT | e.g. "body/3" |
| course_id | TEXT | e.g. "body" |
| date | TEXT | YYYY-MM-DD |
| views | INTEGER | Default 0 |
| completions | INTEGER | Default 0 |
| avg_time_seconds | INTEGER | |
| drop_off_beat | TEXT | Most common drop-off point |
| audio_plays | INTEGER | Default 0 |

PK: (lesson_id, course_id, date). Migration: `0003_engagement_learnings.sql`

### learnings
Cross-agent learnings database — patterns that work or don't. Drafter reads the 10 most recent rows (across all sources / categories) at runtime and includes them in its prompt — the loop the system uses to improve on itself.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| category | TEXT | `voice` \| `structure` \| `engagement` \| `fact`. What kind of learning it is — shapes which prompt it should inform. |
| observation | TEXT | The insight |
| evidence | TEXT | JSON: what supports this |
| confidence | INTEGER | 0-100 |
| applied_to_prompts | INTEGER | 0 or 1 |
| source | TEXT | `reader` \| `producer` \| `self-reflection` \| `zita`. Where the signal came from. Loose TEXT, nullable — no CHECK constraint because a future fifth origin is cheap to add at the write site. NULL means "unspecified (pre-P1.3)". Indexed via `idx_learnings_source`. **Application layer is stricter than the schema:** `writeLearning` refuses to insert a row whose `source` is null, empty, or non-string — logs a warn to `observer_events` and skips. Column nullability remains so historical pre-P1.3 rows stay readable; new rows must always carry a source. |
| piece_date | TEXT | YYYY-MM-DD of the `daily_pieces` row this learning is about. Nullable at schema level so migration 0012 could apply non-destructively to pre-existing rows, which were then filled via a one-time manual UPDATE matching `learnings.created_at` to `daily_pieces.published_at`. **Application layer enforces non-null going forward:** `writeLearning` refuses rows missing `piece_date`, same defensive pattern as `source` (both checks route through the shared `logMissingField` helper). Indexed via `idx_learnings_piece_date`. Primary read path: the per-piece "What the system learned" section of the How-this-was-made drawer. |
| created_at | INTEGER | |
| last_validated_at | INTEGER | |

`category` and `source` are orthogonal: `category` is *what* kind of learning (voice/structure/…); `source` is *who* produced the signal (reader/producer/…).

Migrations: `0003_engagement_learnings.sql` (initial), `0011_learnings_source.sql` (added `source`), `0012_learnings_piece_date.sql` (added `piece_date`).

### audit_results
One row per audit pass per draft — durable audit trail. Written by DirectorAgent after each audit round.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| task_id | TEXT | e.g. `daily/2026-04-17` — pipeline run ID |
| draft_id | TEXT | e.g. `daily/2026-04-17-r1` (task + round) |
| auditor | TEXT | voice, structure, or fact |
| passed | INTEGER | 0 or 1 |
| score | INTEGER | 0-100 for voice auditor, null for others |
| notes | TEXT | JSON: violations, issues, or claims |
| created_at | INTEGER | |

Indexes: `idx_audit_task` on `task_id`, `idx_audit_created` on `created_at`.

Migrations: `0004_audit_results.sql` (original), `0008_drop_agent_tasks.sql` (dropped the FK to the deleted `agent_tasks` table; original `audit_results` was empty across all runs because every INSERT failed the orphaned FK check).

### magic_tokens
Time-limited tokens for magic link passwordless login.

| Column | Type | Notes |
|--------|------|-------|
| token | TEXT PK | 64-char hex, cryptographically random |
| email | TEXT | The email the link was sent to |
| user_id | TEXT | FK→users if user exists, null for new signups |
| expires_at | INTEGER | Unix timestamp ms, 30 minutes from creation |
| used_at | INTEGER | Null until clicked, prevents reuse |
| created_at | INTEGER | |

Migration: `0005_magic_tokens.sql`

## Daily Pieces tables

### daily_candidates
News candidates from the Scanner, evaluated by the Director.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| date | TEXT | YYYY-MM-DD |
| headline | TEXT | News headline |
| source | TEXT | e.g. "Reuters", "BBC" |
| category | TEXT | TOP, TECHNOLOGY, SCIENCE, BUSINESS, HEALTH, WORLD |
| summary | TEXT | Short description from RSS |
| url | TEXT | Link to original story |
| teachability_score | INTEGER | 0-100, set by Director |
| selected | INTEGER | 1 if Director picked this story |
| created_at | INTEGER | |

Migration: `0006_daily_pieces.sql`

### daily_pieces
Published daily teaching pieces.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| date | TEXT | YYYY-MM-DD |
| headline | TEXT | The teaching piece title |
| underlying_subject | TEXT | What it teaches about |
| source_story | TEXT | Original news source |
| word_count | INTEGER | |
| beat_count | INTEGER | |
| voice_score | INTEGER | |
| fact_check_passed | INTEGER | |
| has_interactive | INTEGER | 0 or 1 |
| reading_minutes | INTEGER | |
| quality_flag | TEXT | NULL = normal, 'low' = audit failed after max revisions |
| has_audio | INTEGER | 0 or 1. Flipped to 1 by `Publisher.publishAudio` when the audio second-commit succeeds. Never set by Producer or Auditor. |
| published_at | INTEGER | |
| created_at | INTEGER | |

Migrations: `0006_daily_pieces.sql`, `0009_quality_flag.sql`, `0010_audio_pipeline.sql` (added `has_audio`)

### daily_piece_audio
Per-beat audio rows — one row per `<lesson-beat>` per piece. Producer writes; Auditor reads; Publisher reads for the second-commit frontmatter splice; transparency drawer + admin deep-dive page render from this.

| Column | Type | Notes |
|--------|------|-------|
| date | TEXT | YYYY-MM-DD. Part of composite PK. |
| beat_name | TEXT | e.g. "hook", "teach-1", "close". Matches `<lesson-beat name="…">`. Part of composite PK. |
| r2_key | TEXT | e.g. `audio/daily/2026-04-18/hook.mp3` |
| public_url | TEXT | URL the reader fetches. Currently `/{r2_key}` — needs site-worker R2 binding to resolve in prod. |
| character_count | INTEGER | Characters sent to ElevenLabs (post-`prepareForTTS`) — the billed count. |
| duration_seconds | INTEGER | Nullable — not currently measured. |
| request_id | TEXT | ElevenLabs `request-id` response header. Used for prosodic stitching on the next beat (`previous_request_ids`). |
| model | TEXT | e.g. `eleven_multilingual_v2`. Stored per row so future model swaps are visible in audit history. |
| voice_id | TEXT | e.g. `j9jfwdrw7BRfcR43Qohk` (Frederick Surrey). Same reason as model. |
| generated_at | INTEGER | Unix timestamp ms. |

PK: (date, beat_name). Index: `idx_piece_audio_date` on date.

Migration: `0010_audio_pipeline.sql`

### pipeline_log
Step-by-step record of each daily piece run. The admin dashboard polls this for the live pipeline monitor.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| run_id | TEXT | YYYY-MM-DD (one run per day) |
| step | TEXT | scanning, curating, drafting, auditing_r1, publishing, done, error |
| status | TEXT | running, done, failed |
| data | TEXT | JSON with step-specific data (scores, counts, headlines) |
| created_at | INTEGER | |

Migration: `0007_pipeline_log.sql`

## Migrations summary (11 migrations, 13 tables)
- `0001_init.sql` — users, progress, submissions, zita_messages
- `0002_observer_events.sql` — agent_tasks (later dropped), observer_events
- `0003_engagement_learnings.sql` — engagement, learnings
- `0004_audit_results.sql` — audit_results (later recreated in 0008) + idx_tasks_parent index
- `0005_magic_tokens.sql` — magic_tokens for passwordless login
- `0006_daily_pieces.sql` — daily_candidates, daily_pieces
- `0007_pipeline_log.sql` — pipeline_log for admin monitor
- `0008_drop_agent_tasks.sql` — dropped unused `agent_tasks` (course-era); recreated `audit_results` without its FK so Director can write the audit trail
- `0009_quality_flag.sql` — added `daily_pieces.quality_flag` so Director can publish-anyway on max-revision audit failure and mark the piece for archive-view filtering
- `0010_audio_pipeline.sql` — created `daily_piece_audio` (per-beat audio rows) + added `daily_pieces.has_audio` boolean. Un-paused the audio pipeline.
- `0011_learnings_source.sql` — added `learnings.source` (reader/producer/self-reflection/zita, nullable TEXT, no CHECK) + `idx_learnings_source`. Plumbing for P1.3 — widens the Learner from reader-only to all-signal.
- `0012_learnings_piece_date.sql` — added `learnings.piece_date` (YYYY-MM-DD TEXT, nullable at schema level for backfillability, enforced non-null at the application layer) + `idx_learnings_piece_date`. Enables the per-piece "What the system learned" section of the How-this-was-made drawer. Backfill for pre-migration rows is included as a commented one-time UPDATE inside the migration file (not auto-applied); mapping works via nearest-timestamp join of `learnings.created_at` to `daily_pieces.published_at`, restricted to producer/self-reflection sources.
