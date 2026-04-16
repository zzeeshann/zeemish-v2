import type { APIRoute } from 'astro';
import { hashPassword } from '../../../lib/auth';
import { getUser, upgradeUser } from '../../../lib/db';

export const prerender = false;

/**
 * Upgrade an anonymous user to email+password.
 * The user is already authenticated via their anonymous cookie.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;

  const body = await request.json();
  const { email, password } = body;

  if (!email || !password) {
    return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400 });
  }

  if (password.length < 8) {
    return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), {
      status: 400,
    });
  }

  const user = await getUser(db, userId);
  if (!user) {
    return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });
  }

  if (user.email) {
    return new Response(JSON.stringify({ error: 'Account already has an email' }), { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  await upgradeUser(db, userId, email, passwordHash);

  return new Response(JSON.stringify({ status: 'upgraded' }), { status: 200 });
};
