-- 0022_interactives.sql
--
-- Area 4, sub-task 4.1 — interactives schema foundation.
--
-- Introduces the data surface for the 15th + 16th agents:
-- InteractiveGenerator and InteractiveAuditor (sub-tasks 4.4 + 4.5).
-- An "interactive" is a first-class, standalone-addressable teaching
-- artefact (first type: `quiz`; later: `breathing`, `game`, `chart`).
-- Each piece may generate one; each interactive is useful on its own URL
-- without reading the source piece ("essence not reference").
--
-- Two new tables + one additive column on daily_pieces. No backfill —
-- both new tables are empty at migration time; Generator populates them
-- going forward.
--
-- SHAPE DECISIONS (recorded in DECISIONS 2026-04-24 "Area 4 sub-task
-- 4.1 — interactives + interactive_engagement schema"):
--
-- 1. `interactive_id` on `daily_pieces` is the single source of truth
--    for "does this piece have an interactive" — NOT the pre-existing
--    `has_interactive` INTEGER column. `has_interactive` was scaffolded
--    in 0006 but no writer and no reader ever used it; every prod row
--    is 0. We'd be adding a dual-write risk if we kept syncing both.
--    Two sources of truth is the drift pattern we avoided with
--    `categories.piece_count` in Area 2 (where we accepted denormalisation
--    only because of a read-heavy chip sort). Here there's no read
--    pressure to justify the same compromise. `has_interactive` is
--    left physical (SQLite DROP COLUMN requires a full daily_pieces
--    rebuild with 6+ FK-referencing tables — blast radius too big for
--    hygiene) but is now deprecated: no writer touches it going forward,
--    no reader queries it (SCHEMA.md marks it as deprecated + the lone
--    type declaration in [slug].astro is removed in this same commit).
--
-- 2. `type` as loose TEXT, no CHECK. Consistent with
--    `observer_events.severity`, `learnings.source`, `learnings.category`.
--    First value is `'quiz'`; adding `'breathing'` / `'game'` / `'chart'`
--    later is a zero-migration change.
--
-- 3. `content_json` kept on the row even though sub-task 4.2 may put
--    authoritative content in a git-versioned `content/interactives/`
--    collection. The column gives D1 a queryable copy for admin views
--    and debugging regardless of which path 4.2 picks. If 4.2 chooses
--    content-collection as source of truth, `content_json` is a
--    convenience mirror; if D1, it IS the source.
--
-- 4. `voice_score` + `quality_flag` mirror `daily_pieces` exactly.
--    quality_flag='low' means the auditor max-failed (3 revision rounds)
--    but we shipped anyway (analogous to Director's ship-anyway on
--    low-voice pieces — newspaper never skips a day). Readers can still
--    reach the interactive at its URL but the last-beat prompt
--    (sub-task 4.6) filters it out.
--
-- 5. `revision_count` tracks auditor rounds (0–3) but we're NOT creating
--    `interactive_audit_results` yet. FOLLOWUPS entry logged to revisit
--    when 4.5 ships or the first debugging session needs per-round notes.
--
-- 6. `interactive_engagement` is an append-only event log (not aggregated
--    per day like `engagement`). Per-question correctness arrays don't
--    aggregate cleanly, and the reader's actions (offered / started /
--    completed / skipped) are naturally event-shaped. Aggregation
--    happens at query time via GROUP BY / DISTINCT.
--
-- 7. No FK REFERENCES declared anywhere. Consistent with every other
--    join column in this codebase's 21 prior migrations. Application
--    layer owns integrity.
--
-- Rollback: DROP TABLE interactive_engagement; DROP TABLE interactives;
-- Both are empty at migration time. `daily_pieces.interactive_id`
-- stays physical (can't drop in SQLite without a table rebuild); it
-- sits nullable and inert if the code is rolled back.

-- ══════════════════════════════════════════════════════════════════
-- AUTO-APPLIED (runs on `wrangler d1 migrations apply`)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS interactives (
  id               TEXT PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  type             TEXT NOT NULL,
  title            TEXT NOT NULL,
  concept          TEXT,
  source_piece_id  TEXT,
  content_json     TEXT,
  voice_score      INTEGER,
  quality_flag     TEXT,
  revision_count   INTEGER NOT NULL DEFAULT 0,
  published_at     INTEGER,
  created_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_interactives_slug ON interactives(slug);
CREATE INDEX IF NOT EXISTS idx_interactives_source_piece ON interactives(source_piece_id);
CREATE INDEX IF NOT EXISTS idx_interactives_published_at ON interactives(published_at DESC);

CREATE TABLE IF NOT EXISTS interactive_engagement (
  id                        TEXT PRIMARY KEY,
  user_id                   TEXT NOT NULL,
  interactive_id            TEXT NOT NULL,
  event_type                TEXT NOT NULL,
  score                     INTEGER,
  per_question_correctness  TEXT,
  created_at                INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_int_engagement_user ON interactive_engagement(user_id);
CREATE INDEX IF NOT EXISTS idx_int_engagement_interactive ON interactive_engagement(interactive_id);
CREATE INDEX IF NOT EXISTS idx_int_engagement_int_type ON interactive_engagement(interactive_id, event_type);

ALTER TABLE daily_pieces ADD COLUMN interactive_id TEXT;

CREATE INDEX IF NOT EXISTS idx_daily_pieces_interactive ON daily_pieces(interactive_id);

-- ══════════════════════════════════════════════════════════════════
-- POST-APPLY VERIFY (run via `wrangler d1 execute --remote`)
-- ══════════════════════════════════════════════════════════════════
--
-- PRAGMA table_info(interactives);
-- -- expect 12 columns:
-- --   id (TEXT PK), slug (TEXT NOT NULL, UNIQUE), type (TEXT NOT NULL),
-- --   title (TEXT NOT NULL), concept (TEXT), source_piece_id (TEXT),
-- --   content_json (TEXT), voice_score (INTEGER), quality_flag (TEXT),
-- --   revision_count (INTEGER NOT NULL DEFAULT 0),
-- --   published_at (INTEGER), created_at (INTEGER NOT NULL)
--
-- PRAGMA table_info(interactive_engagement);
-- -- expect 7 columns:
-- --   id (TEXT PK), user_id (TEXT NOT NULL), interactive_id (TEXT NOT NULL),
-- --   event_type (TEXT NOT NULL), score (INTEGER),
-- --   per_question_correctness (TEXT), created_at (INTEGER NOT NULL)
--
-- PRAGMA index_list(interactives);
-- -- expect idx_interactives_slug, idx_interactives_source_piece,
-- --        idx_interactives_published_at,
-- --        sqlite_autoindex_interactives_1 (from UNIQUE)
--
-- PRAGMA index_list(interactive_engagement);
-- -- expect idx_int_engagement_user, idx_int_engagement_interactive,
-- --        idx_int_engagement_int_type
--
-- PRAGMA table_info(daily_pieces);
-- -- expect the new interactive_id column at the end
--
-- SELECT COUNT(*) FROM interactives;              -- expect 0
-- SELECT COUNT(*) FROM interactive_engagement;    -- expect 0
