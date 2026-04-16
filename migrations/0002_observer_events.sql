-- Observer events — what Zishan should know about
CREATE TABLE IF NOT EXISTS observer_events (
  id TEXT PRIMARY KEY,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  context TEXT,
  acknowledged_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Agent tasks table (used by Director for logging)
CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY,
  parent_task_id TEXT,
  agent_name TEXT NOT NULL,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL,
  input TEXT NOT NULL,
  output TEXT,
  error TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_observer_severity ON observer_events(severity);
CREATE INDEX IF NOT EXISTS idx_observer_created ON observer_events(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON agent_tasks(status);
