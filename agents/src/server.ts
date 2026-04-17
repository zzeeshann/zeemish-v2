import { routeAgentRequest } from 'agents';
import { getAgentByName } from 'agents';
import type { Env } from './types';
import { DirectorAgent } from './director';
import { CuratorAgent } from './curator';
import { DrafterAgent } from './drafter';
import { ObserverAgent } from './observer';
import { LearnerAgent } from './learner';

// Re-export for Durable Object bindings
export { DirectorAgent, CuratorAgent, DrafterAgent };
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
export { PublishLessonWorkflow } from './workflows/publish-lesson';

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
 * - POST /trigger?course=slug&lesson=number — kick off a lesson pipeline
 * - GET /status — get Director status
 * - /agents/* — Agent SDK routing (WebSocket, RPC)
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
    const adminPaths = ['/trigger', '/daily-trigger', '/status', '/digest', '/events', '/engagement'];
    if (adminPaths.some((p) => url.pathname === p) && !checkAuth(request, env)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Manual trigger: POST /trigger?course=body&lesson=2
    if (url.pathname === '/trigger' && request.method === 'POST') {
      const courseSlug = url.searchParams.get('course');
      const lessonNumber = parseInt(url.searchParams.get('lesson') ?? '0', 10);

      if (!courseSlug || !lessonNumber) {
        return new Response(
          JSON.stringify({ error: 'Missing ?course=slug&lesson=number' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }

      try {
        // Get Director agent via SDK helper
        const director = await getAgentByName<DirectorAgent>(env.DIRECTOR, 'default');
        const result = await director.triggerLesson(courseSlug, lessonNumber);

        return new Response(JSON.stringify({
          status: result.passed ? 'success' : 'failed_audit',
          passed: result.passed,
          revisionCount: result.revisionCount,
          brief: result.brief,
          audits: result.audits?.map((a: any) => ({
            round: a.round,
            voiceScore: a.voice?.score,
            voicePassed: a.voice?.passed,
            structurePassed: a.structure?.passed,
            factsPassed: a.facts?.passed,
            allPassed: a.allPassed,
          })),
          published: result.published ?? null,
          mdxPreview: result.finalMdx?.slice(0, 500) + '...',
          mdxLength: result.finalMdx?.length ?? 0,
          model: result.draft?.model,
          tokensUsed: result.draft?.tokensUsed,
        }), { headers: { 'Content-Type': 'application/json' } });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return new Response(
          JSON.stringify({ error: message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }
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
    if (url.pathname === '/daily-trigger' && request.method === 'POST') {
      try {
        const director = await getAgentByName<DirectorAgent>(env.DIRECTOR, 'default');
        const result = await director.triggerDailyPiece();
        if (result) {
          return new Response(JSON.stringify({
            status: 'success',
            headline: result.brief.headline,
            subject: result.brief.underlyingSubject,
            mdxLength: result.mdx.length,
          }), { headers: corsHeaders(request) });
        }
        return new Response(JSON.stringify({ status: 'skipped', reason: 'No teachable stories' }), {
          headers: corsHeaders(request),
        });
      } catch (err) {
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
          trigger: 'POST /trigger?course=slug&lesson=number',
          status: 'GET /status',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  },
} satisfies ExportedHandler<Env>;
