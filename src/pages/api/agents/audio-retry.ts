import type { APIRoute } from 'astro';
import { getUser } from '../../../lib/db';

export const prerender = false;

/**
 * Proxy endpoint — admin dashboard "Retry audio" button.
 * ADMIN_EMAIL gated. Forwards to agents worker's /audio-retry which
 * re-runs the audio pipeline for an already-published piece.
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
  const date = url.searchParams.get('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(JSON.stringify({ error: 'Missing or invalid date' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  // mode=continue (default): resume where prior attempt stopped, skip
  // already-generated clips. mode=fresh: wipe existing audio state
  // first, then regenerate everything. Admin's "Start over" button
  // passes mode=fresh after a confirm() dialog.
  const mode = url.searchParams.get('mode') === 'fresh' ? 'fresh' : 'continue';

  const ADMIN_SECRET = (locals.runtime.env as Record<string, string>).AGENTS_ADMIN_SECRET ?? '';
  const AGENTS = (locals.runtime.env as unknown as { AGENTS: { fetch: typeof fetch } }).AGENTS;

  const res = await AGENTS.fetch(`https://agents/audio-retry?date=${date}&mode=${mode}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ADMIN_SECRET}` },
  });

  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
};
