import type { APIRoute } from 'astro';
import { getProgress } from '../../../lib/db';

export const prerender = false;

export const GET: APIRoute = async ({ locals, params }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;
  const courseSlug = params.course;

  if (!courseSlug) {
    return new Response(JSON.stringify({ error: 'Missing course' }), { status: 400 });
  }

  const progress = await getProgress(db, userId, courseSlug);
  return new Response(JSON.stringify({ progress }), { status: 200 });
};
