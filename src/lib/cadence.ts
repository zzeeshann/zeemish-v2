/**
 * Cadence math — site-worker mirror of `agents/src/shared/admin-settings.ts`.
 *
 * The agents worker and site worker are separate packages (no shared
 * imports), so `ALLOWED_INTERVAL_HOURS` lives in both. This file is the
 * single site-side source — the admin settings API at
 * `src/pages/api/dashboard/admin/settings.ts` imports from here, not its
 * own copy. If this set ever changes, agents/src/shared/admin-settings.ts
 * must be updated in the same commit. Defensive layers preserve
 * correctness on drift: POST validation here blocks out-of-set writes,
 * and Director's parseIntervalHours on the agents side falls back to 24
 * for any value outside its own allowed set.
 */

export const ALLOWED_INTERVAL_HOURS = [1, 2, 3, 4, 6, 8, 12, 24] as const;
export type IntervalHours = typeof ALLOWED_INTERVAL_HOURS[number];

/**
 * Parse an admin_settings.value string into a valid interval_hours.
 * Falls back to 24 for any value outside the allowed set — same shape
 * as the agents-side parser.
 */
export function parseIntervalHours(raw: string | null | undefined): number {
  if (typeof raw !== 'string') return 24;
  const n = parseInt(raw, 10);
  return (ALLOWED_INTERVAL_HOURS as readonly number[]).includes(n) ? n : 24;
}

/**
 * Read `admin_settings.interval_hours` with a defensive 24 fallback.
 * Matches the agents-side `getAdminSetting` pattern — any read failure,
 * missing row, or non-string value silently falls back.
 */
export async function getIntervalHours(db: D1Database): Promise<number> {
  try {
    const row = await db
      .prepare('SELECT value FROM admin_settings WHERE key = ?')
      .bind('interval_hours')
      .first<{ value: string }>();
    return parseIntervalHours(row?.value ?? null);
  } catch {
    return 24;
  }
}

/**
 * Timestamp of the next cron slot that would pass Director's gate.
 *
 * The gate (agents/src/director.ts `dailyRun`) is:
 *   `((UTC_hour - 2 + 24) % interval_hours) === 0`
 * anchored to hour 2 so the 02:00 UTC ritual is preserved at every
 * divisor-of-24 interval. Reverse: scan forward from the next top-of-
 * hour strictly in the future, return the first hour that satisfies
 * the gate. Bounded 24-hour scan — always finds one for allowed
 * intervals, fallback return guards against misuse.
 */
export function nextRunAtMs(nowMs: number, intervalHours: number): number {
  const now = new Date(nowMs);
  // Next top-of-hour strictly after now. If we're sitting exactly on a
  // :00 boundary we still want the NEXT one, not the current instant —
  // the cron has already fired for this hour (or is firing right now).
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours() + 1,
    0, 0, 0,
  ));
  for (let i = 0; i < 24; i++) {
    const h = next.getUTCHours();
    if (((h - 2 + 24) % intervalHours) === 0) return next.getTime();
    next.setUTCHours(next.getUTCHours() + 1);
  }
  return next.getTime();
}

/**
 * Human-readable "in Xh Ym" string for the next cron slot. Used by the
 * public dashboard subtitle and the two "next run" status hints. When
 * the next slot is under an hour away, drops the "h" segment.
 */
export function nextRunRelative(nowMs: number, intervalHours: number): string {
  const targetMs = nextRunAtMs(nowMs, intervalHours);
  const diff = Math.max(0, targetMs - nowMs);
  const hrs = Math.floor(diff / (60 * 60 * 1000));
  const mins = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
  if (hrs === 0) return `${mins}m`;
  return `${hrs}h ${mins}m`;
}
