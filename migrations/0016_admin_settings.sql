-- 0016_admin_settings.sql
--
-- Multi-piece cadence — Phase 2, admin_settings table.
--
-- First admin-configurable surface in Zeemish v2. Key/value shape,
-- stringly-typed values (application layer parses). Primary consumer
-- in Phase 2 is Director reading `interval_hours`; Phase 5 will add
-- an admin UI that writes to it. Future settings (rate limits,
-- feature flags, voice overrides, scanner feed overrides) live in the
-- same table so there's one operational surface for "system config".
--
-- Write path (Phase 5 onwards): the site worker's admin API mutates
-- the row inside a transaction that also fires an
-- `admin_settings_changed` observer_event — audit trail in the same
-- place as the rest of the system's activity.
--
-- Seeded with `interval_hours = 24` so Director's read path finds the
-- current 1-piece-per-day production cadence as-is. The helper
-- (agents/src/shared/admin-settings.ts) also falls back to 24 if the
-- row is missing for any reason, so a DB wipe + migration replay
-- would still preserve production behaviour.

CREATE TABLE IF NOT EXISTS admin_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

INSERT OR IGNORE INTO admin_settings (key, value, updated_at)
VALUES ('interval_hours', '24', 1776900000000);

-- ══════════════════════════════════════════════════════════════════
-- POST-APPLY VERIFY (run via `wrangler d1 execute --remote`)
-- ══════════════════════════════════════════════════════════════════
--
-- PRAGMA table_info(admin_settings);
-- -- expect 3 columns: key (TEXT PK), value (TEXT NOT NULL),
-- --                   updated_at (INTEGER NOT NULL).
--
-- SELECT * FROM admin_settings;
-- -- expect exactly one row: interval_hours = '24'.
