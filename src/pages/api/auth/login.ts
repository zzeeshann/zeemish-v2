import type { APIRoute } from 'astro';
import { verifyPassword, sessionCookie } from '../../../lib/auth';
import { getUserByEmail, mergeProgress } from '../../../lib/db';
import { checkRateLimit } from '../../../lib/rate-limit';

export const prerender = false;

/**
 * Login with email + password.
 * Rate limited: 5 attempts per 15 minutes per IP.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  // Rate limit by IP
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const limit = checkRateLimit(`login:${ip}`, 5, 900);
  if (!limit.allowed) {
    return new Response(JSON.stringify({ error: 'Too many login attempts. Try again later.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '900' },
    });
  }

  const db = locals.runtime.env.DB;
  const anonymousId = locals.userId;

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 }); }

  const { email, password } = body;

  if (!email || !password) {
    return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400 });
  }

  const user = await getUserByEmail(db, email);
  if (!user || !user.password_hash) {
    return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 });
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 });
  }

  // Merge anonymous progress into authenticated user
  if (anonymousId && anonymousId !== user.id) {
    await mergeProgress(db, anonymousId, user.id);
  }

  const response = new Response(JSON.stringify({ status: 'authenticated' }), {
    status: 200,
  });
  response.headers.append('Set-Cookie', sessionCookie(user.id));
  return response;
};
