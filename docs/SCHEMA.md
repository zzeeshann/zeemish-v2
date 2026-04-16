# Zeemish v2 — Database Schema (D1)

Database: `zeemish` (Cloudflare D1, SQLite)
Database ID: `f3cdccbf-7cea-4af1-b524-20f6a6fe1dd4`

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

### agent_tasks
Log of every pipeline run (for observability).

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| parent_task_id | TEXT | Null for root tasks |
| agent_name | TEXT | e.g. "director" |
| task_type | TEXT | e.g. "publish_lesson" |
| status | TEXT | queued, running, succeeded, failed, escalated |
| input | TEXT | JSON |
| output | TEXT | JSON, null while running |
| error | TEXT | Null on success |
| started_at | INTEGER | |
| completed_at | INTEGER | |
| created_at | INTEGER | |

Migration: `0002_observer_events.sql`

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
Cross-agent learnings database — patterns that work or don't.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| category | TEXT | voice, structure, engagement, fact |
| observation | TEXT | The insight |
| evidence | TEXT | JSON: what supports this |
| confidence | INTEGER | 0-100 |
| applied_to_prompts | INTEGER | 0 or 1 |
| created_at | INTEGER | |
| last_validated_at | INTEGER | |

Migration: `0003_engagement_learnings.sql`

## Missing tables (not yet created)

### audit_results (planned)
One row per audit pass per draft — provides a durable audit trail.
See architecture doc Section 7.2. Needs a migration to create.
