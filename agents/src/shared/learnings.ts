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
 * Read recent learnings for a category.
 * Used by Drafter to include "what has worked lately" in prompts.
 */
export async function getRecentLearnings(
  db: D1Database,
  category: string,
  limit = 10,
): Promise<Learning[]> {
  const result = await db
    .prepare(
      'SELECT * FROM learnings WHERE category = ? ORDER BY created_at DESC LIMIT ?',
    )
    .bind(category, limit)
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
