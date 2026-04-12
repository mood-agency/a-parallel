/**
 * Simple in-memory sliding-window rate limiter for the server.
 * Keyed by client IP + optional per-user key. Tracks request timestamps
 * and rejects with 429 when the count within `windowMs` exceeds `max`.
 */

import type { Context, Next } from 'hono';

export function rateLimit(opts: {
  windowMs: number;
  max: number;
  /** Also enforce a per-user limit (uses userId from context). Defaults to false. */
  perUser?: boolean;
}) {
  const { windowMs, max, perUser } = opts;
  const hits = new Map<string, number[]>();

  // Periodically prune stale entries to prevent memory growth
  const pruneTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of hits) {
      const valid = timestamps.filter((t) => now - t < windowMs);
      if (valid.length === 0) {
        hits.delete(key);
      } else {
        hits.set(key, valid);
      }
    }
  }, windowMs);
  pruneTimer.unref();

  function check(key: string, now: number): boolean {
    const timestamps = hits.get(key) ?? [];
    const valid = timestamps.filter((t) => now - t < windowMs);
    if (valid.length >= max) return true; // rate limited
    valid.push(now);
    hits.set(key, valid);
    return false;
  }

  return async (c: Context, next: Next) => {
    const socketAddr = (c.env as any)?.remoteAddress;
    const ip = socketAddr || 'unknown';
    const now = Date.now();

    // Check IP-based limit
    if (check(`ip:${ip}`, now)) {
      c.header('Retry-After', String(Math.ceil(windowMs / 1000)));
      return c.json({ error: 'Too many requests' }, 429);
    }

    // Check per-user limit (if enabled and userId is available)
    if (perUser) {
      const userId = c.get('userId') as string | undefined;
      if (userId && check(`user:${userId}`, now)) {
        c.header('Retry-After', String(Math.ceil(windowMs / 1000)));
        return c.json({ error: 'Too many requests' }, 429);
      }
    }

    return next();
  };
}
