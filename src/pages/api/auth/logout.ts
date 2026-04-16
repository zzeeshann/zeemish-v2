import type { APIRoute } from 'astro';
import { clearSessionCookie } from '../../../lib/auth';

export const prerender = false;

export const POST: APIRoute = async () => {
  const response = new Response(JSON.stringify({ status: 'logged_out' }), { status: 200 });
  response.headers.append('Set-Cookie', clearSessionCookie());
  return response;
};
