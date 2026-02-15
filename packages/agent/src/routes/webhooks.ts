/**
 * GitHub webhook inbound endpoint.
 *
 * POST /github — Receives GitHub pull_request events.
 * When a PR is merged (action=closed + merged=true), emits 'integration.pr.merged'
 * on the EventBus to trigger branch cleanup and manifest updates.
 */

import { Hono } from 'hono';
import type { EventBus } from '../infrastructure/event-bus.js';
import type { PipelineServiceConfig } from '../config/schema.js';
import { logger } from '../infrastructure/logger.js';

// ── HMAC signature validation ────────────────────────────────────

async function verifySignature(
  secret: string,
  payload: string,
  signature: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const expected = `sha256=${Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  return signature === expected;
}

// ── Route factory ────────────────────────────────────────────────

export function createWebhookRoutes(
  eventBus: EventBus,
  config: PipelineServiceConfig,
): Hono {
  const app = new Hono();

  app.post('/github', async (c) => {
    const rawBody = await c.req.text();

    // Validate signature if secret is configured
    if (config.webhook_secret) {
      const signature = c.req.header('X-Hub-Signature-256') ?? '';
      if (!signature) {
        return c.json({ error: 'Missing X-Hub-Signature-256 header' }, 401);
      }
      const valid = await verifySignature(config.webhook_secret, rawBody, signature);
      if (!valid) {
        return c.json({ error: 'Invalid signature' }, 401);
      }
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    // Only handle pull_request events
    const githubEvent = c.req.header('X-GitHub-Event');
    if (githubEvent !== 'pull_request') {
      return c.json({ status: 'ignored', reason: `event type: ${githubEvent}` }, 200);
    }

    // Only handle closed + merged PRs
    if (payload.action !== 'closed' || !payload.pull_request?.merged) {
      return c.json({ status: 'ignored', reason: 'not a merged PR' }, 200);
    }

    const pr = payload.pull_request;
    const headRef: string = pr.head?.ref ?? '';
    const baseRef: string = pr.base?.ref ?? '';
    const mergeCommitSha: string = pr.merge_commit_sha ?? '';
    const prNumber: number = pr.number ?? 0;

    // Extract branch name from integration prefix
    const integrationPrefix = config.branch.integration_prefix;
    if (!headRef.startsWith(integrationPrefix)) {
      return c.json({ status: 'ignored', reason: 'not an integration branch' }, 200);
    }
    const branch = headRef.slice(integrationPrefix.length);
    const pipelineBranch = `${config.branch.pipeline_prefix}${branch}`;

    logger.info(
      { branch, headRef, baseRef, prNumber, mergeCommitSha },
      'GitHub webhook: PR merged',
    );

    // Emit event for downstream listeners (branch cleanup, manifest update)
    await eventBus.publish({
      event_type: 'integration.pr.merged',
      request_id: `webhook-${prNumber}`,
      timestamp: new Date().toISOString(),
      data: {
        branch,
        integration_branch: headRef,
        pipeline_branch: pipelineBranch,
        base_ref: baseRef,
        merge_commit_sha: mergeCommitSha,
        pr_number: prNumber,
        pr_url: pr.html_url ?? '',
      },
    });

    return c.json({ status: 'processed', branch, pr_number: prNumber }, 200);
  });

  return app;
}
