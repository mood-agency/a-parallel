/**
 * Sessions HTTP routes.
 *
 * GET    /             — List all sessions
 * GET    /:id          — Get session detail with events
 * POST   /start        — Start a new session from an issue
 * POST   /batch        — Process multiple issues from backlog
 * POST   /:id/escalate — Manually escalate a session
 * POST   /:id/cancel   — Cancel a session
 * DELETE /:id          — Remove a session record
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { SessionStore } from '../core/session-store.js';
import type { OrchestratorAgent } from '../core/orchestrator-agent.js';
import type { Tracker } from '../trackers/tracker.js';
import type { EventBus } from '../infrastructure/event-bus.js';
import type { PipelineServiceConfig } from '../config/schema.js';
import { Session } from '../core/session.js';
import type { IssueRef } from '../core/session.js';
import { isHatchetEnabled, getHatchetClient } from '../hatchet/client.js';
import { logger } from '../infrastructure/logger.js';

// ── Validation schemas ──────────────────────────────────────────

const StartSessionSchema = z.object({
  issueNumber: z.number().int().min(1),
  projectPath: z.string().min(1),
  model: z.string().optional(),
  provider: z.string().optional(),
  baseBranch: z.string().optional(),
  /** Skip planning and go straight to implementation */
  skipPlan: z.boolean().optional(),
});

const BatchStartSchema = z.object({
  projectPath: z.string().min(1),
  /** Specific issue numbers to process */
  issueNumbers: z.array(z.number().int().min(1)).optional(),
  /** Or use label filter from config */
  labels: z.array(z.string()).optional(),
  maxParallel: z.number().int().min(1).optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  baseBranch: z.string().optional(),
});

// ── Route factory ───────────────────────────────────────────────

export function createSessionRoutes(
  sessionStore: SessionStore,
  orchestratorAgent: OrchestratorAgent,
  tracker: Tracker | null,
  eventBus: EventBus,
  config: PipelineServiceConfig,
): Hono {
  const app = new Hono();

  // ── GET / — List sessions ───────────────────────────────────────

  app.get('/', (c) => {
    const status = c.req.query('status');
    const sessions = status
      ? sessionStore.byStatus(status as any)
      : sessionStore.list();

    return c.json({
      sessions: sessions.map((s) => s.toJSON()),
      total: sessions.length,
      active: sessionStore.activeCount(),
    });
  });

  // ── GET /:id — Session detail ─────────────────────────────────

  app.get('/:id', (c) => {
    const session = sessionStore.get(c.req.param('id'));
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }
    return c.json(session.toJSON());
  });

  // ── POST /start — Start session from issue ────────────────────

  app.post('/start', zValidator('json', StartSessionSchema), async (c) => {
    const body = c.req.valid('json');

    // Check if issue already has an active session
    const existing = sessionStore.byIssue(body.issueNumber);
    if (existing && existing.isActive) {
      return c.json({
        error: 'Issue already has an active session',
        sessionId: existing.id,
        status: existing.status,
      }, 409);
    }

    // Check parallel limit
    if (sessionStore.activeCount() >= config.tracker.max_parallel) {
      return c.json({
        error: `Max parallel sessions reached (${config.tracker.max_parallel})`,
        active: sessionStore.activeCount(),
      }, 429);
    }

    // Fetch issue details
    if (!tracker) {
      return c.json({ error: 'No tracker configured' }, 503);
    }

    let issueDetail;
    try {
      issueDetail = await tracker.fetchIssueDetail(body.issueNumber);
    } catch (err: any) {
      return c.json({ error: `Failed to fetch issue: ${err.message}` }, 502);
    }

    // Create session
    const issueRef: IssueRef = {
      number: issueDetail.number,
      title: issueDetail.title,
      url: issueDetail.url,
      repo: config.tracker.repo ?? '',
      body: issueDetail.body ?? undefined,
      labels: issueDetail.labels.map((l) => l.name),
    };

    const session = new Session(issueRef, body.projectPath, {
      model: body.model ?? config.orchestrator.model,
      provider: body.provider ?? config.orchestrator.provider,
    });

    sessionStore.add(session);

    // If Hatchet is available, trigger the full workflow
    if (isHatchetEnabled()) {
      try {
        const hatchet = getHatchetClient();
        await hatchet.runNoWait('issue-to-pr', {
          issueNumber: body.issueNumber,
          projectPath: body.projectPath,
          repo: config.tracker.repo,
          model: body.model ?? config.orchestrator.model,
          provider: body.provider ?? config.orchestrator.provider,
          baseBranch: body.baseBranch ?? config.branch.main,
          issueContext: issueDetail.fullContext,
        }, {});

        await sessionStore.transition(session.id, 'planning');

        logger.info({ sessionId: session.id, issueNumber: body.issueNumber }, 'Issue-to-PR workflow triggered via Hatchet');
      } catch (err: any) {
        logger.error({ err: err.message }, 'Failed to trigger Hatchet workflow');
        return c.json({ error: `Hatchet workflow failed: ${err.message}` }, 500);
      }
    } else {
      // Without Hatchet: run inline (plan only for now)
      await sessionStore.transition(session.id, 'planning');

      // Plan in background
      orchestratorAgent.planIssue(issueDetail, body.projectPath)
        .then(async (plan) => {
          sessionStore.update(session.id, (s) => s.setPlan(plan));
          await eventBus.publish({
            event_type: 'session.plan_ready' as any,
            request_id: session.id,
            timestamp: new Date().toISOString(),
            data: { sessionId: session.id, plan },
          });
        })
        .catch(async (err) => {
          logger.error({ sessionId: session.id, err: err.message }, 'Planning failed');
          await sessionStore.transition(session.id, 'failed', { error: err.message });
        });
    }

    // Comment on the issue to show it's being worked on
    tracker.addComment(
      body.issueNumber,
      `🤖 **funny agent** is now working on this issue.\n\nSession: \`${session.id}\``,
    ).catch((err) => {
      logger.warn({ err: err.message }, 'Failed to comment on issue');
    });

    return c.json({
      sessionId: session.id,
      status: session.status,
      issueNumber: body.issueNumber,
    }, 202);
  });

  // ── POST /batch — Process multiple issues ─────────────────────

  app.post('/batch', zValidator('json', BatchStartSchema), async (c) => {
    const body = c.req.valid('json');

    if (!isHatchetEnabled()) {
      return c.json({ error: 'Batch processing requires Hatchet (HATCHET_CLIENT_TOKEN)' }, 503);
    }

    const hatchet = getHatchetClient();

    try {
      await hatchet.runNoWait('backlog-processor', {
        projectPath: body.projectPath,
        repo: config.tracker.repo,
        issueNumbers: body.issueNumbers,
        labels: body.labels ?? config.tracker.labels,
        excludeLabels: config.tracker.exclude_labels,
        maxParallel: body.maxParallel ?? config.tracker.max_parallel,
        model: body.model ?? config.orchestrator.model,
        provider: body.provider ?? config.orchestrator.provider,
        baseBranch: body.baseBranch ?? config.branch.main,
      }, {});

      return c.json({ status: 'processing', message: 'Backlog processor triggered' }, 202);
    } catch (err: any) {
      return c.json({ error: `Failed to trigger backlog processor: ${err.message}` }, 500);
    }
  });

  // ── POST /:id/escalate — Manual escalation ────────────────────

  app.post('/:id/escalate', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ reason?: string }>().catch(() => ({}));

    const ok = await sessionStore.transition(id, 'escalated', {
      reason: body.reason ?? 'Manual escalation',
    });

    if (!ok) {
      const session = sessionStore.get(id);
      if (!session) return c.json({ error: 'Session not found' }, 404);
      return c.json({ error: `Cannot escalate from status: ${session.status}` }, 409);
    }

    return c.json({ status: 'escalated', sessionId: id });
  });

  // ── POST /:id/cancel — Cancel a session ───────────────────────

  app.post('/:id/cancel', async (c) => {
    const id = c.req.param('id');

    const ok = await sessionStore.transition(id, 'cancelled', {
      reason: 'Cancelled by user',
    });

    if (!ok) {
      const session = sessionStore.get(id);
      if (!session) return c.json({ error: 'Session not found' }, 404);
      return c.json({ error: `Cannot cancel from status: ${session.status}` }, 409);
    }

    return c.json({ status: 'cancelled', sessionId: id });
  });

  // ── DELETE /:id — Remove session record ───────────────────────

  app.delete('/:id', (c) => {
    const id = c.req.param('id');
    const removed = sessionStore.remove(id);
    if (!removed) {
      return c.json({ error: 'Session not found' }, 404);
    }
    return c.json({ status: 'removed', sessionId: id });
  });

  return app;
}
