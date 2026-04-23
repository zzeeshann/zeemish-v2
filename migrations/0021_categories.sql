-- 0021_categories.sql
--
-- Area 2, sub-task 2.1 — categoriser schema foundation.
--
-- Introduces the 14th agent's data surface. Categoriser is a new
-- post-publish agent (see sub-task 2.2) that assigns 1–3 categories
-- to every piece, strongly biased toward reusing an existing
-- category rather than creating new ones. This migration is pure
-- plumbing — no writer, no reader touches these tables yet.
--
-- Two new tables, no touches to existing tables. Additive only.
-- Rollback = DROP TABLE piece_categories; DROP TABLE categories;
-- — both tables are empty at migration time (Categoriser + seed
-- script land in 2.2 + 2.3 after this has been verified).
--
-- SHAPE DECISIONS (recorded in DECISIONS 2026-04-23 "Area 2 sub-task
-- 2.1 — categories + piece_categories schema"):
--
-- 1. `piece_count` is denormalised on `categories`. The library's
--    category chips render sorted by piece count on every page load
--    (sub-task 2.4); a correlated COUNT join on every render would
--    be ugly at scale, and the write path (Categoriser insert +
--    admin merge/delete) is low-frequency. Maintained by the write
--    path. Admin page (sub-task 2.5) gets a "Recount" action as the
--    escape hatch if it drifts.
--
-- 2. `slug` is stored, not derived. Rename changes `name`; slug
--    only changes if the operator explicitly edits it (or on merge,
--    where the target category's slug wins). Keeps library URLs
--    stable across renames.
--
-- 3. `locked` as INTEGER (0/1) consistent with `has_audio`,
--    `has_interactive`, `passed`, `applied_to_prompts`. SQLite has
--    no boolean type. Semantic: Categoriser MUST NOT reassign away
--    from a locked category. Can still assign TO it. Enforced in
--    agent logic, not schema (see sub-task 2.2).
--
-- 4. No CHECK on `confidence` or `locked`. Consistent with
--    `learnings.confidence`, `audit_results.score`, `has_audio`.
--    Application layer clamps/validates.
--
-- 5. No FK REFERENCES declared on `piece_categories.piece_id` /
--    `category_id`. Consistent with every other join column across
--    this codebase's 20 prior migrations (daily_piece_audio.piece_id,
--    pipeline_log.piece_id, audit_results.piece_id, …). Application
--    layer owns integrity; admin delete path is gated on
--    piece_count=0 so orphans don't arise.
--
-- 6. Composite PK `(piece_id, category_id)` on piece_categories
--    gives idempotency — Categoriser can be safely re-run over a
--    piece, and the pre-insert guard on sub-task 2.2 is a
--    correctness layer on top of this safety net.

-- ══════════════════════════════════════════════════════════════════
-- AUTO-APPLIED (runs on `wrangler d1 migrations apply`)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS categories (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT,
  locked       INTEGER NOT NULL DEFAULT 0,
  piece_count  INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
CREATE INDEX IF NOT EXISTS idx_categories_piece_count ON categories(piece_count DESC);

CREATE TABLE IF NOT EXISTS piece_categories (
  piece_id     TEXT NOT NULL,
  category_id  TEXT NOT NULL,
  confidence   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (piece_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_piece_categories_piece ON piece_categories(piece_id);
CREATE INDEX IF NOT EXISTS idx_piece_categories_category ON piece_categories(category_id);

-- ══════════════════════════════════════════════════════════════════
-- POST-APPLY VERIFY (run via `wrangler d1 execute --remote`)
-- ══════════════════════════════════════════════════════════════════
--
-- PRAGMA table_info(categories);
-- -- expect 8 columns:
-- --   id (TEXT PK), slug (TEXT NOT NULL, UNIQUE), name (TEXT NOT NULL),
-- --   description (TEXT), locked (INTEGER NOT NULL DEFAULT 0),
-- --   piece_count (INTEGER NOT NULL DEFAULT 0),
-- --   created_at (INTEGER NOT NULL), updated_at (INTEGER NOT NULL)
--
-- PRAGMA table_info(piece_categories);
-- -- expect 4 columns:
-- --   piece_id (TEXT NOT NULL, PK part), category_id (TEXT NOT NULL, PK part),
-- --   confidence (INTEGER NOT NULL), created_at (INTEGER NOT NULL)
--
-- PRAGMA index_list(categories);
-- -- expect idx_categories_slug, idx_categories_piece_count,
-- --        sqlite_autoindex_categories_1 (from UNIQUE)
--
-- PRAGMA index_list(piece_categories);
-- -- expect idx_piece_categories_piece, idx_piece_categories_category,
-- --        sqlite_autoindex_piece_categories_1 (from composite PK)
--
-- SELECT COUNT(*) FROM categories;         -- expect 0 (empty at migration time)
-- SELECT COUNT(*) FROM piece_categories;   -- expect 0 (empty at migration time)
