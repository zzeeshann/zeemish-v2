-- 0011_learnings_source.sql
--
-- Add a `source` column to `learnings` so consumers can slice by
-- origin. Four expected values, documented in docs/SCHEMA.md:
--   'reader'           — reader-behaviour signals (engagement, drop-off)
--   'producer'         — pipeline quality signals (auditors, curator,
--                        candidate-vs-picked, revision rounds)
--   'self-reflection'  — Drafter's own post-draft review of a piece
--   'zita'             — patterns found in reader Zita questions
--
-- Loose TEXT and nullable on purpose — no CHECK constraint. A fifth
-- source category we haven't thought of yet is cheap to add at the
-- write site; a schema that constrains too early constrains wrong.
-- Rows written before this migration stay NULL and will be understood
-- as 'unspecified (pre-P1.3)' by any reader that cares.
--
-- Enables (not in this migration, coming in the P1.3-behaviour commit):
--   - Learner.analysePiecePostPublish writing producer-origin rows
--   - Drafter self-reflection writing self-reflection-origin rows
--   - Future Learner read paths slicing by source for targeted analysis

ALTER TABLE learnings ADD COLUMN source TEXT;

CREATE INDEX IF NOT EXISTS idx_learnings_source ON learnings(source);
