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
  /** Inline issue details — used when no tracker is configured */
  title: z.string().optional(),
  body: z.string().optional(),
  labels: z.array(z.string()).optional(),
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
      // Allow retrying if the previous session is stuck (no activity for 2+ min)
      const updatedAt = new Date(existing.updatedAt).getTime();
      const staleMs = 2 * 60 * 1000;
      if (Date.now() - updatedAt < staleMs) {
        return c.json({
          error: 'Issue already has an active session',
          sessionId: existing.id,
          status: existing.status,
        }, 409);
      }
      // Stale session — cancel it and allow retry
      await sessionStore.transition(existing.id, 'cancelled', { reason: 'Superseded by new session' });
      logger.info({ oldSessionId: existing.id, issueNumber: body.issueNumber }, 'Cancelled stale session for retry');
    }

    // Check parallel limit
    if (sessionStore.activeCount() >= config.tracker.max_parallel) {
      return c.json({
        error: `Max parallel sessions reached (${config.tracker.max_parallel})`,
        active: sessionStore.activeCount(),
      }, 429);
    }

    // Fetch issue details from tracker, or use inline data
    let issueRef: IssueRef;

    if (tracker) {
      try {
        const issueDetail = await tracker.fetchIssueDetail(body.issueNumber);
        issueRef = {
          number: issueDetail.number,
          title: issueDetail.title,
          url: issueDetail.url,
          repo: config.tracker.repo ?? '',
          body: issueDetail.body ?? undefined,
          labels: issueDetail.labels.map((l) => l.name),
        };
      } catch (err: any) {
        return c.json({ error: `Failed to fetch issue: ${err.message}` }, 502);
      }
    } else if (body.title) {
      // No tracker — use inline issue data
      issueRef = {
        number: body.issueNumber,
        title: body.title,
        url: '',
        repo: config.tracker.repo ?? '',
        body: body.body ?? undefined,
        labels: body.labels ?? [],
      };
    } else {
      return c.json({
        error: 'No tracker configured. Provide inline issue details (title, body) or install the `gh` CLI.',
      }, 503);
    }

    const session = new Session(issueRef, body.projectPath, {
      model: body.model ?? config.orchestrator.model,
      provider: body.provider ?? config.orchestrator.provider,
    });

    sessionStore.add(session);

    // Emit accepted event so the ingest mapper creates a thread in the Funny UI.
    // The ingest mapper routes *.accepted → thread creation via onAccepted().
    // It resolves projectId from: data.projectId > metadata.projectId > resolveProjectId(worktree_path).
    await eventBus.publish({
      event_type: 'session.accepted' as any,
      request_id: session.id,
      timestamp: new Date().toISOString(),
      data: {
        title: `#${issueRef.number}: ${issueRef.title}`,
        prompt: issueRef.body ?? issueRef.title,
        branch: `issue/${issueRef.number}/${slugify(issueRef.title)}`,
        worktree_path: body.projectPath,
        model: session.model,
        created_by: 'agent-orchestrator',
      },
    });

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
          issueContext: `#${issueRef.number}: ${issueRef.title}\n\n${issueRef.body ?? ''}`,
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

      // Plan in background — build IssueDetail from issueRef
      const issueDetailForPlan: import('../trackers/tracker.js').IssueDetail = {
        number: issueRef.number,
        title: issueRef.title,
        state: 'open',
        body: issueRef.body ?? null,
        url: issueRef.url,
        labels: (issueRef.labels ?? []).map((l) => ({ name: l, color: '' })),
        assignee: null,
        commentsCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        comments: [],
        fullContext: `#${issueRef.number}: ${issueRef.title}\n\n${issueRef.body ?? ''}`,
      };
      // Run the full inline pipeline: plan → implement → PR
      runInlinePipeline(
        session, issueDetailForPlan, body.projectPath,
        body.baseBranch ?? config.branch.main,
        sessionStore, orchestratorAgent, eventBus, config,
      ).catch(async (err) => {
        logger.error({ sessionId: session.id, err: err.message }, 'Inline pipeline failed');
        await sessionStore.transition(session.id, 'failed', { error: err.message });
      });
    }

    // Comment on the issue to show it's being worked on
    if (tracker) {
      tracker.addComment(
        body.issueNumber,
        `🤖 **funny agent** is now working on this issue.\n\nSession: \`${session.id}\``,
      ).catch((err) => {
        logger.warn({ err: err.message }, 'Failed to comment on issue');
      });
    }

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

// ── Inline pipeline (no Hatchet) ──────────────────────────────

/**
 * Runs the full issue-to-PR pipeline inline when Hatchet is not available.
 * Steps: plan → create worktree → implement → create PR
 */
async function runInlinePipeline(
  session: Session,
  issue: import('../trackers/tracker.js').IssueDetail,
  projectPath: string,
  baseBranch: string,
  sessionStore: SessionStore,
  orchestratorAgent: OrchestratorAgent,
  eventBus: EventBus,
  config: PipelineServiceConfig,
) {
  // Step 1: Plan
  logger.info({ sessionId: session.id }, 'Inline pipeline: planning');
  const plan = await orchestratorAgent.planIssue(issue, projectPath, {
    onEvent: async (event) => {
      // Emit each planner event to the UI via EventBus → ingest webhook → thread messages
      switch (event.type) {
        case 'text':
          await eventBus.publish({
            event_type: 'session.message' as any,
            request_id: session.id,
            timestamp: new Date().toISOString(),
            data: { role: 'assistant', content: event.content },
          });
          break;
        case 'tool_call':
          await eventBus.publish({
            event_type: 'session.tool_call' as any,
            request_id: session.id,
            timestamp: new Date().toISOString(),
            data: {
              tool_name: event.name,
              tool_input: event.args,
              tool_call_id: event.id,
              status: 'running',
            },
          });
          break;
        case 'tool_result':
          await eventBus.publish({
            event_type: 'session.tool_result' as any,
            request_id: session.id,
            timestamp: new Date().toISOString(),
            data: {
              tool_name: event.name,
              tool_call_id: event.id,
              output: event.result,
              status: 'completed',
            },
          });
          break;
      }
    },
  });
  sessionStore.update(session.id, (s) => s.setPlan(plan));
  await eventBus.publish({
    event_type: 'session.plan_ready' as any,
    request_id: session.id,
    timestamp: new Date().toISOString(),
    data: { sessionId: session.id, plan },
  });

  logger.info(
    { sessionId: session.id, summary: plan.summary, complexity: plan.estimated_complexity },
    'Inline pipeline: plan ready',
  );

  // Step 2: Create worktree + branch
  const branchName = `issue/${issue.number}/${slugify(issue.title)}`;
  const { createWorktree } = await import('@funny/core/git');

  const wtResult = await createWorktree(projectPath, branchName, { baseBranch });
  if (wtResult.isErr()) {
    logger.error({ err: wtResult.error }, 'Failed to create worktree');
    await sessionStore.transition(session.id, 'failed', { error: `Worktree creation failed: ${wtResult.error}` });
    return;
  }

  const worktreePath = wtResult.value.path;
  sessionStore.update(session.id, (s) => s.setBranch(branchName, worktreePath));
  await sessionStore.transition(session.id, 'implementing');

  logger.info(
    { sessionId: session.id, branch: branchName, worktreePath },
    'Inline pipeline: implementing',
  );

  // Step 3: Implement
  const implResult = await orchestratorAgent.implementIssue(
    issue, plan, worktreePath, branchName,
  );

  logger.info(
    { sessionId: session.id, status: implResult.status, findings: implResult.findings_count },
    'Inline pipeline: implementation complete',
  );

  // Step 4: Create PR
  const { git, push, createPR } = await import('@funny/core/git');

  // Push the branch
  const pushResult = await push(worktreePath, { branch: branchName });
  if (pushResult.isErr()) {
    logger.error({ err: pushResult.error }, 'Failed to push branch');
    await sessionStore.transition(session.id, 'failed', { error: `Push failed: ${pushResult.error}` });
    return;
  }

  await sessionStore.transition(session.id, 'pr_created');

  // Create PR
  const prTitle = `fix: ${issue.title} (Closes #${issue.number})`;
  const prBody = `## Summary\n\n${plan.summary}\n\n## Approach\n\n${plan.approach}\n\n---\n\nAutomated by funny agent session \`${session.id}\``;

  const prResult = await createPR(worktreePath, {
    title: prTitle,
    body: prBody,
    baseBranch,
    headBranch: branchName,
  });

  if (prResult.isOk()) {
    sessionStore.update(session.id, (s) => s.setPR(prResult.value.number, prResult.value.url));
    logger.info(
      { sessionId: session.id, prNumber: prResult.value.number, prUrl: prResult.value.url },
      'Inline pipeline: PR created',
    );
  } else {
    logger.warn({ err: prResult.error }, 'PR creation failed — session still tracks the pushed branch');
  }

  // Transition to waiting for CI
  await sessionStore.transition(session.id, 'ci_running');

  logger.info({ sessionId: session.id }, 'Inline pipeline: complete, waiting for CI/review');
}

/** Convert issue title to a git-branch-friendly slug */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}
