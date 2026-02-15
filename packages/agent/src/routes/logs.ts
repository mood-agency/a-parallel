/**
 * Log query routes.
 *
 * GET /pipeline/:id  — Logs for a specific pipeline request
 * GET /system        — System-level logs (Director, Integrator, DLQ)
 * GET /requests      — List all request IDs with logs
 */

import { Hono } from 'hono';
import type { RequestLogger, LogLevel, LogSource } from '../infrastructure/request-logger.js';

export function createLogRoutes(requestLogger: RequestLogger): Hono {
  const app = new Hono();

  // ── GET /pipeline/:id — Per-request logs ──────────────────────

  app.get('/pipeline/:id', async (c) => {
    const requestId = c.req.param('id');
    const query = c.req.query();

    const entries = await requestLogger.queryLogs(requestId, {
      source: query.source as LogSource | undefined,
      level: query.level as LogLevel | undefined,
      from: query.from,
      to: query.to,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });

    return c.json({ request_id: requestId, count: entries.length, entries });
  });

  // ── GET /system — System logs ──────────────────────────────────

  app.get('/system', async (c) => {
    const query = c.req.query();

    const entries = await requestLogger.querySystemLogs({
      source: query.source as LogSource | undefined,
      level: query.level as LogLevel | undefined,
      from: query.from,
      to: query.to,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });

    return c.json({ count: entries.length, entries });
  });

  // ── GET /requests — List request IDs with logs ─────────────────

  app.get('/requests', async (c) => {
    const ids = await requestLogger.listRequestIds();
    return c.json({ count: ids.length, request_ids: ids });
  });

  return app;
}
