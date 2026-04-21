import type { APIRoute } from 'astro';
import { getUser } from '../../../../lib/db';
import { logObserverEvent } from '../../../../lib/observer-events';

export const prerender = false;

/**
 * admin_settings read/write API (cadence Phase 5).
 *
 * Primary consumer: the admin settings page at
 * `src/pages/dashboard/admin/settings.astro`. Primary stored key today
 * is `interval_hours` (multi-piece cadence), but this surface is
 * forward-looking for other admin-togglable state.
 *
 * `ALLOWED_INTERVAL_HOURS` is duplicated from the agents-worker helper
 * at `agents/src/shared/admin-settings.ts`. The two workers don't share
 * imports (separate packages). Both must be updated together if the
 * allowed-set ever changes. Defensive layers preserve this:
 *   - POST here rejects out-of-set values (400).
 *   - Director's parseIntervalHours on the agents side also falls back
 *     to 24 for out-of-set values, so a drift still fails safe.
 */
const ALLOWED_INTERVAL_HOURS = [1, 2, 3, 4, 6, 8, 12, 24] as const;

type AdminSettingsRow = { key: string; value: string; updated_at: number };

/** GET — returns current interval_hours + allowed set. Admin-gated. */
export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;
  const ADMIN_EMAIL = (locals.runtime.env as Record<string, string>).ADMIN_EMAIL;

  const user = userId ? await getUser(db, userId) : null;
  if (!user?.email || user.email !== ADMIN_EMAIL) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const row = await db
      .prepare('SELECT key, value, updated_at FROM admin_settings WHERE key = ?')
      .bind('interval_hours')
      .first<AdminSettingsRow>();

    const intervalHours = row ? parseInt(row.value, 10) : 24;
    return new Response(JSON.stringify({
      interval_hours: Number.isFinite(intervalHours) ? intervalHours : 24,
      updated_at: row?.updated_at ?? null,
      allowed_intervals: ALLOWED_INTERVAL_HOURS,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};

/** POST — updates interval_hours. Admin-gated. Validates against allowed set. */
export const POST: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;
  const ADMIN_EMAIL = (locals.runtime.env as Record<string, string>).ADMIN_EMAIL;

  const user = userId ? await getUser(db, userId) : null;
  if (!user?.email || user.email !== ADMIN_EMAIL) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body: { interval_hours?: unknown };
  try {
    body = await request.json() as { interval_hours?: unknown };
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const raw = body.interval_hours;
  const candidate = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  if (!(ALLOWED_INTERVAL_HOURS as readonly number[]).includes(candidate)) {
    return new Response(JSON.stringify({
      error: `interval_hours must be one of ${ALLOWED_INTERVAL_HOURS.join(', ')}`,
    }), { status: 400 });
  }

  // Read old value first so the observer event can show before/after.
  const prior = await db
    .prepare('SELECT value FROM admin_settings WHERE key = ?')
    .bind('interval_hours')
    .first<{ value: string }>();
  const priorValue = prior?.value ?? null;

  const now = Date.now();
  try {
    await db
      .prepare(`
        INSERT INTO admin_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)
      .bind('interval_hours', String(candidate), now)
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'DB write failed';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }

  // Audit trail. Fire-and-forget per observer-events helper contract.
  await logObserverEvent(db, {
    severity: 'info',
    title: `Admin settings: interval_hours ${priorValue ?? 'null'} → ${candidate}`,
    body:
      `Cadence changed by ${user.email}.\n` +
      `Previous value: ${priorValue ?? 'null'}\n` +
      `New value: ${candidate}\n` +
      `Effective: next hourly cron alarm (up to 1h from now).`,
    context: {
      type: 'admin_settings_changed',
      key: 'interval_hours',
      prior: priorValue,
      next: String(candidate),
      changedBy: user.email,
      changedAt: now,
    },
  });

  return new Response(JSON.stringify({
    ok: true,
    interval_hours: candidate,
    updated_at: now,
  }), { headers: { 'Content-Type': 'application/json' } });
};
