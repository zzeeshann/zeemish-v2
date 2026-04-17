-- Pipeline log — step-by-step record of each daily piece run
-- Append-only. One row per step per run. Admin dashboard polls this.
CREATE TABLE IF NOT EXISTS pipeline_log (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step TEXT NOT NULL,
  status TEXT NOT NULL,
  data TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pipeline_run ON pipeline_log(run_id);
