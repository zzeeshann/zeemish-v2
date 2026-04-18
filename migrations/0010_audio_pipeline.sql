-- 0010_audio_pipeline.sql
--
-- Un-pause the audio pipeline. Add per-beat audio rows so each
-- <lesson-beat> in a piece can play its own clip, and a fast boolean
-- on daily_pieces so dashboards can filter/sort without joining.
--
-- Why per-beat and not one MP3 per piece: future pieces will be
-- newspaper-style (12 stories across one day). Per-beat MP3s let the
-- reader jump to a specific story, and let the producer regenerate a
-- single beat on revision without re-billing the whole piece.
--
-- Why a dedicated table instead of JSON-in-frontmatter only:
--   - frontmatter is the RENDER source of truth for the site
--   - the table is the QUERY source of truth for dashboards, audits, and
--     cost tracking (sum character_count by date/model)
--   - Publisher is the only writer: after AudioProducer finishes and
--     AudioAuditor passes, Publisher splices the URLs into MDX
--     frontmatter AND flips has_audio=1 in the same second commit.
--
-- Storage shape: one row per (date, beat_name). PK composite — a beat
-- is uniquely identified by its piece's date and its own name.

CREATE TABLE IF NOT EXISTS daily_piece_audio (
  date TEXT NOT NULL,
  beat_name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  public_url TEXT NOT NULL,
  character_count INTEGER NOT NULL,
  duration_seconds INTEGER,
  request_id TEXT,
  model TEXT NOT NULL,
  voice_id TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  PRIMARY KEY (date, beat_name)
);

CREATE INDEX IF NOT EXISTS idx_piece_audio_date ON daily_piece_audio(date);

-- Fast boolean for the dashboard / admin list. Flipped to 1 by
-- PublisherAgent's second commit (publishAudio). Never set by the
-- producer or auditor — only by the agent that owns git writes.
ALTER TABLE daily_pieces ADD COLUMN has_audio INTEGER DEFAULT 0;
