import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * Pipeline monitor — returns step-by-step log for today's run.
 * No auth required (same as public dashboard data).
 * Admin page polls this every 5 seconds.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  const db = locals.runtime.env.DB;
  const runId = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);

  try {
    const result = await db
      .prepare('SELECT step, status, data, created_at FROM pipeline_log WHERE run_id = ? ORDER BY created_at ASC')
      .bind(runId)
      .all<{ step: string; status: string; data: string; created_at: number }>();

    const steps = result.results.map((row) => ({
      step: row.step,
      status: row.status,
      data: row.data ? JSON.parse(row.data) : {},
      time: row.created_at,
    }));

    // Is the pipeline still running? Check if last step is a terminal state
    const lastStep = steps[steps.length - 1];
    const isRunning = lastStep && !['done', 'error', 'skipped'].includes(lastStep.step) && lastStep.status !== 'failed';

    return new Response(JSON.stringify({ runId, steps, isRunning }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ runId, steps: [], isRunning: false }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
