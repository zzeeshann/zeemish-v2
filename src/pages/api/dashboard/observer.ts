import type { APIRoute } from 'astro';
import { getUser } from '../../../lib/db';

export const prerender = false;

/** Observer events — ADMIN ONLY */
export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;
  const ADMIN_EMAIL = (locals.runtime.env as Record<string, string>).ADMIN_EMAIL;

  const user = userId ? await getUser(db, userId) : null;
  if (!user?.email || user.email !== ADMIN_EMAIL) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const events = await db
      .prepare('SELECT * FROM observer_events ORDER BY created_at DESC LIMIT 50')
      .all();

    return new Response(JSON.stringify({ events: events.results }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ events: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

/** Acknowledge an event — ADMIN ONLY */
export const POST: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;
  const ADMIN_EMAIL = (locals.runtime.env as Record<string, string>).ADMIN_EMAIL;

  const user = userId ? await getUser(db, userId) : null;
  if (!user?.email || user.email !== ADMIN_EMAIL) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 }); }

  const { eventId } = body;
  if (!eventId) {
    return new Response(JSON.stringify({ error: 'Missing eventId' }), { status: 400 });
  }

  await db
    .prepare('UPDATE observer_events SET acknowledged_at = ? WHERE id = ?')
    .bind(Date.now(), eventId)
    .run();

  return new Response(JSON.stringify({ status: 'acknowledged' }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
