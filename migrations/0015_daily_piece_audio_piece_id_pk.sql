-- 0015_daily_piece_audio_piece_id_pk.sql
--
-- Multi-piece cadence — Phase 1, audio PK rebuild.
--
-- The existing PK is `(date, beat_name)`. At 1 piece/day that's
-- unambiguous; at multi-per-day two pieces sharing a date would
-- conflict on beat names. New PK is `(piece_id, beat_name)`.
--
-- SQLite cannot ALTER a PRIMARY KEY in place. The standard rebuild
-- pattern is snapshot → new table → copy rows → drop old → rename
-- new. All five steps are auto-applied here so `wrangler d1
-- migrations apply` runs the rebuild atomically per the tracker.
--
-- Snapshot-first is the same pattern as Zita Phase 1 (migration 0013's
-- zita_messages_backup_20260421). 32 rows across 5 dates — the backup
-- is free insurance. Retention: drop on or after 2026-04-28 once
-- Phase 3 has been live for a week (FOLLOWUPS entry queued).
--
-- Sizing audit (prod, 2026-04-21):
--   daily_piece_audio: 32 rows
--     2026-04-17: 8 beats (home-shopping-network / QVC piece)
--     2026-04-18: 6 beats (Hormuz ceasefire piece)
--     2026-04-19: 6 beats (airline jet fuel piece)
--     2026-04-20: 6 beats (Hormuz shipping piece)
--     2026-04-21: 6 beats (tariff refunds piece)
--
-- Every existing row's `date` has a unique daily_pieces.id match at
-- 2026-04-21 (5 pieces, 1 per date). Multi-piece-per-date does not
-- exist yet — this backfill runs while the 1:1 mapping still holds.

-- ══════════════════════════════════════════════════════════════════
-- AUTO-APPLIED — runs on `wrangler d1 migrations apply`
-- ══════════════════════════════════════════════════════════════════

-- ─── Step 1: Snapshot (free rollback while verifying the recreate) ─
CREATE TABLE IF NOT EXISTS daily_piece_audio_backup_20260421 AS
  SELECT * FROM daily_piece_audio;

-- ─── Step 2: New table with (piece_id, beat_name) PK ───────────────
-- `date` kept as a non-PK column for display/filter queries. Every
-- other column preserved verbatim from migration 0010's table shape.
CREATE TABLE IF NOT EXISTS daily_piece_audio_new (
  piece_id          TEXT NOT NULL,
  beat_name         TEXT NOT NULL,
  date              TEXT NOT NULL,
  r2_key            TEXT NOT NULL,
  public_url        TEXT NOT NULL,
  character_count   INTEGER NOT NULL,
  duration_seconds  INTEGER,
  request_id        TEXT,
  model             TEXT NOT NULL,
  voice_id          TEXT NOT NULL,
  generated_at      INTEGER NOT NULL,
  PRIMARY KEY (piece_id, beat_name)
);

-- ─── Step 3: Copy with piece_id joined from daily_pieces.date ──────
-- The correlated SELECT is used in the INSERT's source SELECT list
-- (not WHERE/ORDER BY), which D1 supports — different shape from the
-- migration 0012 limitation. If any row's date has no matching
-- daily_pieces.id, the SELECT returns NULL and the INSERT fails on
-- the piece_id NOT NULL constraint — a safety net by design.
INSERT INTO daily_piece_audio_new (
  piece_id, beat_name, date, r2_key, public_url, character_count,
  duration_seconds, request_id, model, voice_id, generated_at
)
SELECT
  (SELECT id FROM daily_pieces WHERE daily_pieces.date = a.date LIMIT 1),
  a.beat_name, a.date, a.r2_key, a.public_url, a.character_count,
  a.duration_seconds, a.request_id, a.model, a.voice_id, a.generated_at
FROM daily_piece_audio a;

-- ─── Step 4: Drop old table ────────────────────────────────────────
DROP TABLE daily_piece_audio;

-- ─── Step 5: Rename new to canonical name ──────────────────────────
ALTER TABLE daily_piece_audio_new RENAME TO daily_piece_audio;

-- ─── Step 6: Recreate indexes ──────────────────────────────────────
-- Old table had idx_piece_audio_date only; keep it for date-scoped
-- queries + add idx_piece_audio_piece for piece_id-scoped ones.
CREATE INDEX IF NOT EXISTS idx_piece_audio_date  ON daily_piece_audio(date);
CREATE INDEX IF NOT EXISTS idx_piece_audio_piece ON daily_piece_audio(piece_id);

-- ══════════════════════════════════════════════════════════════════
-- POST-APPLY VERIFY (run via `wrangler d1 execute --remote`)
-- ══════════════════════════════════════════════════════════════════
--
-- Row count + piece_id distribution:
-- SELECT piece_id, COUNT(*) AS beats FROM daily_piece_audio
-- GROUP BY piece_id ORDER BY piece_id;
-- -- expect 5 piece_id groups summing to 32: one of these is 8 (QVC),
-- -- four are 6.
--
-- No orphans:
-- SELECT COUNT(*) FROM daily_piece_audio WHERE piece_id IS NULL;
-- -- expect 0
--
-- Cross-check row count vs snapshot:
-- SELECT (SELECT COUNT(*) FROM daily_piece_audio) AS live,
--        (SELECT COUNT(*) FROM daily_piece_audio_backup_20260421) AS snap;
-- -- expect 32, 32
--
-- Foreign join works:
-- SELECT dp.date, dp.headline, dpa.beat_name, dpa.character_count
-- FROM daily_piece_audio dpa
-- JOIN daily_pieces dp ON dp.id = dpa.piece_id
-- ORDER BY dp.date, dpa.beat_name LIMIT 5;
-- -- expect 5 rows joining cleanly.
--
-- New PK enforced:
-- PRAGMA index_list(daily_piece_audio);
-- -- expect a unique index with origin='pk' on (piece_id, beat_name).
--
-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK (only if row count or shape looks wrong post-apply)
-- ══════════════════════════════════════════════════════════════════
--
-- The snapshot holds the old shape (composite PK (date, beat_name)
-- preserved implicitly via SELECT * — though SQLite's CREATE TABLE AS
-- does NOT carry the PK definition, only the data). To fully restore
-- the old shape:
--
--   DROP TABLE daily_piece_audio;
--   CREATE TABLE daily_piece_audio (
--     date TEXT NOT NULL, beat_name TEXT NOT NULL, r2_key TEXT NOT NULL,
--     public_url TEXT NOT NULL, character_count INTEGER NOT NULL,
--     duration_seconds INTEGER, request_id TEXT, model TEXT NOT NULL,
--     voice_id TEXT NOT NULL, generated_at INTEGER NOT NULL,
--     PRIMARY KEY (date, beat_name)
--   );
--   INSERT INTO daily_piece_audio SELECT
--     date, beat_name, r2_key, public_url, character_count,
--     duration_seconds, request_id, model, voice_id, generated_at
--   FROM daily_piece_audio_backup_20260421;
--   CREATE INDEX IF NOT EXISTS idx_piece_audio_date ON daily_piece_audio(date);
--
-- Retention: snapshot dropped on or after 2026-04-28 per FOLLOWUPS
-- once Phase 3 has been live a week.
