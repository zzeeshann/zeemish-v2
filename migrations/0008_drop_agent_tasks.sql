-- Clean up course-era legacy tables.
--
-- agent_tasks was defined in 0002_observer_events.sql alongside the
-- observer_events table (odd coupling, but history is immutable). No
-- code in either worker ever wrote to agent_tasks — it's a leftover
-- from the course-based content model that was replaced by
-- news-driven daily pieces (see docs/DECISIONS.md).
--
-- audit_results has a FOREIGN KEY constraint pointing at
-- agent_tasks(id) from 0004. Because agent_tasks was never populated,
-- every INSERT into audit_results silently failed the FK check and
-- Director's try/catch swallowed the error. Result: zero rows in
-- audit_results across all historical runs, and the site dashboard
-- (stats.ts / today.ts) quietly shows empty audit data.
--
-- Fix: drop agent_tasks entirely, drop and recreate audit_results
-- without the FK. Safe to drop audit_results because it is empty.

DROP INDEX IF EXISTS idx_tasks_parent;
DROP INDEX IF EXISTS idx_tasks_status;
DROP TABLE IF EXISTS agent_tasks;

DROP TABLE IF EXISTS audit_results;

CREATE TABLE audit_results (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  auditor TEXT NOT NULL,
  passed INTEGER NOT NULL,
  score INTEGER,
  notes TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_task ON audit_results(task_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_results(created_at);
