import type { APIRoute } from 'astro';
import { getUser } from '../../../lib/db';

export const prerender = false;

/**
 * Proxy endpoint for triggering the daily piece pipeline.
 * Only authenticated users with ADMIN_EMAIL can trigger.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;

  const user = userId ? await getUser(db, userId) : null;
  if (!user?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const AGENTS_URL = 'https://zeemish-agents.zzeeshann.workers.dev';
  const ADMIN_SECRET = (locals.runtime.env as Record<string, string>).AGENTS_ADMIN_SECRET ?? '';

  const res = await fetch(`${AGENTS_URL}/daily-trigger`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ADMIN_SECRET}` },
  });

  const data = await res.text();
  return new Response(data, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
};
