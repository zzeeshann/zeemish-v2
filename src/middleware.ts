import { defineMiddleware } from 'astro:middleware';
import { generateId, parseSessionCookie, sessionCookie } from './lib/auth';
import { createUser, getUser } from './lib/db';

/**
 * Anonymous-first auth middleware.
 *
 * Only runs on server-rendered routes (API endpoints, account, login).
 * Prerendered pages (home, courses, lessons) skip this entirely —
 * they don't have access to D1 at build time.
 *
 * The lesson-shell Web Component calls the API from the client,
 * which goes through this middleware and gets a session cookie.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);

  // Only run auth on server-rendered routes
  const serverRoutes = ['/api/', '/account', '/login'];
  const isServerRoute = serverRoutes.some((prefix) => url.pathname.startsWith(prefix));
  if (!isServerRoute) {
    return next();
  }

  const db = context.locals.runtime.env.DB;
  const cookieHeader = context.request.headers.get('cookie');
  let userId = parseSessionCookie(cookieHeader);

  // Verify the session is valid (user exists in DB)
  if (userId) {
    const user = await getUser(db, userId);
    if (!user) {
      userId = null;
    }
  }

  // Create anonymous user if no valid session
  if (!userId) {
    userId = generateId();
    await createUser(db, userId);
    context.locals.userId = userId;

    const response = await next();
    response.headers.append('Set-Cookie', sessionCookie(userId));
    return response;
  }

  context.locals.userId = userId;
  return next();
});
