import type { APIRoute } from 'astro';
import { getUser } from '../../../lib/db';

export const prerender = false;

/**
 * Proxy endpoint — admin piece-detail page's "Retry interactive"
 * button. ADMIN_EMAIL gated. Forwards to the agents worker's
 * /interactive-generate-trigger which fires the InteractiveGenerator
 * on an already-published piece.
 *
 * Shown when daily_pieces.interactive_id IS NULL — either because the
 * Generator hasn't run yet, or because a prior run failed (Auditor
 * max-fail, parse failure, GitHub commit error). Same button, same
 * action: run Generator fresh. Idempotent — if interactive_id is
 * already set the Generator short-circuits with skipped=true.
 *
 * Query params:
 *   - piece_id=<uuid>   required (no date fallback; unambiguous only)
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
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pieceId)) {
    return new Response(JSON.stringify({ error: 'Missing or invalid piece_id (UUID)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ADMIN_SECRET = (locals.runtime.env as Record<string, string>).AGENTS_ADMIN_SECRET ?? '';
  const AGENTS = (locals.runtime.env as unknown as { AGENTS: { fetch: typeof fetch } }).AGENTS;

  const qs = new URLSearchParams({ piece_id: pieceId });
  const res = await AGENTS.fetch(`https://agents/interactive-generate-trigger?${qs.toString()}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ADMIN_SECRET}` },
  });

  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
};
