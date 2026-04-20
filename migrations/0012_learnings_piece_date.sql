-- 0012_learnings_piece_date.sql
--
-- Add `piece_date` TEXT to `learnings` so a learning row can point back
-- to the specific daily piece it was written about. Enables the per-piece
-- "What the system learned" section in the How-this-was-made drawer
-- (queried as `WHERE piece_date = ?`).
--
-- Nullable at schema level for backfillability — pre-migration rows get
-- filled via a one-time UPDATE (commented below, run manually via
-- `wrangler d1 execute`, NOT as an auto-applied migration). Application
-- layer (`writeLearning`) enforces non-null going forward: any new row
-- written without a piece_date is refused with a warn to
-- observer_events, same defensive shape as `source`.
--
-- Enables:
--   - Drawer-side query: `SELECT observation, source, created_at FROM
--     learnings WHERE piece_date = ? ORDER BY created_at ASC`
--   - Future cross-piece diffing (which learnings recurred across
--     multiple pieces?) without a timestamp-proximity heuristic

ALTER TABLE learnings ADD COLUMN piece_date TEXT;

CREATE INDEX IF NOT EXISTS idx_learnings_piece_date ON learnings(piece_date);

-- ──────────────────────────────────────────────────────────────────
-- ONE-TIME BACKFILL (run 2026-04-20) — preserved for historical record
-- ──────────────────────────────────────────────────────────────────
-- Restricted to producer/self-reflection sources because those fire
-- within seconds of publish; reader/zita sources arrive much later and
-- shouldn't be force-mapped via timestamp proximity (no such rows
-- existed at migration time anyway). Rows whose nearest daily_piece
-- has NULL published_at simply stay NULL and don't appear in any
-- drawer — matches the drawer's "show nothing if no learnings"
-- behaviour.
--
-- SHAPE NOTE — the first-draft plan used a correlated subquery for
-- nearest-timestamp matching:
--   UPDATE learnings SET piece_date = (SELECT dp.date FROM
--     daily_pieces dp WHERE dp.published_at IS NOT NULL ORDER BY
--     ABS(dp.published_at - learnings.created_at) ASC LIMIT 1) WHERE ...
-- D1 rejected this with "no such column: learnings.created_at" —
-- correlated subqueries referencing the outer table from the inner
-- ORDER BY / WHERE appear unsupported against D1's query planner.
-- See FOLLOWUPS.md "D1 correlated-subquery limitation". Rewrote as
-- calendar-date equality — for this 13-row backfill the outcome is
-- identical (every row's created_at lands on the same calendar day as
-- its corresponding piece's published_at), and the shape sidesteps the
-- D1 limitation.
--
-- The actual backfill ran as two queries via `wrangler d1 execute`:

-- ─── Dry-run: verify the two sides visually before updating. ───────
-- SELECT id, source, datetime(created_at / 1000, 'unixepoch') as learning_at
-- FROM learnings WHERE piece_date IS NULL
--   AND source IN ('producer', 'self-reflection') ORDER BY created_at;
--
-- SELECT date, datetime(published_at / 1000, 'unixepoch') as published_at
-- FROM daily_pieces WHERE published_at IS NOT NULL ORDER BY published_at;

-- ─── Backfill: one UPDATE per affected piece_date. ─────────────────
-- Ran 2026-04-20, 4 rows → 2026-04-17, 9 rows → 2026-04-20.
-- UPDATE learnings SET piece_date = '2026-04-17'
-- WHERE piece_date IS NULL AND source IN ('producer', 'self-reflection')
--   AND date(created_at / 1000, 'unixepoch') = '2026-04-17';
--
-- UPDATE learnings SET piece_date = '2026-04-20'
-- WHERE piece_date IS NULL AND source IN ('producer', 'self-reflection')
--   AND date(created_at / 1000, 'unixepoch') = '2026-04-20';
