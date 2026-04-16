-- Audit results — one row per audit pass per draft
-- Provides a durable audit trail for every lesson through the pipeline
CREATE TABLE IF NOT EXISTS audit_results (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  auditor TEXT NOT NULL,
  passed INTEGER NOT NULL,
  score INTEGER,
  notes TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES agent_tasks(id)
);

-- Missing index from architecture spec
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON agent_tasks(parent_task_id);
