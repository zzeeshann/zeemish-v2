-- 0020_observer_events_piece_id.sql
--
-- Multi-per-day audit — observer_events piece scoping.
--
-- Adds `piece_id TEXT` to `observer_events`. The admin per-piece
-- deep-dive at [src/pages/dashboard/admin/piece/[date]/[slug].astro]
-- was the last remaining day-keyed surface after the 2026-04-22
-- piece_id schema fix (migration 0018 + 0019). Its observer_events
-- query fell back to a 36h day-of-publish window because no row
-- carried a piece_id; at `interval_hours<24` the section pools every
-- operator event for the day onto each piece's page (the user caught
-- this on 2026-04-22 viewing the tobacco piece and seeing air-traffic's
-- Published/Audio events mixed in).
--
-- Same additive pattern as 0018: nullable ALTER, no backfill. Existing
-- rows stay NULL; the admin query falls back to the 36h day window
-- for legacy NULL rows, scopes strictly by piece_id for new rows.
-- Mixed mode is intentional and acceptable for the short tail of
-- legacy NULL events — they age out of the active view as new events
-- accumulate under the new schema.
--
-- Not every observer event is piece-scoped. `admin_settings_changed`,
-- `zita_rate_limited`, `zita_claude_error`, `zita_handler_error` stay
-- piece_id NULL permanently (non-piece system events). These shouldn't
-- show on a per-piece admin page anyway, and the OR-fallback query
-- won't surface them outside the 36h window.
--
-- Additive ALTER — no snapshot table, no data loss. Rollback is DROP
-- COLUMN (D1 supports it).

-- ══════════════════════════════════════════════════════════════════
-- AUTO-APPLIED (runs on `wrangler d1 migrations apply`)
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE observer_events ADD COLUMN piece_id TEXT;

CREATE INDEX IF NOT EXISTS idx_observer_events_piece ON observer_events(piece_id);

-- ══════════════════════════════════════════════════════════════════
-- POST-APPLY VERIFY
-- ══════════════════════════════════════════════════════════════════
--
-- PRAGMA table_info(observer_events);  -- expect piece_id TEXT column
-- SELECT COUNT(*) FROM observer_events WHERE piece_id IS NULL;
-- -- expect full count (all historical rows NULL until new writes land)
