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
 *
 * Defensive: rejects null/empty/non-string source at runtime. TS strict
 * catches this at compile time in the current callers, but a future
 * regression (new caller forgetting the arg, a dropped `source`
 * column, a refactor that widens the type) could let a null leak in.
 * Rather than silently writing an unsourced row that would then show
 * up as "unspecified (pre-P1.3)" in every subsequent read, log a warn
 * to observer_events and skip the write. Loud schema regression is
 * easier to notice than a quiet null row polluting the feed.
 */
export async function writeLearning(
  db: D1Database,
  category: 'voice' | 'structure' | 'engagement' | 'fact',
  observation: string,
  evidence: Record<string, unknown>,
  confidence: number,
  source: LearningSource,
): Promise<void> {
  if (typeof source !== 'string' || source.length === 0) {
    await logSourceRegression(db, { category, observation, receivedType: source === null ? 'null' : typeof source }).catch(() => {
      /* if observer write fails, there's no layer below to fall through to — caller already got a silent skip, which is the best we can do */
    });
    return;
  }

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
 * Write directly to observer_events — mirrors ObserverAgent.writeEvent's
 * INSERT so this module stays dependency-free (no sub-agent hop,
 * which would be a circular pull back through Env typings). Only fires
 * when writeLearning's defensive check trips. Severity is `warn`, not
 * `escalation` — the pipeline is still running, we just lost one row.
 */
async function logSourceRegression(
  db: D1Database,
  ctx: { category: string; observation: string; receivedType: string },
): Promise<void> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO observer_events (id, severity, title, body, context, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      'warn',
      'learnings.source missing at write time',
      `writeLearning refused a row because source was ${ctx.receivedType}. Row skipped to avoid null-source regression. Category: ${ctx.category}. Observation (truncated): ${ctx.observation.slice(0, 200)}`,
      JSON.stringify(ctx),
      Date.now(),
    )
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
