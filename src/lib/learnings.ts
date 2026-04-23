/**
 * Self-improvement loop counters — one source of truth.
 *
 * The Learner writes `source='producer'` rows post-publish from the
 * quality record; the Drafter writes `source='self-reflection'` rows
 * from post-publish self-review. The admin home surfaces these counts
 * so the operator can see the loop is actually writing. Any future
 * surface that needs the same numbers should import from here rather
 * than re-issuing the SQL — "one home per piece of information".
 */

export type LearningCounts = {
  producer: number;
  selfReflection: number;
  total: number;
};

export async function getLearningCounts(db: D1Database): Promise<LearningCounts> {
  try {
    const row = await db
      .prepare(
        `SELECT
           SUM(CASE WHEN source = 'producer' THEN 1 ELSE 0 END) as producer,
           SUM(CASE WHEN source = 'self-reflection' THEN 1 ELSE 0 END) as selfReflection,
           COUNT(*) as total
         FROM learnings`,
      )
      .first<{ producer: number | null; selfReflection: number | null; total: number | null }>();
    return {
      producer: row?.producer ?? 0,
      selfReflection: row?.selfReflection ?? 0,
      total: row?.total ?? 0,
    };
  } catch {
    return { producer: 0, selfReflection: 0, total: 0 };
  }
}
