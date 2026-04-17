-- 0009_quality_flag.sql
--
-- Add quality_flag to daily_pieces so the pipeline's "publish-anyway on
-- round-3 audit fail" path can mark a piece as low-quality without
-- deleting or regenerating it. NULL = normal, 'low' = audit failed after
-- max revisions.
--
-- Why: Previously, Director's else-branch on max-revision failure set its
-- own status to 'error' and never called Publisher. That left some days
-- with no piece — bad for a daily-cadence product. New behaviour: publish
-- the best revision, flag it, and filter it out of the archive/library so
-- it doesn't pollute the long-term catalogue. Hard rule still holds — we
-- don't revise after publish; we just filter archive views.
--
-- Readers still see a low-quality piece at /daily/YYYY-MM-DD/ so the day
-- isn't blank, with a banner explaining the situation. The low piece is
-- permanent (no deletion), just not surfaced in Library/Recent lists.

ALTER TABLE daily_pieces ADD COLUMN quality_flag TEXT DEFAULT NULL;
