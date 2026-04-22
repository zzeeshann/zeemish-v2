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
  /**
   * Piece this event belongs to. Optional — pass `undefined` for
   * system events (rate-limit counters, non-piece errors) and they
   * stay invisible to the per-piece admin deep-dive. Piece-scoped
   * events (Zita truncation, Zita Claude errors on a piece page,
   * etc.) should pass the piece_id so the admin can filter by piece.
   * Schema column added in migration 0020 (2026-04-22).
   */
  pieceId?: string | null;
}

export async function logObserverEvent(
  db: D1Database,
  event: ObserverEventInput,
): Promise<void> {
  try {
    await db
      .prepare(
        'INSERT INTO observer_events (id, severity, title, body, context, piece_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        crypto.randomUUID(),
        event.severity,
        event.title,
        event.body,
        JSON.stringify(event.context ?? {}),
        event.pieceId ?? null,
        Date.now(),
      )
      .run();
  } catch {
    // Observer logging must not break the calling handler.
  }
}
