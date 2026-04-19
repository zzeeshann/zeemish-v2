import type { Env } from '../types';

export interface Learning {
  id: string;
  category: string;
  observation: string;
  evidence: string;
  confidence: number;
  applied_to_prompts: number;
  created_at: number;
}

/**
 * Write a learning to the D1 learnings table.
 * Called by agents when they notice recurring patterns.
 */
export async function writeLearning(
  db: D1Database,
  category: 'voice' | 'structure' | 'engagement' | 'fact',
  observation: string,
  evidence: Record<string, unknown>,
  confidence: number,
): Promise<void> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO learnings (id, category, observation, evidence, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, category, observation, JSON.stringify(evidence), confidence, Date.now())
    .run();
}

/**
 * Read recent learnings across all categories.
 *
 * Drafter calls this at runtime to include recent learnings in its
 * prompt — closing the loop that was previously write-only. No
 * category filter: producer-side, self-reflection, reader-behaviour,
 * and Zita learnings all compound into the same feed the Drafter sees.
 *
 * Recency-only for v1 — relevance scoring, tag-matching, and
 * category-specific queries are intentionally deferred. If a caller
 * ever needs to slice by category again, add a separate function
 * rather than re-introducing the optional-param overload.
 */
export async function getRecentLearnings(
  db: D1Database,
  limit = 10,
): Promise<Learning[]> {
  const result = await db
    .prepare('SELECT * FROM learnings ORDER BY created_at DESC LIMIT ?')
    .bind(limit)
    .all<Learning>();
  return result.results;
}

/**
 * Get all learnings not yet applied to prompts.
 * Used by Director when reviewing patterns for prompt improvements.
 */
export async function getUnappliedLearnings(
  db: D1Database,
): Promise<Learning[]> {
  const result = await db
    .prepare('SELECT * FROM learnings WHERE applied_to_prompts = 0 ORDER BY confidence DESC')
    .all<Learning>();
  return result.results;
}
