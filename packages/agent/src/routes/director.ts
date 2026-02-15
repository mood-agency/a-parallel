/**
 * Director routes — manage the integration lifecycle.
 *
 * POST /run      — Trigger a director cycle manually
 * GET  /status   — Get director status + merge queue
 * GET  /manifest — Raw manifest for debugging
 */

import { Hono } from 'hono';
import type { Director } from '../core/director.js';
import type { ManifestManager } from '../core/manifest-manager.js';

export function createDirectorRoutes(
  director: Director,
  manifestManager: ManifestManager,
): Hono {
  const app = new Hono();

  // ── POST /run — Trigger director cycle ──────────────────────────

  app.post('/run', async (c) => {
    if (director.isRunning()) {
      return c.json({ error: 'Director cycle already in progress' }, 409);
    }

    // Fire-and-forget
    director.runCycle('manual').catch((err) => {
      console.error('[director] Manual cycle failed:', err);
    });

    return c.json({ status: 'started' }, 202);
  });

  // ── GET /status — Director status + merge queue ─────────────────

  app.get('/status', async (c) => {
    const status = await director.getStatus();
    return c.json(status);
  });

  // ── GET /manifest — Raw manifest for debugging ──────────────────

  app.get('/manifest', async (c) => {
    const manifest = await manifestManager.read();
    return c.json(manifest);
  });

  return app;
}
