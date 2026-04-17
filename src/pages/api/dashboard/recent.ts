import type { APIRoute } from 'astro';

export const prerender = false;

/** Last 7 published pieces — public, no auth */
export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.DB;

  try {
    // Archive view — exclude low-quality pieces (see docs/DECISIONS.md
    // 2026-04-17 "Publish-anyway"). The /daily/YYYY-MM-DD/ page still
    // renders them so the day isn't blank.
    const pieces = await db
      .prepare('SELECT date, headline, underlying_subject, word_count, beat_count FROM daily_pieces WHERE quality_flag IS NULL ORDER BY date DESC LIMIT 7')
      .all();

    return new Response(JSON.stringify({ pieces: pieces.results }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ pieces: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
