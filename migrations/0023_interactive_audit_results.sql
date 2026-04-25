-- 0023_interactive_audit_results.sql
--
-- Per-round per-dimension audit output for interactives.
--
-- Closes the deferred FOLLOWUPS 2026-04-24 sub-task 4.1 entry. With
-- ship-as-low active (the 2026-04-24 reversal), the `interactives`
-- row only knows IF the auditor max-failed (`quality_flag='low'`),
-- not WHICH dimension failed or whether things improved across
-- rounds. The "How this was made" drawer for both shipped-low quizzes
-- (FISA + Maine, 2026-04-24 + 2026-04-25) had to fall back to generic
-- copy because the failed-dimension data only exists in the
-- `logInteractiveGeneratorMetered` observer event's JSON `context`,
-- and reading observer-event JSON from the reader path would couple
-- the drawer to event-shape — fragile.
--
-- This table mirrors the `audit_results` shape for daily pieces:
-- one row per round × dimension. Voice carries a 0–100 score; the
-- three binary dimensions (structure / essence / factual) leave
-- score NULL. `notes` is a JSON-stringified array of the auditor's
-- per-dimension `violations` / `issues` / `suggestions` strings —
-- same shape `audit_results.notes` carries today.
--
-- SHAPE DECISIONS:
--
-- 1. Keyed by `interactive_id`, not slug. The interactives row's
--    UUID never collides; slugs do (sub-task 4.4 has a `-2`/`-3`
--    suffix collision-resolution path). Joining by id is stable
--    against a future slug rename.
--
-- 2. `dimension TEXT` not enum. Consistent with `audit_results.auditor`,
--    `observer_events.severity`, `learnings.source`. First values
--    are the four current dimensions; if Auditor ever splits or
--    folds dimensions, no migration churn.
--
-- 3. `passed INTEGER` 0/1 not BOOLEAN — SQLite has no real boolean
--    type and every other table in this codebase uses 0/1 INTEGER.
--
-- 4. No FK REFERENCES. Consistent with every other join column in
--    this codebase. Application-layer integrity. Orphan rows from
--    a generator that pre-allocates `interactiveId` then fails
--    (declined / infrastructure error) are acceptable — same
--    pattern `audit_results` already has with orphan piece_ids
--    from the day-keyed era.
--
-- 5. Empty at migration time. No backfill. The two existing
--    `quality_flag='low'` rows (FISA + Maine) can't be reconstructed
--    without re-running the auditor — final-round data is observable
--    via observer_events for forensic context, which is enough for
--    historical diagnosis.
--
-- 6. Composite index on `(interactive_id, round)` covers both the
--    common reader query (latest-round failed dimensions for one
--    interactive) and the future admin per-interactive timeline
--    view. SQLite uses leftmost-prefix matching, so a single
--    interactive_id lookup also benefits.
--
-- Rollback: DROP TABLE interactive_audit_results; (table is empty
-- at migration time).

-- ══════════════════════════════════════════════════════════════════
-- AUTO-APPLIED (runs on `wrangler d1 migrations apply`)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS interactive_audit_results (
  id              TEXT PRIMARY KEY,
  interactive_id  TEXT NOT NULL,
  round           INTEGER NOT NULL,
  dimension       TEXT NOT NULL,    -- 'voice' | 'structure' | 'essence' | 'factual'
  passed          INTEGER NOT NULL, -- 0 | 1
  score           INTEGER,          -- voice only; NULL for binary dimensions
  notes           TEXT,             -- JSON-stringified array of issue strings
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_int_audit_interactive_round
  ON interactive_audit_results(interactive_id, round);

-- ══════════════════════════════════════════════════════════════════
-- POST-APPLY VERIFY (run via `wrangler d1 execute --remote`)
-- ══════════════════════════════════════════════════════════════════
--
-- PRAGMA table_info(interactive_audit_results);
-- -- expect 8 columns:
-- --   id (TEXT PK), interactive_id (TEXT NOT NULL),
-- --   round (INTEGER NOT NULL), dimension (TEXT NOT NULL),
-- --   passed (INTEGER NOT NULL), score (INTEGER),
-- --   notes (TEXT), created_at (INTEGER NOT NULL)
--
-- PRAGMA index_list(interactive_audit_results);
-- -- expect idx_int_audit_interactive_round
--
-- SELECT COUNT(*) FROM interactive_audit_results;     -- expect 0
