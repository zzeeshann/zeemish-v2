import type { APIRoute } from 'astro';

export const prerender = false;

/** Self-improvement-loop output — counts + latest observation from learnings. Public, no auth. */
export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.DB;

  try {
    const producer = await db
      .prepare("SELECT COUNT(*) as n FROM learnings WHERE source = 'producer'")
      .first<{ n: number }>();

    const selfReflection = await db
      .prepare("SELECT COUNT(*) as n FROM learnings WHERE source = 'self-reflection'")
      .first<{ n: number }>();

    const total = await db
      .prepare('SELECT COUNT(*) as n FROM learnings')
      .first<{ n: number }>();

    const latest = await db
      .prepare('SELECT observation, source, created_at FROM learnings ORDER BY created_at DESC LIMIT 1')
      .first<{ observation: string; source: string | null; created_at: number }>();

    return new Response(JSON.stringify({
      counts: {
        producer: producer?.n ?? 0,
        selfReflection: selfReflection?.n ?? 0,
        total: total?.n ?? 0,
      },
      latest: latest ? {
        observation: latest.observation,
        source: latest.source,
        createdAt: latest.created_at,
      } : null,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response(JSON.stringify({
      counts: { producer: 0, selfReflection: 0, total: 0 },
      latest: null,
    }), { headers: { 'Content-Type': 'application/json' } });
  }
};
