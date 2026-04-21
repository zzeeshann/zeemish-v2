/**
 * Site-worker → observer_events writer.
 *
 * Mirrors the shape used by `agents/src/observer.ts:writeEvent`
 * (id, severity, title, body, context JSON, created_at) so the admin
 * Observer feed renders site-origin events alongside agent-origin
 * events without discrimination.
 *
 * Fire-and-forget: errors are swallowed so observer logging never
 * breaks the handler that's calling it. Matches the agents-side
 * `try { ... } catch {}` posture.
 */

export type ObserverSeverity = 'info' | 'warn' | 'escalation';

export interface ObserverEventInput {
  severity: ObserverSeverity;
  title: string;
  body: string;
  context?: Record<string, unknown>;
}

export async function logObserverEvent(
  db: D1Database,
  event: ObserverEventInput,
): Promise<void> {
  try {
    await db
      .prepare(
        'INSERT INTO observer_events (id, severity, title, body, context, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(
        crypto.randomUUID(),
        event.severity,
        event.title,
        event.body,
        JSON.stringify(event.context ?? {}),
        Date.now(),
      )
      .run();
  } catch {
    // Observer logging must not break the calling handler.
  }
}
