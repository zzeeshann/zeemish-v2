import { routeAgentRequest } from 'agents';
import { getAgentByName } from 'agents';
import type { Env } from './types';
import { DirectorAgent } from './director';
import { ObserverAgent } from './observer';
import { LearnerAgent } from './learner';

// Re-export for Durable Object bindings
export { DirectorAgent };
export { VoiceAuditorAgent } from './voice-auditor';
export { StructureEditorAgent } from './structure-editor';
export { FactCheckerAgent } from './fact-checker';
export { IntegratorAgent } from './integrator';
export { PublisherAgent } from './publisher';
export { ObserverAgent } from './observer';
// EngagementAnalyst merged into LearnerAgent
export { LearnerAgent } from './learner';
export { AudioProducerAgent } from './audio-producer';
export { AudioAuditorAgent } from './audio-auditor';
export { ScannerAgent } from './scanner';
export { CuratorAgent } from './curator';
export { DrafterAgent } from './drafter';
// Course workflow removed — daily pieces only

/** Check admin auth — bearer token only (no query params — they leak in logs) */
function checkAuth(request: Request, env: Env): boolean {
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7) === env.ADMIN_SECRET;
  }
  return false;
}

/** Allowed origins for CORS */
const ALLOWED_ORIGINS = [
  'https://zeemish-v2.zzeeshann.workers.dev',
  'https://zeemish.io',
  'https://www.zeemish.io',
];

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Content-Type': 'application/json',
  };
}

/**
 * Entry point for the zeemish-agents Worker.
 *
 * Routes:
 * - POST /daily-trigger — produce today's daily piece
 * - GET /status — get Director status
 * - /agents/* — Agent SDK routing (WebSocket, RPC)
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          ...corsHeaders(request),
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Admin endpoints require auth
    const adminPaths = ['/daily-trigger', '/status', '/digest', '/events', '/engagement'];
    if (adminPaths.some((p) => url.pathname === p) && !checkAuth(request, env)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Status: GET /status
    if (url.pathname === '/status' && request.method === 'GET') {
      try {
        const director = await getAgentByName<DirectorAgent>(env.DIRECTOR, 'default');
        const state = await director.getStatus();
        return new Response(JSON.stringify(state), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return new Response(
          JSON.stringify({ error: message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    // Dashboard digest: GET /digest
    if (url.pathname === '/digest' && request.method === 'GET') {
      try {
        const observer = await getAgentByName<ObserverAgent>(env.OBSERVER, 'observer');
        const digest = await observer.getDailyDigest();
        return new Response(JSON.stringify(digest), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return new Response(JSON.stringify({ error: message }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Recent events: GET /events?limit=20
    if (url.pathname === '/events' && request.method === 'GET') {
      try {
        const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
        const observer = await getAgentByName<ObserverAgent>(env.OBSERVER, 'observer');
        const events = await observer.getRecentEvents(limit);
        return new Response(JSON.stringify({ events }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return new Response(JSON.stringify({ error: message }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Engagement report: GET /engagement?course=body
    if (url.pathname === '/engagement' && request.method === 'GET') {
      const courseId = url.searchParams.get('course') ?? 'daily';
      try {
        const analyst = await getAgentByName<LearnerAgent>(env.LEARNER, 'learner');
        const report = await analyst.analyse(courseId);
        return new Response(JSON.stringify(report), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return new Response(JSON.stringify({ error: message }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Daily piece trigger: POST /daily-trigger (requires auth)
    //
    // Acknowledge-and-run: the full pipeline takes minutes (Scanner → Curator
    // → Drafter → 1-3 audit rounds → Publisher), far longer than a reasonable
    // HTTP request. We return 202 Accepted immediately with the run id and
    // hand the work off via ctx.waitUntil so the isolate stays alive until
    // it completes. Caller (admin dashboard, curl, reset-today script) polls
    // /api/dashboard/pipeline or /status for progress.
    if (url.pathname === '/daily-trigger' && request.method === 'POST') {
      try {
        const director = await getAgentByName<DirectorAgent>(env.DIRECTOR, 'default');
        const runId = new Date().toISOString().slice(0, 10);
        // Manual admin trigger bypasses the "already published today" guard.
        // ADMIN_SECRET auth above is the control — if you got here, you meant it.
        ctx.waitUntil(
          director.triggerDailyPiece(true).catch((err) => {
            // Swallowing here is intentional: Director logs errors via
            // Observer + pipeline_log already. waitUntil unhandled rejections
            // would just surface as Cloudflare runtime noise.
            const message = err instanceof Error ? err.message : 'Unknown error';
            console.error(`[daily-trigger] background run failed for ${runId}:`, message);
          }),
        );
        return new Response(JSON.stringify({ status: 'started', runId }), {
          status: 202,
          headers: corsHeaders(request),
        });
      } catch (err) {
        // Only synchronous failures (e.g. DO stub creation) reach here.
        const message = err instanceof Error ? err.message : 'Unknown error';
        return new Response(JSON.stringify({ error: message }), {
          status: 500, headers: corsHeaders(request),
        });
      }
    }

    // Agent SDK routing
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    return new Response(
      JSON.stringify({
        service: 'zeemish-agents',
        endpoints: {
          'daily-trigger': 'POST /daily-trigger (requires auth)',
          status: 'GET /status',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  },
} satisfies ExportedHandler<Env>;
