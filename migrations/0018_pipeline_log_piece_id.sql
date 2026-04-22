-- 0018_pipeline_log_piece_id.sql
--
-- Multi-per-day piece_id schema fix — Phase 1 (additive migration only).
--
-- Adds `piece_id TEXT` to `pipeline_log`. The other two day-keyed tables
-- (`audit_results`, `daily_candidates`) already received the column in
-- migration 0014, but pipeline_log was deliberately left out at the
-- time — see the big "DO NOT RUN — ROLLED BACK 2026-04-21" block in
-- 0014 Step 5. That earlier attempt reused `run_id` to hold piece_id
-- values and broke four site-worker consumers. The DECISIONS
-- 2026-04-21 "Roll back pipeline_log.run_id backfill" entry resolved
-- on the architecture shipped here: `run_id` stays `YYYY-MM-DD`
-- permanently, and `piece_id` is added as a separate nullable column
-- alongside, with all site-worker readers updated atomically (Phase
-- 4). Day-aggregation views (admin pipeline history, lifetime run
-- counts) keep using `run_id` for day-grouping semantics.
--
-- Background: at multi-per-day cadence (interval_hours < 24), two
-- pieces publishing on the same date share the same `run_id`, causing
-- the admin per-piece deep-dive to pool both pieces' steps. With
-- piece_id populated going forward, per-piece queries shift to
-- `WHERE piece_id = ?`, giving clean isolation.
--
-- Backfill for the 153 historical rows lives in migration 0019,
-- executed manually via `wrangler d1 execute` once Phase 1 lands.
-- Same split strategy as 0014:
--   - pre-2026-04-22 rows (1/day, unambiguous): correlated UPDATE via
--     `pipeline_log.run_id = daily_pieces.date` join
--   - 2026-04-22 rows (2 pieces): midpoint-based UPDATE using the
--     pieces' published_at values
--
-- Additive ALTER — no snapshot table, no data loss. If Phase 3's
-- writer-side threading regresses, reverting is a simple column drop
-- (D1 supports DROP COLUMN as of 2024).

-- ══════════════════════════════════════════════════════════════════
-- AUTO-APPLIED (runs on `wrangler d1 migrations apply`)
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE pipeline_log ADD COLUMN piece_id TEXT;

CREATE INDEX IF NOT EXISTS idx_pipeline_log_piece ON pipeline_log(piece_id);

-- ══════════════════════════════════════════════════════════════════
-- POST-APPLY VERIFY
-- ══════════════════════════════════════════════════════════════════
--
-- PRAGMA table_info(pipeline_log);  -- expect piece_id TEXT column present
--
-- SELECT COUNT(*) FROM pipeline_log WHERE piece_id IS NULL;
-- -- expect 153 (all historical rows null until 0019 backfill)
