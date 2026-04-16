import type { APIRoute } from 'astro';
import { verifyPassword, sessionCookie } from '../../../lib/auth';
import { getUserByEmail, mergeProgress } from '../../../lib/db';

export const prerender = false;

/**
 * Login with email + password.
 * On success, sets a session cookie for the authenticated user.
 * If the visitor had an anonymous session, merges their progress.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB;
  const anonymousId = locals.userId; // Current anonymous session

  const body = await request.json();
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

  const response = new Response(JSON.stringify({ status: 'authenticated', user_id: user.id }), {
    status: 200,
  });
  response.headers.append('Set-Cookie', sessionCookie(user.id));
  return response;
};
