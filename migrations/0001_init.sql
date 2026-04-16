-- Zeemish v2 — Initial schema
-- Reader-side tables for accounts and progress

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS progress (
  user_id TEXT NOT NULL,
  course_slug TEXT NOT NULL,
  lesson_number INTEGER NOT NULL,
  current_beat TEXT,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, course_slug, lesson_number),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  course_slug TEXT NOT NULL,
  lesson_number INTEGER NOT NULL,
  practice_type TEXT,
  data TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS zita_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  course_slug TEXT NOT NULL,
  lesson_number INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_progress_user ON progress(user_id);
CREATE INDEX IF NOT EXISTS idx_progress_course ON progress(course_slug);
CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_zita_user ON zita_messages(user_id);
