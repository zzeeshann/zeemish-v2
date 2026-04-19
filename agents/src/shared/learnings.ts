import type { Env } from '../types';

/**
 * Where a learning came from. Loose at the DB level (TEXT, nullable)
 * so a future fifth origin can be added at the write site without a
 * schema change — but typed narrowly here so callers get compile-time
 * help for the four we currently know how to generate.
 */
export type LearningSource =
  | 'reader'          // reader-behaviour signal (engagement, drop-off)
  | 'producer'        // pipeline quality signal (auditors, curator, etc.)
  | 'self-reflection' // Drafter's own post-draft review
  | 'zita';           // patterns in Zita questions

export interface Learning {
  id: string;
  category: string;
  observation: string;
  evidence: string;
  confidence: number;
  applied_to_prompts: number;
  created_at: number;
  source: LearningSource | null;
}

/**
 * Write a learning to the D1 learnings table.
 * Called by agents when they notice recurring patterns.
 *
 * `source` describes the *origin* of the signal (reader / producer /
 * self-reflection / zita) and is orthogonal to `category` (voice /
 * structure / fact / engagement — *what* kind of learning it is).
 * Both matter: source tells you whether the system learned this from
 * itself or from readers; category tells you which prompt the learning
 * should inform.
 */
export async function writeLearning(
  db: D1Database,
  category: 'voice' | 'structure' | 'engagement' | 'fact',
  observation: string,
  evidence: Record<string, unknown>,
  confidence: number,
  source: LearningSource,
): Promise<void> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO learnings (id, category, observation, evidence, confidence, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, category, observation, JSON.stringify(evidence), confidence, source, Date.now())
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
