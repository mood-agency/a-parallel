/**
 * Pipeline HTTP routes.
 *
 * POST /run       — Start a new pipeline run (returns 202)
 * GET  /:id       — Get pipeline state
 * GET  /:id/events — SSE stream of pipeline events
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { streamSSE } from 'hono/streaming';
import { nanoid } from 'nanoid';
import { PipelineRunSchema } from '../validation/schemas.js';
import type { PipelineRunner } from '../core/pipeline-runner.js';
import type { EventBus } from '../infrastructure/event-bus.js';
import type { IdempotencyGuard } from '../infrastructure/idempotency.js';
import type { PipelineEvent } from '../core/types.js';

export function createPipelineRoutes(
  runner: PipelineRunner,
  eventBus: EventBus,
  idempotencyGuard?: IdempotencyGuard,
): Hono {
  const app = new Hono();

  // ── POST /run — Start pipeline ──────────────────────────────────

  app.post('/run', zValidator('json', PipelineRunSchema), async (c) => {
    const body = c.req.valid('json');

    // Idempotency check: reject if a pipeline is already active for this branch
    if (idempotencyGuard) {
      const check = idempotencyGuard.check(body.branch);
      if (check.isDuplicate) {
        return c.json(
          {
            request_id: check.existingRequestId,
            status: 'already_running',
            events_url: `/pipeline/${check.existingRequestId}/events`,
          },
          200,
        );
      }
    }

    const requestId = nanoid();

    // Register in idempotency guard before starting
    if (idempotencyGuard) {
      idempotencyGuard.register(body.branch, requestId);
    }

    const request = {
      request_id: requestId,
      branch: body.branch,
      worktree_path: body.worktree_path,
      base_branch: body.base_branch,
      config: body.config,
      metadata: body.metadata,
    };

    // Fire-and-forget — pipeline runs in background
    runner.run(request).catch((err) => {
      console.error(`[pipeline] Background run failed for ${requestId}:`, err);
    });

    return c.json(
      {
        request_id: requestId,
        status: 'accepted',
        events_url: `/pipeline/${requestId}/events`,
      },
      202,
    );
  });

  // ── GET /:id — Pipeline state ───────────────────────────────────

  app.get('/:id', (c) => {
    const id = c.req.param('id');
    const state = runner.getStatus(id);

    if (!state) {
      return c.json({ error: 'Pipeline not found' }, 404);
    }

    return c.json(state);
  });

  // ── GET /:id/events — SSE stream ───────────────────────────────

  app.get('/:id/events', async (c) => {
    const id = c.req.param('id');

    return streamSSE(c, async (stream) => {
      // Send historical events first
      const historical = await eventBus.getEvents(id);
      for (const event of historical) {
        await stream.writeSSE({
          event: event.event_type,
          data: JSON.stringify(event),
        });
      }

      // Subscribe to live events
      let closed = false;
      const onEvent = async (event: PipelineEvent) => {
        if (closed || event.request_id !== id) return;
        try {
          await stream.writeSSE({
            event: event.event_type,
            data: JSON.stringify(event),
          });
        } catch {
          closed = true;
        }
      };

      eventBus.on('event', onEvent);

      // Keep connection open until client disconnects or pipeline completes
      stream.onAbort(() => {
        closed = true;
        eventBus.off('event', onEvent);
      });

      // Wait until closed
      while (!closed) {
        await new Promise((r) => setTimeout(r, 1000));

        // Check if pipeline is done
        const state = runner.getStatus(id);
        if (state && ['approved', 'failed', 'error'].includes(state.status)) {
          // Give a moment for final events to flush
          await new Promise((r) => setTimeout(r, 500));
          break;
        }
      }

      eventBus.off('event', onEvent);
    });
  });

  // ── POST /:id/stop — Stop pipeline ─────────────────────────────

  app.post('/:id/stop', async (c) => {
    const id = c.req.param('id');

    if (!runner.isRunning(id)) {
      return c.json({ error: 'Pipeline not running' }, 404);
    }

    await runner.stop(id);
    return c.json({ status: 'stopped' });
  });

  return app;
}
