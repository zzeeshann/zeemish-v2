import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * Catch-all route serving MP3s from the AUDIO_BUCKET R2 binding.
 *
 * Registered as an Astro route (not just middleware) so Cloudflare's
 * Static Assets layer recognises `/audio/*` as a live path and routes
 * requests to the worker — middleware-only handling was bypassed by
 * Astro's prerendered 404.html being served for unrecognised paths.
 *
 * Published audio is permanent — cache aggressively with `immutable`.
 * Range requests supported so HTML5 audio can seek.
 */
export const GET: APIRoute = async ({ request, locals, params }) => {
  const bucket = locals.runtime.env.AUDIO_BUCKET;
  if (!bucket) {
    return new Response('Audio bucket not bound', { status: 500 });
  }

  const path = (params.path ?? '') as string;
  if (!path || path.includes('..')) {
    return new Response('Not found', { status: 404 });
  }
  const key = `audio/${path}`;

  const rangeHeader = request.headers.get('Range');
  if (rangeHeader) {
    const parsed = parseRange(rangeHeader);
    if (!parsed) return new Response('Invalid Range', { status: 400 });

    const head = await bucket.head(key);
    if (!head) return new Response('Not found', { status: 404 });

    const size = head.size;
    const start = parsed.start;
    const end = parsed.end ?? size - 1;
    if (start >= size || end >= size || start > end) {
      return new Response('Range not satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      });
    }

    const obj = await bucket.get(key, {
      range: { offset: start, length: end - start + 1 },
    });
    if (!obj) return new Response('Not found', { status: 404 });

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('etag', obj.httpEtag);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Content-Length', String(end - start + 1));
    return new Response(obj.body, { status: 206, headers });
  }

  const obj = await bucket.get(key);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
};

export const HEAD: APIRoute = async ({ locals, params }) => {
  const bucket = locals.runtime.env.AUDIO_BUCKET;
  if (!bucket) return new Response(null, { status: 500 });

  const path = (params.path ?? '') as string;
  if (!path || path.includes('..')) return new Response(null, { status: 404 });

  const head = await bucket.head(`audio/${path}`);
  if (!head) return new Response(null, { status: 404 });

  const headers = new Headers();
  head.writeHttpMetadata(headers);
  headers.set('etag', head.httpEtag);
  headers.set('Content-Length', String(head.size));
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(null, { status: 200, headers });
};

function parseRange(header: string): { start: number; end: number | null } | null {
  const match = header.match(/^bytes=(\d+)-(\d*)$/);
  if (!match) return null;
  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : null;
  if (Number.isNaN(start)) return null;
  if (end !== null && (Number.isNaN(end) || end < start)) return null;
  return { start, end };
}
