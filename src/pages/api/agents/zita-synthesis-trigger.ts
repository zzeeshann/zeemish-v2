import type { APIRoute } from 'astro';
import { getUser } from '../../../lib/db';

export const prerender = false;

/**
 * Proxy endpoint — admin dashboard "Run Zita synthesis" button.
 * ADMIN_EMAIL gated. Forwards to agents worker's
 * /zita-synthesis-trigger which runs P1.5's reader-question pattern
 * synthesis against a specific piece without waiting for the natural
 * 01:45 UTC day+1 alarm. Learner's ≥5 user-message guard still
 * applies — under-threshold pieces log a skip event and fire zero
 * Claude cost.
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

  const ADMIN_SECRET = (locals.runtime.env as Record<string, string>).AGENTS_ADMIN_SECRET ?? '';
  const AGENTS = (locals.runtime.env as unknown as { AGENTS: { fetch: typeof fetch } }).AGENTS;

  const res = await AGENTS.fetch(`https://agents/zita-synthesis-trigger?date=${date}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ADMIN_SECRET}` },
  });

  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
};
