import type { APIRoute } from 'astro';
import { hashPassword } from '../../../lib/auth';
import { getUser, getUserByEmail, upgradeUser } from '../../../lib/db';
import { checkRateLimit } from '../../../lib/rate-limit';

export const prerender = false;

/**
 * Upgrade an anonymous user to email+password.
 * Rate limited: 5 attempts per 15 min per IP.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const limit = await checkRateLimit(locals.runtime.env.RATE_LIMIT_KV, `upgrade:${ip}`, 5, 900);
  if (!limit.allowed) {
    return new Response(JSON.stringify({ error: 'Too many attempts. Try again later.' }), { status: 429 });
  }

  const db = locals.runtime.env.DB;
  const userId = locals.userId;

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 }); }

  const { email, password } = body;

  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400 });
  }

  const normalizedEmail = email.toLowerCase().trim();

  if (password.length < 8) {
    return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), { status: 400 });
  }

  const user = await getUser(db, userId);
  if (!user) {
    return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });
  }

  if (user.email) {
    return new Response(JSON.stringify({ error: 'Account already has an email' }), { status: 409 });
  }

  // Check email isn't already taken by another user
  const existing = await getUserByEmail(db, normalizedEmail);
  if (existing) {
    return new Response(JSON.stringify({ error: 'Email already in use' }), { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  await upgradeUser(db, userId, normalizedEmail, passwordHash);

  return new Response(JSON.stringify({ status: 'upgraded' }), { status: 200 });
};
