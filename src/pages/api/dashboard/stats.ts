import type { APIRoute } from 'astro';

export const prerender = false;

/** Library counters — public, no auth */
export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.DB;

  try {
    // Counters cover every published piece (as of 2026-04-17 soften-
    // quality pass — we no longer exclude low-quality pieces from public
    // stats). Tier is surfaced per-piece; the counters are the raw truth.
    const countResult = await db
      .prepare('SELECT COUNT(*) as total FROM daily_pieces')
      .first<{ total: number }>();

    // Read the final-round voice score per piece directly from
    // daily_pieces (Director writes lastVoiceScore here on every publish).
    // One row per piece, matches the tier each reader sees. See
    // DECISIONS.md 2026-04-17 "Avg voice from daily_pieces".
    const voiceAgg = await db
      .prepare('SELECT AVG(voice_score) as avg_score, COUNT(*) as n FROM daily_pieces WHERE voice_score IS NOT NULL')
      .first<{ avg_score: number | null; n: number }>();

    const subjects = await db
      .prepare('SELECT DISTINCT underlying_subject FROM daily_pieces WHERE underlying_subject IS NOT NULL')
      .all<{ underlying_subject: string }>();

    const firstPiece = await db
      .prepare('SELECT date FROM daily_pieces ORDER BY date ASC LIMIT 1')
      .first<{ date: string }>();

    return new Response(JSON.stringify({
      totalPieces: countResult?.total ?? 0,
      avgVoiceScore: voiceAgg?.avg_score ? Math.round(voiceAgg.avg_score) : null,
      voiceSampleSize: voiceAgg?.n ?? 0,
      subjects: subjects.results.map((s) => s.underlying_subject),
      runningSince: firstPiece?.date ?? null,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response(JSON.stringify({ totalPieces: 0, avgVoiceScore: null, voiceSampleSize: 0, subjects: [], runningSince: null }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
