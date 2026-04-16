-- Engagement metrics (aggregated per lesson per day)
CREATE TABLE IF NOT EXISTS engagement (
  lesson_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  date TEXT NOT NULL,
  views INTEGER DEFAULT 0,
  completions INTEGER DEFAULT 0,
  avg_time_seconds INTEGER,
  drop_off_beat TEXT,
  audio_plays INTEGER DEFAULT 0,
  PRIMARY KEY (lesson_id, course_id, date)
);

-- Cross-agent learnings
CREATE TABLE IF NOT EXISTS learnings (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  observation TEXT NOT NULL,
  evidence TEXT,
  confidence INTEGER,
  applied_to_prompts INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_validated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_engagement_course ON engagement(course_id);
CREATE INDEX IF NOT EXISTS idx_engagement_date ON engagement(date);
CREATE INDEX IF NOT EXISTS idx_learnings_category ON learnings(category);
