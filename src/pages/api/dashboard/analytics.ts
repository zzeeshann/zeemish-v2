import type { APIRoute } from 'astro';
import { getUser } from '../../../lib/db';

export const prerender = false;

/** Engagement analytics — ADMIN ONLY */
export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;
  const ADMIN_EMAIL = (locals.runtime.env as Record<string, string>).ADMIN_EMAIL;

  // Admin check
  const user = userId ? await getUser(db, userId) : null;
  if (!user?.email || user.email !== ADMIN_EMAIL) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const engagement = await db
      .prepare('SELECT * FROM engagement ORDER BY date DESC LIMIT 30')
      .all();

    return new Response(JSON.stringify({ engagement: engagement.results }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ engagement: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
