import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * Track engagement events (view, beat completion, drop-off).
 * Called from the lesson-shell Web Component as readers navigate.
 * Aggregates per lesson per day.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB;

  const body = await request.json();
  const { course_id, lesson_id, event_type, beat } = body;

  if (!course_id || !lesson_id || !event_type) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  try {
    if (event_type === 'view') {
      await db
        .prepare(
          `INSERT INTO engagement (lesson_id, course_id, date, views)
           VALUES (?, ?, ?, 1)
           ON CONFLICT (lesson_id, course_id, date)
           DO UPDATE SET views = views + 1`,
        )
        .bind(lesson_id, course_id, today)
        .run();
    } else if (event_type === 'complete') {
      await db
        .prepare(
          `INSERT INTO engagement (lesson_id, course_id, date, completions)
           VALUES (?, ?, ?, 1)
           ON CONFLICT (lesson_id, course_id, date)
           DO UPDATE SET completions = completions + 1`,
        )
        .bind(lesson_id, course_id, today)
        .run();
    } else if (event_type === 'drop_off' && beat) {
      await db
        .prepare(
          `INSERT INTO engagement (lesson_id, course_id, date, drop_off_beat)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (lesson_id, course_id, date)
           DO UPDATE SET drop_off_beat = ?`,
        )
        .bind(lesson_id, course_id, today, beat, beat)
        .run();
    } else if (event_type === 'audio_play') {
      await db
        .prepare(
          `INSERT INTO engagement (lesson_id, course_id, date, audio_plays)
           VALUES (?, ?, ?, 1)
           ON CONFLICT (lesson_id, course_id, date)
           DO UPDATE SET audio_plays = audio_plays + 1`,
        )
        .bind(lesson_id, course_id, today)
        .run();
    }
  } catch {
    // Engagement tracking should never break the reader experience
  }

  return new Response(JSON.stringify({ status: 'tracked' }), { status: 200 });
};
