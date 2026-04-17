import type { APIRoute } from 'astro';

export const prerender = false;

/** Today's pipeline status — public, no auth */
export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.DB;
  const today = new Date().toISOString().slice(0, 10);

  try {
    // Get today's piece
    const piece = await db
      .prepare('SELECT * FROM daily_pieces WHERE date = ? LIMIT 1')
      .bind(today)
      .first();

    // Get audit results for today
    const audits = piece
      ? await db
          .prepare("SELECT auditor, passed, score FROM audit_results WHERE task_id LIKE ? ORDER BY created_at DESC")
          .bind(`daily/${today}%`)
          .all()
      : { results: [] };

    const voiceAudit = audits.results.find((a: any) => a.auditor === 'voice');
    const factAudit = audits.results.find((a: any) => a.auditor === 'fact');
    const structAudit = audits.results.find((a: any) => a.auditor === 'structure');

    return new Response(JSON.stringify({
      date: today,
      published: !!piece,
      piece: piece ? {
        headline: (piece as any).headline,
        underlyingSubject: (piece as any).underlying_subject,
        wordCount: (piece as any).word_count,
        beatCount: (piece as any).beat_count,
        // Exposed so the dashboard can badge low-quality publishes.
        // Null for normal, 'low' when gates failed after max revisions.
        qualityFlag: (piece as any).quality_flag ?? null,
      } : null,
      scores: {
        voice: voiceAudit ? { score: (voiceAudit as any).score, passed: !!(voiceAudit as any).passed } : null,
        facts: factAudit ? { passed: !!(factAudit as any).passed } : null,
        structure: structAudit ? { passed: !!(structAudit as any).passed } : null,
      },
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response(JSON.stringify({ date: today, published: false, piece: null, scores: {} }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
