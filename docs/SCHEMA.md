# Zeemish v2 — Database Schema (D1)

Database: `zeemish` (Cloudflare D1, SQLite)
Migration: `migrations/0001_init.sql`

## Tables

### users
Stores every visitor — anonymous and authenticated.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID. Generated on first visit. |
| email | TEXT UNIQUE | Null for anonymous users. Added on upgrade. |
| password_hash | TEXT | PBKDF2 hash. Null for anonymous users. |
| created_at | INTEGER | Unix timestamp ms. |
| updated_at | INTEGER | Unix timestamp ms. |

### progress
Tracks which beat a reader is on and which lessons they've completed.

| Column | Type | Notes |
|--------|------|-------|
| user_id | TEXT FK | References users.id |
| course_slug | TEXT | e.g. "body" |
| lesson_number | INTEGER | e.g. 1 |
| current_beat | TEXT | e.g. "teaching-1". Null if not started or completed. |
| completed_at | INTEGER | Unix timestamp ms. Null if not finished. |
| created_at | INTEGER | Unix timestamp ms. |
| updated_at | INTEGER | Unix timestamp ms. |

Primary key: (user_id, course_slug, lesson_number)

### submissions
Optional practice data (e.g., breathing timer results).

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| user_id | TEXT FK | References users.id |
| course_slug | TEXT | |
| lesson_number | INTEGER | |
| practice_type | TEXT | e.g. "breathing" |
| data | TEXT | JSON blob |
| created_at | INTEGER | |

### zita_messages
For the Zita conversational guide (Stage 7). Created now, used later.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| user_id | TEXT FK | |
| course_slug | TEXT | |
| lesson_number | INTEGER | |
| role | TEXT | "user" or "assistant" |
| content | TEXT | Message text |
| created_at | INTEGER | |
