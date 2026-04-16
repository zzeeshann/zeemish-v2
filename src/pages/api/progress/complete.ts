import type { APIRoute } from 'astro';
import { completeLesson } from '../../../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;

  const body = await request.json();
  const { course_slug, lesson_number } = body;

  if (!course_slug || !lesson_number) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
  }

  await completeLesson(db, userId, course_slug, lesson_number);
  return new Response(JSON.stringify({ status: 'completed' }), { status: 200 });
};
