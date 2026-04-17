import type { APIRoute } from 'astro';

export const prerender = false;

/** Library counters — public, no auth */
export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.DB;

  try {
    // All counters reflect the *archived* catalogue — low-quality pieces
    // (audit failed after max revisions) are excluded so public stats
    // advertise the clean library, not the raw publish count.
    const countResult = await db
      .prepare('SELECT COUNT(*) as total FROM daily_pieces WHERE quality_flag IS NULL')
      .first<{ total: number }>();

    const avgVoice = await db
      .prepare('SELECT AVG(score) as avg_score FROM audit_results WHERE auditor = ? AND passed = 1')
      .bind('voice')
      .first<{ avg_score: number | null }>();

    const subjects = await db
      .prepare('SELECT DISTINCT underlying_subject FROM daily_pieces WHERE underlying_subject IS NOT NULL AND quality_flag IS NULL')
      .all<{ underlying_subject: string }>();

    const firstPiece = await db
      .prepare('SELECT date FROM daily_pieces WHERE quality_flag IS NULL ORDER BY date ASC LIMIT 1')
      .first<{ date: string }>();

    return new Response(JSON.stringify({
      totalPieces: countResult?.total ?? 0,
      avgVoiceScore: avgVoice?.avg_score ? Math.round(avgVoice.avg_score) : null,
      subjects: subjects.results.map((s) => s.underlying_subject),
      runningSince: firstPiece?.date ?? null,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response(JSON.stringify({ totalPieces: 0, avgVoiceScore: null, subjects: [], runningSince: null }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
