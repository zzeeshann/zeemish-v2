import { routeAgentRequest } from 'agents';
import { getAgentByName } from 'agents';
import type { Env } from './types';
import { DirectorAgent } from './director';
import { CuratorAgent } from './curator';
import { DrafterAgent } from './drafter';

// Re-export for Durable Object bindings
export { DirectorAgent, CuratorAgent, DrafterAgent };

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
          status: 'success',
          brief: result.brief,
          mdxPreview: result.draft.mdx.slice(0, 500) + '...',
          mdxLength: result.draft.mdx.length,
          model: result.draft.model,
          tokensUsed: result.draft.tokensUsed,
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
