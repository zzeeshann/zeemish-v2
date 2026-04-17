import type { APIRoute } from 'astro';
import { getUser } from '../../../lib/db';

export const prerender = false;

/**
 * Proxy endpoint for triggering agent pipelines.
 * Only authenticated users with email can trigger.
 * Supports: { type: 'daily' } or { course, lesson } for course lessons.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;

  const user = userId ? await getUser(db, userId) : null;
  if (!user?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 }); }

  const AGENTS_URL = 'https://zeemish-agents.zzeeshann.workers.dev';
  const ADMIN_SECRET = (locals.runtime.env as Record<string, string>).AGENTS_ADMIN_SECRET ?? '';

  let targetUrl: string;
  if (body.type === 'daily') {
    targetUrl = `${AGENTS_URL}/daily-trigger`;
  } else if (body.course && body.lesson) {
    targetUrl = `${AGENTS_URL}/trigger?course=${body.course}&lesson=${body.lesson}`;
  } else {
    return new Response(JSON.stringify({ error: 'Missing type or course/lesson' }), { status: 400 });
  }

  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ADMIN_SECRET}` },
  });

  const data = await res.text();
  return new Response(data, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
};
