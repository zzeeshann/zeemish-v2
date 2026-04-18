import { defineMiddleware } from 'astro:middleware';
import { generateId, parseSessionCookie, sessionCookie } from './lib/auth';
import { createUser, getUser } from './lib/db';

/**
 * Anonymous-first auth middleware.
 *
 * Only runs on server-rendered routes (API endpoints, account, login).
 * Prerendered pages (home, daily, library) skip this entirely —
 * they don't have access to D1 at build time.
 *
 * The lesson-shell Web Component calls the API from the client,
 * which goes through this middleware and gets a session cookie.
 *
 * Audio serving lives at `src/pages/audio/[...path].ts` (a real Astro
 * route) because middleware-only handling was bypassed by Cloudflare
 * Static Assets serving the prerendered 404.html for unrecognised
 * paths. Putting it at a route makes Astro recognise /audio/* as a
 * live path, which routes through the worker instead.
 */

// Security headers applied to every response. `public/_headers` is
// ignored by Cloudflare Workers Static Assets, so we set them here.
// connect-src: 'self' covers the agents worker too — it's reached via
// service binding in the worker, not from the browser.
//
// HTML responses also get `Cache-Control: private, no-store` so the
// Cloudflare CDN edge cache doesn't intercept them before the worker
// runs (which would skip security headers on cached responses). Static
// assets (audio/css/js/fonts) keep their handler's Cache-Control —
// those bake the security headers into the cached response naturally.
function applySecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; media-src 'self'; frame-ancestors 'none'",
  );
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  const contentType = headers.get('content-type') ?? '';
  if (contentType.startsWith('text/html')) {
    headers.set('Cache-Control', 'private, no-store, must-revalidate');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);

  // Audio route is public — skip auth for it. The actual serving is
  // done by src/pages/audio/[...path].ts.
  if (url.pathname.startsWith('/audio/')) {
    return applySecurityHeaders(await next());
  }

  // Only run auth on server-rendered routes
  const serverRoutes = ['/api/', '/account', '/login', '/dashboard', '/auth/'];
  const isServerRoute = serverRoutes.some((prefix) => url.pathname.startsWith(prefix));
  if (!isServerRoute) {
    return applySecurityHeaders(await next());
  }

  // CSRF protection: reject cross-origin POST requests
  if (context.request.method === 'POST') {
    const origin = context.request.headers.get('origin');
    const host = context.request.headers.get('host');
    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          return applySecurityHeaders(new Response('Forbidden', { status: 403 }));
        }
      } catch {
        return applySecurityHeaders(new Response('Forbidden', { status: 403 }));
      }
    }
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

    const response = applySecurityHeaders(await next());
    response.headers.append('Set-Cookie', sessionCookie(userId));
    return response;
  }

  context.locals.userId = userId;
  return applySecurityHeaders(await next());
});
