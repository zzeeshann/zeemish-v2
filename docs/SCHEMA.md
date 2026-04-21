# Zeemish v2 — Database Schema (D1)

Database: `zeemish` (Cloudflare D1, SQLite)
Database ID: `f3cdccbf-7cea-4af1-b524-20f6a6fe1dd4`
**14 tables across 16 migrations.**

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
| piece_date | TEXT | YYYY-MM-DD of the `daily_pieces` row this conversation is about. Nullable at schema level so migration 0013 applied non-destructively to 92 pre-existing rows (backfilled via commented one-time UPDATEs in the migration file). Application layer (Commit B of Phase 1) enforces non-null for `course_slug='daily'` requests; lessons-course path still works with piece_date=null. Indexed via `idx_zita_piece(user_id, piece_date)`. Primary read paths: scoped history load in `/api/zita/chat`, per-piece admin view, P1.5 synthesis by piece. |
| piece_id | TEXT | `daily_pieces.id` (UUID) this conversation is about. Added migration 0014 (cadence Phase 1) so Phase 6's Zita re-scoping can target a specific piece when multiple share a date. Nullable at schema level; backfilled from `piece_date → daily_pieces.date → daily_pieces.id` for the 92 migration-0013 rows. Indexed via `idx_zita_piece_id`. `piece_date` stays alongside for now — Phase 6 will deprecate the date-scoped SELECT in favour of piece_id. |

Migrations: `0001_init.sql` (initial), `0013_zita_messages_piece_date.sql` (added `piece_date`), `0014_piece_id_fks.sql` (added `piece_id`).

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
| piece_id | TEXT | `daily_pieces.id` (UUID) this learning is about. Added migration 0014 (cadence Phase 1). Nullable at schema level; backfilled for all 27 prod rows via `piece_date → daily_pieces.date → daily_pieces.id` lookup. Indexed via `idx_learnings_piece_id`. `piece_date` stays alongside — Phase 3+ callers pass both; a later phase may drop `piece_date` once the dual-key write posture is proven. |
| created_at | INTEGER | |
| last_validated_at | INTEGER | |

`category` and `source` are orthogonal: `category` is *what* kind of learning (voice/structure/…); `source` is *who* produced the signal (reader/producer/…).

Migrations: `0003_engagement_learnings.sql` (initial), `0011_learnings_source.sql` (added `source`), `0012_learnings_piece_date.sql` (added `piece_date`), `0014_piece_id_fks.sql` (added `piece_id`).

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
| piece_id | TEXT | `daily_pieces.id` (UUID) this audit is about. Added migration 0014 (cadence Phase 1). Nullable; backfilled for the 3 prod rows via `date(created_at/1000,'unixepoch') → daily_pieces.date → daily_pieces.id`. Indexed via `idx_audit_results_piece`. Existing `task_id` / `draft_id` stay alongside — they're per-round identifiers that don't cleanly map to a single piece without the FK. |
| created_at | INTEGER | |

Indexes: `idx_audit_task` on `task_id`, `idx_audit_created` on `created_at`, `idx_audit_results_piece` on `piece_id`.

Migrations: `0004_audit_results.sql` (original), `0008_drop_agent_tasks.sql` (dropped the FK to the deleted `agent_tasks` table; original `audit_results` was empty across all runs because every INSERT failed the orphaned FK check), `0014_piece_id_fks.sql` (added `piece_id`).

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
| selected | INTEGER | 1 if Director picked this story. **Historical data-flow quirk:** all 250 prod rows have `selected=0` despite 5 pieces having been published — see FOLLOWUPS "`daily_candidates.selected` never flipped on historical runs". |
| piece_id | TEXT | `daily_pieces.id` (UUID) for the candidate Director picked. Added migration 0014 (cadence Phase 1). Nullable — unselected candidates carry NULL, the selected one gets set atomically with `selected=1`. No historical backfill (0 historical rows had `selected=1`). Indexed via `idx_candidates_piece_id`. |
| created_at | INTEGER | |

Migrations: `0006_daily_pieces.sql`, `0014_piece_id_fks.sql` (added `piece_id`).

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
| piece_id | TEXT | `daily_pieces.id` (UUID). Part of composite PK. Added via migration 0015 (cadence Phase 1) — previously `date` held this role. |
| beat_name | TEXT | e.g. "hook", "teach-1", "close". Matches `<lesson-beat name="…">`. Part of composite PK. |
| date | TEXT | YYYY-MM-DD. Kept as a non-PK column for display/filter after the 0015 PK rebuild — no longer part of the key. |
| r2_key | TEXT | e.g. `audio/daily/2026-04-18/hook.mp3` |
| public_url | TEXT | URL the reader fetches. Currently `/{r2_key}` — needs site-worker R2 binding to resolve in prod. |
| character_count | INTEGER | Characters sent to ElevenLabs (post-`prepareForTTS`) — the billed count. |
| duration_seconds | INTEGER | Nullable — not currently measured. |
| request_id | TEXT | ElevenLabs `request-id` response header. Used for prosodic stitching on the next beat (`previous_request_ids`). |
| model | TEXT | e.g. `eleven_multilingual_v2`. Stored per row so future model swaps are visible in audit history. |
| voice_id | TEXT | e.g. `j9jfwdrw7BRfcR43Qohk` (Frederick Surrey). Same reason as model. |
| generated_at | INTEGER | Unix timestamp ms. |

PK: **(piece_id, beat_name)** (since migration 0015). Indexes: `idx_piece_audio_piece` on `piece_id`, `idx_piece_audio_date` on `date`.

Migrations: `0010_audio_pipeline.sql` (original, PK was (date, beat_name)), `0015_daily_piece_audio_piece_id_pk.sql` (PK rebuild to (piece_id, beat_name), snapshot → create-new → copy → drop-old → rename, with `daily_piece_audio_backup_20260421` held for rollback through 2026-04-28).

### pipeline_log
Step-by-step record of each daily piece run. The admin dashboard polls this for the live pipeline monitor.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| run_id | TEXT | `YYYY-MM-DD` — the calendar day of this step's run. **Semantic walk-back 2026-04-21:** Phase 1's briefing had proposed shifting run_id to piece_id UUIDs, and the backfill ran, but four site-worker queries (`made.ts`, admin piece deep-dive, dashboard pipeline API + index) had embedded `run_id = YYYY-MM-DD` assumptions. Backfill rolled back from `pipeline_log_backup_20260421` the same day. Revised architecture: run_id stays date-shape permanently; a separate `piece_id TEXT` column will be added in a future migration for per-piece filtering. See DECISIONS 2026-04-21 "Roll back `pipeline_log.run_id` backfill". |
| step | TEXT | scanning, curating, drafting, auditing_r1, publishing, done, error |
| status | TEXT | running, done, failed |
| data | TEXT | JSON with step-specific data (scores, counts, headlines) |
| created_at | INTEGER | |

Migrations: `0007_pipeline_log.sql` (initial). Migration 0014's proposed run_id semantic shift was reverted same-day — no net schema or data change to this table.

### admin_settings
Key/value table for admin-configurable system state. One row per setting. First consumer is `interval_hours` read by Director (Phase 2 of the cadence plan); future settings (rate limits, feature flags, voice overrides, scanner feed overrides) live here too.

| Column | Type | Notes |
|--------|------|-------|
| key | TEXT PK | e.g. `interval_hours` |
| value | TEXT NOT NULL | Stringly-typed. Caller parses to expected shape via helper (`agents/src/shared/admin-settings.ts` → `getAdminSetting<T>(db, key, parse, fallback)`). Non-null even when logically empty — use a sentinel value rather than allowing null. |
| updated_at | INTEGER NOT NULL | Unix timestamp ms. Last write time. |

Read path: [`getAdminSetting`](../agents/src/shared/admin-settings.ts) — swallows every failure mode (missing row, non-string value, DB throw) and returns the caller's `fallback`. Fresh read per call, no caching.

Write path: currently seeded via migration only (`INSERT OR IGNORE interval_hours='24'`). Phase 5 of the cadence plan adds the admin UI + `/api/dashboard/admin/settings` endpoint, with an `admin_settings_changed` observer_event fired alongside every UPDATE for audit-trail.

Seeded values: `interval_hours = '24'` (preserves current 1-piece/day production cadence until Phase 3 wires the hourly gate).

Migration: `0016_admin_settings.sql`

## Migrations summary (16 migrations, 14 tables)
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
- `0013_zita_messages_piece_date.sql` — added `zita_messages.piece_date` (YYYY-MM-DD TEXT, nullable at schema level for backfillability, enforced non-null at the application layer for `course_slug='daily'`) + composite `idx_zita_piece(user_id, piece_date)`. Fixes the data-model bug where every daily piece mounted `<zita-chat course="daily" lesson="0">` and pooled all pieces' conversations under one key. Backfill for the 92 pre-migration rows is a commented one-time block inside the migration file, mapped by hand from conversation content + created_at windows against the five pieces 2026-04-17 through 2026-04-21. Includes a snapshot step (`zita_messages_backup_20260421`) run before any UPDATE — rollback is `DELETE + INSERT SELECT` from the backup. Backup table queued for drop on or after 2026-04-28 via FOLLOWUPS.
- `0014_piece_id_fks.sql` — multi-piece cadence Phase 1. Added nullable `piece_id TEXT` FK columns + indexes to `audit_results`, `learnings`, `zita_messages`, `daily_candidates`. Auto-applied ALTERs; backfill UPDATEs commented for manual `wrangler d1 execute` runs (all 4 tables + `pipeline_log.run_id` semantic shift from `YYYY-MM-DD` strings to `daily_pieces.id` UUIDs). Applied 2026-04-21. `daily_candidates` has no historical backfill — 250 rows, 0 with `selected=1` (separate FOLLOWUPS investigation).
- `0015_daily_piece_audio_piece_id_pk.sql` — multi-piece cadence Phase 1, PK rebuild. `daily_piece_audio` PK switched from `(date, beat_name)` to `(piece_id, beat_name)` via snapshot → create-new → copy → drop-old → rename, all auto-applied. 32 rows backfilled via correlated subquery on `daily_pieces.date`. `daily_piece_audio_backup_20260421` snapshot held for rollback through 2026-04-28 via FOLLOWUPS.
- `0016_admin_settings.sql` — multi-piece cadence Phase 2. Created `admin_settings(key, value, updated_at)` — first admin-configurable surface in Zeemish v2. Seeded `interval_hours='24'` via `INSERT OR IGNORE` (preserves current 1-piece/day cadence). Read by Director at start of `triggerDailyPiece`; gate logic lands in Phase 3. Future settings (rate limits, feature flags, voice overrides) will use the same table.
