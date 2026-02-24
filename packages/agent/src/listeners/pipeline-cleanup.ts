/**
 * Pipeline Cleanup listener — clean up branches after pipeline completes or fails.
 */

import type { EventBus } from '../infrastructure/event-bus.js';
import type { BranchCleaner } from '../core/branch-cleaner.js';
import type { PipelineServiceConfig } from '../config/schema.js';
import { logger } from '../infrastructure/logger.js';

export interface PipelineCleanupDeps {
  eventBus: EventBus;
  branchCleaner: BranchCleaner;
  config: PipelineServiceConfig;
  projectPath: string;
}

export function registerPipelineCleanup({ eventBus, branchCleaner, config, projectPath }: PipelineCleanupDeps): () => void {
  const unsub1 = eventBus.onEventType('pipeline.completed', async (event) => {
    const { pipeline_branch } = event.data as Record<string, any>;
    if (!pipeline_branch) return;

    // Small delay to let manifest write complete first
    setTimeout(() => {
      branchCleaner.cleanupAfterPipelineApproved(projectPath, pipeline_branch, event.request_id).catch((err) => {
        logger.error({ err: err.message, pipeline_branch }, 'Pipeline branch cleanup failed');
      });
    }, config.director.auto_trigger_delay_ms);
  });

  const unsub2 = eventBus.onEventType('pipeline.failed', async (event) => {
    const { pipeline_branch } = event.data as Record<string, any>;
    if (!pipeline_branch) return;

    branchCleaner.handleFailedPipeline(projectPath, pipeline_branch, event.request_id).catch((err) => {
      logger.error({ err: err.message, pipeline_branch }, 'Failed pipeline branch cleanup failed');
    });
  });

  return () => { unsub1(); unsub2(); };
}
