import type { APIRoute } from 'astro';
import { checkRateLimit } from '../../../lib/rate-limit';

export const prerender = false;

const ZITA_SYSTEM_PROMPT = `You are Zita, a learning guide inside Zeemish. You help readers think through what they're learning — you don't lecture.

## Your core rules

1. **Ask before telling.** When a reader asks a question, your first response should almost always be a question back. "What do you think happens when..." or "Before I answer, what's your guess?" This isn't evasion — it's how people actually learn.

2. **Scaffold, don't solve.** Give the reader a foothold, not the full answer. Point them toward the idea. Let them get there.

3. **2-4 sentences maximum.** You are not a tutor who lectures. You're a guide who nudges. If your response is longer than 4 sentences, you're doing it wrong.

4. **You know what they've been reading.** Use the lesson context to make your responses specific. Don't give generic answers — reference what they just learned.

5. **Plain English.** Same voice rules as Zeemish: no jargon, no tribe words, no flattery. Direct. Kind. Short.

6. **It's OK to say "I don't know."** You're not omniscient. If something is outside the lesson scope, say so honestly. Don't make things up.

7. **Never congratulate.** Don't say "Great question!" or "That's a wonderful insight!" Just respond to what they said.

8. **End with a question when possible.** Keep the reader thinking. Not always — sometimes a simple answer is right. But lean toward questions.

You are the seeker. You help others seek too.`;

/**
 * Zita chat endpoint — Socratic learning guide.
 * Maintains conversation history per user per lesson in D1.
 * Uses Claude API for responses.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;

  // Rate limit: 20 messages per 15 min per user (Claude API costs money)
  const limit = await checkRateLimit(locals.runtime.env.RATE_LIMIT_KV, `zita:${userId}`, 20, 900);
  if (!limit.allowed) {
    return new Response(JSON.stringify({ error: 'Slow down — try again in a few minutes.' }), { status: 429 });
  }

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 }); }

  const { message, course_slug, lesson_number, lesson_title, lesson_context } = body;

  if (!message || !course_slug || lesson_number == null) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
  }

  // Input validation: limit message length to prevent API cost abuse
  if (typeof message !== 'string' || message.length > 2000) {
    return new Response(JSON.stringify({ error: 'Message too long (max 2000 characters)' }), { status: 400 });
  }

  // Load conversation history for this user + lesson
  const history = await db
    .prepare(
      'SELECT role, content FROM zita_messages WHERE user_id = ? AND course_slug = ? AND lesson_number = ? ORDER BY created_at',
    )
    .bind(userId, course_slug, lesson_number)
    .all<{ role: string; content: string }>();

  // Build messages array for Claude
  const messages = [
    ...history.results.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: message },
  ];

  // Build system prompt with lesson context
  const systemPrompt = `${ZITA_SYSTEM_PROMPT}

## Current lesson context
Course: ${course_slug}
Lesson ${lesson_number}: ${lesson_title ?? 'Unknown'}
${lesson_context ? `\nWhat the reader has been learning:\n${lesson_context}` : ''}`;

  // Call Claude API
  const ANTHROPIC_API_KEY = (locals.runtime.env as Record<string, string>).ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'Zita is not configured yet' }), { status: 503 });
  }

  try {
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 300, // Short responses enforced at API level
        system: systemPrompt,
        messages,
      }),
    });

    if (!claudeResponse.ok) {
      return new Response(JSON.stringify({ error: 'Zita is temporarily unavailable. Try again later.' }), { status: 503 });
    }

    const data = await claudeResponse.json() as {
      content: Array<{ type: string; text: string }>;
    };
    const reply = data.content[0]?.type === 'text' ? data.content[0].text : '';

    // Save both messages to history
    const now = Date.now();
    await db.batch([
      db.prepare(
        'INSERT INTO zita_messages (id, user_id, course_slug, lesson_number, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), userId, course_slug, lesson_number, 'user', message, now),
      db.prepare(
        'INSERT INTO zita_messages (id, user_id, course_slug, lesson_number, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), userId, course_slug, lesson_number, 'assistant', reply, now + 1),
    ]);

    return new Response(JSON.stringify({ reply }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
};
