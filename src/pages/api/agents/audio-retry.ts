import type { APIRoute } from 'astro';
import { getUser } from '../../../lib/db';

export const prerender = false;

/**
 * Proxy endpoint — admin dashboard audio retry buttons (Continue / Start
 * over / per-beat Regenerate). ADMIN_EMAIL gated. Forwards to the
 * agents worker's /audio-retry which re-runs the audio pipeline for an
 * already-published piece.
 *
 * Query params (piece identification, one required):
 *   - piece_id=<uuid>   unambiguous at multi-per-day cadence
 *   - date=YYYY-MM-DD   falls back to the latest piece on that date
 *
 * mode (optional, defaults to continue):
 *   - continue : resume; R2 head-check fills missing beats
 *   - fresh    : wipe R2 + D1 + has_audio, regenerate every beat
 *   - beat     : delete one (piece_id, beat_name) row + R2 object,
 *                regenerate just that beat; requires &beat=<kebab>
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;
  const ADMIN_EMAIL = (locals.runtime.env as Record<string, string>).ADMIN_EMAIL;

  const user = userId ? await getUser(db, userId) : null;
  if (!user?.email || user.email !== ADMIN_EMAIL) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const url = new URL(request.url);
  const pieceId = url.searchParams.get('piece_id') ?? '';
  const date = url.searchParams.get('date') ?? '';
  const hasPieceId = pieceId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pieceId);
  const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  if (!hasPieceId && !hasDate) {
    return new Response(JSON.stringify({ error: 'Missing or invalid piece_id or date' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const modeRaw = url.searchParams.get('mode');
  const mode: 'continue' | 'fresh' | 'beat' =
    modeRaw === 'fresh' || modeRaw === 'beat' ? modeRaw : 'continue';

  // Validate beat name shape on the proxy side too so we don't ship
  // garbage through to the agents worker. Kebab-case only.
  const beat = url.searchParams.get('beat') ?? '';
  if (mode === 'beat' && !/^[a-z0-9-]+$/.test(beat)) {
    return new Response(JSON.stringify({ error: 'mode=beat requires &beat=<kebab-case-name>' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ADMIN_SECRET = (locals.runtime.env as Record<string, string>).AGENTS_ADMIN_SECRET ?? '';
  const AGENTS = (locals.runtime.env as unknown as { AGENTS: { fetch: typeof fetch } }).AGENTS;

  const qs = new URLSearchParams({ mode });
  if (hasPieceId) qs.set('piece_id', pieceId);
  else qs.set('date', date);
  if (mode === 'beat') qs.set('beat', beat);

  const res = await AGENTS.fetch(`https://agents/audio-retry?${qs.toString()}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ADMIN_SECRET}` },
  });

  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
};
