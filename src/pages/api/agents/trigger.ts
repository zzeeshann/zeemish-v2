import type { APIRoute } from 'astro';
import { getUser } from '../../../lib/db';

export const prerender = false;

/**
 * Proxy endpoint for triggering the daily piece pipeline.
 * ADMIN_EMAIL only — not just any authenticated user.
 */
export const POST: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;
  const ADMIN_EMAIL = (locals.runtime.env as Record<string, string>).ADMIN_EMAIL;

  const user = userId ? await getUser(db, userId) : null;
  if (!user?.email || user.email !== ADMIN_EMAIL) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const ADMIN_SECRET = (locals.runtime.env as Record<string, string>).AGENTS_ADMIN_SECRET ?? '';
  // Service binding — in-process call to the agents worker.
  // HTTP fetch across workers on the same .workers.dev zone returns
  // Cloudflare error 1042. The binding avoids the public network hop.
  const AGENTS = (locals.runtime.env as unknown as { AGENTS: { fetch: typeof fetch } }).AGENTS;

  const res = await AGENTS.fetch('https://agents/daily-trigger', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ADMIN_SECRET}` },
  });

  const data = await res.text();
  return new Response(data, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
};
