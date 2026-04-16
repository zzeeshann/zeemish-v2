import type { APIRoute } from 'astro';
import { getUser } from '../../../lib/db';

export const prerender = false;

/**
 * Proxy endpoint for triggering agent lessons.
 * Only authenticated users with email can trigger.
 * Adds the ADMIN_SECRET server-side so it never reaches the browser.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;

  // Auth check
  const user = userId ? await getUser(db, userId) : null;
  if (!user?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const body = await request.json();
  const { course, lesson } = body;

  if (!course || !lesson) {
    return new Response(JSON.stringify({ error: 'Missing course or lesson' }), { status: 400 });
  }

  const AGENTS_URL = 'https://zeemish-agents.zzeeshann.workers.dev';
  const ADMIN_SECRET = (locals.runtime.env as Record<string, string>).AGENTS_ADMIN_SECRET ?? '';

  const res = await fetch(`${AGENTS_URL}/trigger?course=${course}&lesson=${lesson}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ADMIN_SECRET}` },
  });

  const data = await res.text();
  return new Response(data, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
};
