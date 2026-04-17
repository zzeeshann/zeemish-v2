-- Daily candidates from the Scanner
CREATE TABLE IF NOT EXISTS daily_candidates (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  headline TEXT NOT NULL,
  source TEXT NOT NULL,
  category TEXT,
  summary TEXT,
  url TEXT,
  teachability_score INTEGER,
  selected INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_candidates_date ON daily_candidates(date);

-- Published daily pieces
CREATE TABLE IF NOT EXISTS daily_pieces (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  headline TEXT NOT NULL,
  underlying_subject TEXT NOT NULL,
  source_story TEXT NOT NULL,
  word_count INTEGER,
  beat_count INTEGER,
  voice_score INTEGER,
  fact_check_passed INTEGER,
  has_interactive INTEGER DEFAULT 0,
  reading_minutes INTEGER,
  published_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pieces_date ON daily_pieces(date);
CREATE INDEX IF NOT EXISTS idx_pieces_subject ON daily_pieces(underlying_subject);
