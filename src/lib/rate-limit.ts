/**
 * KV-backed rate limiter with a fixed window.
 *
 * Why KV instead of an in-memory Map: Cloudflare Workers recycle isolates
 * constantly and don't share state across them. A Map-based limiter reset on
 * every isolate death and didn't count across isolates — effectively no
 * limit. KV is eventually consistent, which introduces a small window where
 * a burst across edges might exceed the cap, but it's fine for the soft
 * limits we use (login/magic-link/upgrade abuse prevention, Zita chat
 * throttling) and far stronger than the previous in-memory version.
 *
 * Key layout: `rl:<key>` → `{ count, resetAt }` (JSON)
 * TTL: windowSeconds — KV auto-deletes the entry once the window expires.
 */

interface Entry { count: number; resetAt: number }

export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const kvKey = `rl:${key}`;
  const now = Date.now();

  const existing = await kv.get<Entry>(kvKey, 'json');

  if (!existing || now > existing.resetAt) {
    // New window — first request in this cycle.
    const resetAt = now + windowSeconds * 1000;
    await kv.put(kvKey, JSON.stringify({ count: 1, resetAt }), {
      expirationTtl: windowSeconds,
    });
    return { allowed: true, remaining: maxRequests - 1, resetAt };
  }

  if (existing.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  // Incrementing within the window. Read-modify-write is racy at the KV
  // level — two parallel requests could both increment from the same base.
  // Acceptable for soft limits; the worst case is a single extra request
  // slipping through at boundary conditions.
  const updated: Entry = { count: existing.count + 1, resetAt: existing.resetAt };
  const remainingTtl = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  await kv.put(kvKey, JSON.stringify(updated), { expirationTtl: remainingTtl });

  return { allowed: true, remaining: maxRequests - updated.count, resetAt: existing.resetAt };
}
