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
-- ONE-TIME BACKFILL — run manually, not on `wrangler d1 migrations apply`
-- ──────────────────────────────────────────────────────────────────
-- Two commands below: a dry-run SELECT to preview the mapping, then the
-- UPDATE itself. Verify the mapping looks sane before running the UPDATE —
-- timestamp-proximity joins are cheap to preview and cheap to get wrong.
--
-- Copy each command into:
--   wrangler d1 execute zeemish --remote --command "<SQL>"
--
-- Restricted to producer/self-reflection sources because those fire
-- within seconds of publish; reader/zita sources arrive much later and
-- shouldn't be force-mapped via timestamp proximity (no such rows exist
-- yet). Rows whose nearest daily_piece has NULL published_at won't
-- match — they stay NULL and simply don't appear in any drawer, which
-- matches the drawer's "show nothing if no learnings" behaviour.

-- ─── Dry-run: preview the mapping before the UPDATE. ───────────────
-- SELECT
--   l.id,
--   l.source,
--   datetime(l.created_at / 1000, 'unixepoch') as learning_at,
--   (SELECT dp.date FROM daily_pieces dp WHERE dp.published_at IS NOT NULL
--    ORDER BY ABS(dp.published_at - l.created_at) ASC LIMIT 1) as would_map_to
-- FROM learnings l
-- WHERE l.piece_date IS NULL
--   AND l.source IN ('producer', 'self-reflection');

-- ─── Backfill: run only after the dry-run looks correct. ───────────
-- UPDATE learnings
-- SET piece_date = (
--   SELECT dp.date
--   FROM daily_pieces dp
--   WHERE dp.published_at IS NOT NULL
--   ORDER BY ABS(dp.published_at - learnings.created_at) ASC
--   LIMIT 1
-- )
-- WHERE piece_date IS NULL
--   AND source IN ('producer', 'self-reflection');
