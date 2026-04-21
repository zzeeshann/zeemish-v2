import type { Env } from '../types';

/**
 * admin_settings table reader (migration 0016 — multi-piece cadence
 * Phase 2). Key/value shape; values are strings, the caller parses
 * to the type it expects.
 *
 * The helper never propagates errors. If the row is missing, the
 * `value` is null/empty/non-string, or the DB read throws, the caller
 * receives `fallback`. This is deliberate: admin_settings is an
 * operational config surface, not a source-of-truth for pipeline
 * identity. Every consumer must have a safe default that preserves
 * current behaviour — a missing row is never a hard error.
 *
 * Not cached. Each call hits D1. At Director's once-per-run read
 * cadence this is a ~1ms SELECT and doesn't need caching; reading
 * fresh also means an admin-UI setting change propagates to the next
 * pipeline run without a DO restart.
 */
export async function getAdminSetting<T>(
  db: Env['DB'],
  key: string,
  parse: (raw: string) => T,
  fallback: T,
): Promise<T> {
  try {
    const row = await db
      .prepare('SELECT value FROM admin_settings WHERE key = ?')
      .bind(key)
      .first<{ value: string }>();
    if (!row || typeof row.value !== 'string') return fallback;
    return parse(row.value);
  } catch {
    return fallback;
  }
}

/**
 * Allowed values for `interval_hours` — must be divisors of 24 so
 * the hour-2-anchored modulo gate (Phase 3) produces a consistent
 * daily rhythm. Non-divisors drift across days (e.g., a 5h interval
 * would give 5 slots one day, 4 the next). The admin UI (Phase 5)
 * will constrain the dropdown to this set.
 */
export const ALLOWED_INTERVAL_HOURS = [1, 2, 3, 4, 6, 8, 12, 24] as const;
export type IntervalHours = typeof ALLOWED_INTERVAL_HOURS[number];

/**
 * Parse an admin_settings.value string into an IntervalHours. Falls
 * back to 24 for any value outside the allowed set — including
 * non-numeric strings, numbers ≤ 0, or non-divisors of 24. This is
 * defensive against manual D1 edits that bypass the admin UI's
 * dropdown constraint.
 */
export function parseIntervalHours(raw: string): IntervalHours {
  const n = parseInt(raw, 10);
  return (ALLOWED_INTERVAL_HOURS as readonly number[]).includes(n)
    ? (n as IntervalHours)
    : 24;
}
