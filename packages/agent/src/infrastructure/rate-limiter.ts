/**
 * Simple in-memory sliding-window rate limiter middleware for Hono.
 *
 * Tracks request timestamps per key (default: IP-based) and rejects
 * requests exceeding the configured window/max with 429 Too Many Requests.
 */

import type { Context, Next } from 'hono';

export interface RateLimitConfig {
  /** Maximum requests allowed within the window. */
  max: number;
  /** Window size in milliseconds. */
  windowMs: number;
}

interface WindowEntry {
  timestamps: number[];
}

export class RateLimiter {
  private windows = new Map<string, WindowEntry>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(private config: RateLimitConfig) {
    // Periodic cleanup of stale entries every 60s
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  /**
   * Check if a request is allowed for the given key.
   * Returns { allowed, remaining, resetMs }.
   */
  check(key: string): { allowed: boolean; remaining: number; resetMs: number } {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    let entry = this.windows.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.windows.set(key, entry);
    }

    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

    const remaining = Math.max(0, this.config.max - entry.timestamps.length);
    const resetMs = entry.timestamps.length > 0
      ? Math.max(0, entry.timestamps[0] + this.config.windowMs - now)
      : 0;

    if (entry.timestamps.length >= this.config.max) {
      return { allowed: false, remaining: 0, resetMs };
    }

    entry.timestamps.push(now);
    return { allowed: true, remaining: remaining - 1, resetMs };
  }

  /** Hono middleware factory. Uses client IP as the rate limit key. */
  middleware() {
    return async (c: Context, next: Next) => {
      // Use X-Forwarded-For or fall back to a default key for local services
      const key = c.req.header('x-forwarded-for')
        ?? c.req.header('x-real-ip')
        ?? 'local';

      const result = this.check(key);

      c.header('X-RateLimit-Limit', String(this.config.max));
      c.header('X-RateLimit-Remaining', String(result.remaining));

      if (!result.allowed) {
        c.header('Retry-After', String(Math.ceil(result.resetMs / 1000)));
        return c.json(
          { error: 'Too many requests', retry_after_ms: result.resetMs },
          429,
        );
      }

      return next();
    };
  }

  /** Remove stale entries that have no timestamps within the window. */
  private cleanup(): void {
    const windowStart = Date.now() - this.config.windowMs;
    for (const [key, entry] of this.windows) {
      entry.timestamps = entry.timestamps.filter((t) => t > windowStart);
      if (entry.timestamps.length === 0) {
        this.windows.delete(key);
      }
    }
  }

  dispose(): void {
    clearInterval(this.cleanupInterval);
    this.windows.clear();
  }
}
