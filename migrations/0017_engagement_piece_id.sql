-- 0017_engagement_piece_id.sql
--
-- Rebuild `engagement` with piece_id as the primary attribution axis.
--
-- Motivation: `engagement` PK was `(lesson_id, course_id, date)` with
-- `lesson_id = piece_date` (set by lesson-shell at
-- src/interactive/lesson-shell.ts:228). At `interval_hours=24` each
-- date has exactly one piece, so piece_date uniquely identified the
-- piece. At multi-per-day (the cadence the admin UI now allows) two
-- pieces publishing on the same date would UPSERT into the same row —
-- pooling their reader counts and corrupting Learner's reader-path
-- attribution + the admin per-piece engagement widget.
--
-- Closes the "Partial fix at multi-per-day" note in
-- `LearnerAgent.analyseAndLearn` at agents/src/learner.ts — which
-- currently resolves piece_id via date-based lookup (arbitrary at
-- multi-per-day). Post-migration the engagement row carries piece_id
-- directly; the date lookup goes away.
--
-- Shape of the rebuild:
--   - New PK: (piece_id, course_id, date)   [piece_id NOT NULL going forward]
--   - Keep `lesson_id` as a plain column for backwards-compat reads
--     (admin widget's pre-Phase-7 query used it; post-migration code
--     will switch to piece_id, but the column stays so historical
--     queries still work during rollout).
--   - Indices preserved + new idx_engagement_piece.
--
-- Backfill strategy:
--   13 historical engagement rows across 5 distinct lesson_ids
--   (2026-04-17, -18, -19, -20, -21). At 1/day cadence the
--   `daily_pieces.date = engagement.lesson_id` join is unambiguous
--   (one piece per date). All 13 rows get a piece_id from daily_pieces.
--   No orphans expected — defensive: if a non-daily row somehow exists
--   (course_id != 'daily'), COALESCE falls back to lesson_id as
--   piece_id so the row survives.
--
-- Safety: the old table is snapshotted as `engagement_backup_20260422`
-- before the rebuild. 7-day rollback window — drop queued in FOLLOWUPS
-- for 2026-04-29.

-- 1. Snapshot for rollback.
CREATE TABLE engagement_backup_20260422 AS SELECT * FROM engagement;

-- 2. New table with piece_id-keyed PK.
CREATE TABLE engagement_new (
  piece_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  date TEXT NOT NULL,
  views INTEGER DEFAULT 0,
  completions INTEGER DEFAULT 0,
  avg_time_seconds INTEGER,
  drop_off_beat TEXT,
  audio_plays INTEGER DEFAULT 0,
  PRIMARY KEY (piece_id, course_id, date)
);

-- 3. Backfill from old table + daily_pieces.
INSERT INTO engagement_new (
  piece_id, lesson_id, course_id, date,
  views, completions, avg_time_seconds, drop_off_beat, audio_plays
)
SELECT
  COALESCE(dp.id, e.lesson_id) AS piece_id,
  e.lesson_id,
  e.course_id,
  e.date,
  e.views,
  e.completions,
  e.avg_time_seconds,
  e.drop_off_beat,
  e.audio_plays
FROM engagement e
LEFT JOIN daily_pieces dp
  ON dp.date = e.lesson_id AND e.course_id = 'daily';

-- 4. Drop the old, rename the new.
DROP TABLE engagement;
ALTER TABLE engagement_new RENAME TO engagement;

-- 5. Recreate indices (matching 0003's shape) + add piece_id index.
CREATE INDEX IF NOT EXISTS idx_engagement_course ON engagement(course_id);
CREATE INDEX IF NOT EXISTS idx_engagement_date ON engagement(date);
CREATE INDEX IF NOT EXISTS idx_engagement_piece ON engagement(piece_id);
