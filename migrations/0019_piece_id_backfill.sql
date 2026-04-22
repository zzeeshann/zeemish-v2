-- 0019_piece_id_backfill.sql
--
-- Multi-per-day piece_id schema fix — Phase 2 backfill.
--
-- Populates piece_id on historical rows across 3 day-keyed tables:
--   - audit_results     (9 null rows, all 2026-04-22)
--   - pipeline_log      (153 null rows across 6 dates)
--   - daily_candidates  (350 null rows across 6 dates)
--
-- Two-strategy split:
--   (a) pre-2026-04-22 rows — 1/day cadence, unambiguous date→piece_id lookup
--   (b) 2026-04-22 rows — two pieces, midpoint-based partition by created_at
--
-- Midpoint constants for 2026-04-22:
--   air-traffic piece_id = '726b2abf-d4e2-4156-8b66-7c2b9dd2623d'
--   air-traffic published_at = 1776823358898
--   tobacco     piece_id = '878def34-3407-4bf7-9d1f-93c48511e3ca'
--   tobacco     published_at = 1776877370089
--   midpoint               = 1776850364493
--
-- All UPDATEs are idempotent (WHERE piece_id IS NULL) so re-running is safe.
-- This file is run manually via `wrangler d1 execute --remote`, same
-- pattern as migrations 0012 and 0014 Step 2 backfills. Not
-- auto-applied because UPDATE batches against production benefit from
-- an operator sanity step before execution.
--
-- The migration tracker does NOT mark this applied — it's a data
-- operation, not a schema change. Add an empty entry after execution
-- if you want the audit trail visible in `d1_migrations`.

-- ══════════════════════════════════════════════════════════════════
-- STRATEGY A — pre-2026-04-22 rows via correlated date JOIN
-- ══════════════════════════════════════════════════════════════════

-- No audit_results rows pre-2026-04-22 are null (0014 backfilled them).
-- Block kept for symmetry + idempotence if a future audit run finds any.
UPDATE audit_results SET piece_id = (
  SELECT id FROM daily_pieces
  WHERE 'daily/' || daily_pieces.date = audit_results.task_id
) WHERE piece_id IS NULL
  AND task_id LIKE 'daily/%'
  AND substr(task_id, 7) < '2026-04-22';

UPDATE pipeline_log SET piece_id = (
  SELECT id FROM daily_pieces WHERE daily_pieces.date = pipeline_log.run_id
) WHERE piece_id IS NULL
  AND run_id < '2026-04-22';

UPDATE daily_candidates SET piece_id = (
  SELECT id FROM daily_pieces WHERE daily_pieces.date = daily_candidates.date
) WHERE piece_id IS NULL
  AND date < '2026-04-22';

-- ══════════════════════════════════════════════════════════════════
-- STRATEGY B — 2026-04-22 rows via midpoint partition
-- ══════════════════════════════════════════════════════════════════

-- Air-traffic: rows with created_at < midpoint
UPDATE audit_results SET piece_id = '726b2abf-d4e2-4156-8b66-7c2b9dd2623d'
  WHERE piece_id IS NULL AND task_id = 'daily/2026-04-22' AND created_at < 1776850364493;

UPDATE pipeline_log SET piece_id = '726b2abf-d4e2-4156-8b66-7c2b9dd2623d'
  WHERE piece_id IS NULL AND run_id = '2026-04-22' AND created_at < 1776850364493;

UPDATE daily_candidates SET piece_id = '726b2abf-d4e2-4156-8b66-7c2b9dd2623d'
  WHERE piece_id IS NULL AND date = '2026-04-22' AND created_at < 1776850364493;

-- Tobacco: rows with created_at >= midpoint
UPDATE audit_results SET piece_id = '878def34-3407-4bf7-9d1f-93c48511e3ca'
  WHERE piece_id IS NULL AND task_id = 'daily/2026-04-22' AND created_at >= 1776850364493;

UPDATE pipeline_log SET piece_id = '878def34-3407-4bf7-9d1f-93c48511e3ca'
  WHERE piece_id IS NULL AND run_id = '2026-04-22' AND created_at >= 1776850364493;

UPDATE daily_candidates SET piece_id = '878def34-3407-4bf7-9d1f-93c48511e3ca'
  WHERE piece_id IS NULL AND date = '2026-04-22' AND created_at >= 1776850364493;

-- ══════════════════════════════════════════════════════════════════
-- POST-BACKFILL VERIFY
-- ══════════════════════════════════════════════════════════════════
--
-- SELECT 'audit_results'    AS t, COUNT(*) AS null_piece_id FROM audit_results    WHERE piece_id IS NULL
-- UNION ALL SELECT 'pipeline_log',      COUNT(*) FROM pipeline_log      WHERE piece_id IS NULL
-- UNION ALL SELECT 'daily_candidates',  COUNT(*) FROM daily_candidates  WHERE piece_id IS NULL;
-- -- expect null_piece_id = 0 across all three tables
--
-- Spot-check distinct piece_ids are valid UUIDs matching daily_pieces.id:
-- SELECT DISTINCT piece_id FROM audit_results ORDER BY piece_id;
-- SELECT DISTINCT piece_id FROM pipeline_log  ORDER BY piece_id;
-- SELECT DISTINCT piece_id FROM daily_candidates ORDER BY piece_id;
-- -- expect 6 UUIDs in each (5 pre-2026-04-22 pieces + 2 on 2026-04-22 = 7 total,
-- -- but some tables don't have rows for every piece, e.g. audit_results has
-- -- no rows for piece 2026-04-19 historically; that's fine).

-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ══════════════════════════════════════════════════════════════════
--
-- UPDATE audit_results SET piece_id = NULL;
-- UPDATE pipeline_log SET piece_id = NULL;
-- UPDATE daily_candidates SET piece_id = NULL;
-- Only needed if Phase 3 writer-side work regresses and we need to
-- drop the column. Readers keep a date-fallback branch through Phase 4
-- so partial null coverage doesn't crash consumers.
