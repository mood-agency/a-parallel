/**
 * Hatchet worker — registers all workflows and starts processing.
 *
 * Only starts if HATCHET_CLIENT_TOKEN is set in the environment.
 * Gracefully skips when Hatchet is not configured.
 */

import { getHatchetClient, isHatchetEnabled } from './client.js';
import { registerFeatureToDeployWorkflow } from './workflows/feature-to-deploy.js';
import { registerCleanupWorkflow } from './workflows/cleanup.js';
import { registerDocGardeningWorkflow } from './workflows/doc-gardening.js';
import { registerPRReviewLoopWorkflow } from './workflows/pr-review-loop.js';
import { registerIssueToPRWorkflow } from './workflows/issue-to-pr.js';
import { registerBacklogProcessorWorkflow } from './workflows/backlog-processor.js';
import type { PipelineRunner } from '../core/pipeline-runner.js';
import { logger } from '../infrastructure/logger.js';

/**
 * Start the Hatchet worker with all registered workflows.
 * No-op if HATCHET_CLIENT_TOKEN is not set.
 *
 * @param runner PipelineRunner instance for direct quality pipeline calls
 */
export async function startHatchetWorker(runner: PipelineRunner): Promise<void> {
  if (!isHatchetEnabled()) {
    logger.info('HATCHET_CLIENT_TOKEN not set — Hatchet worker disabled');
    return;
  }

  const hatchet = getHatchetClient();

  const featureWorkflow = registerFeatureToDeployWorkflow(hatchet, runner);
  const cleanupWorkflow = registerCleanupWorkflow(hatchet);
  const docGardeningWorkflow = registerDocGardeningWorkflow(hatchet);
  const prReviewLoopWorkflow = registerPRReviewLoopWorkflow(hatchet);
  const issueToPRWorkflow = registerIssueToPRWorkflow(hatchet, runner);
  const backlogProcessorWorkflow = registerBacklogProcessorWorkflow(hatchet);

  const worker = await hatchet.worker('pipeline-worker', {
    workflows: [
      featureWorkflow,
      cleanupWorkflow,
      docGardeningWorkflow,
      prReviewLoopWorkflow,
      issueToPRWorkflow,
      backlogProcessorWorkflow,
    ],
  });

  await worker.start();
  logger.info('Hatchet worker started with workflows: feature-to-deploy, cleanup, doc-gardening, pr-review-loop, issue-to-pr, backlog-processor');
}
