/**
 * Merge Cleanup listener — when PR is merged via GitHub webhook,
 * move branch to history and delete branches.
 */

import type { EventBus } from '../infrastructure/event-bus.js';
import type { ManifestManager } from '../core/manifest-manager.js';
import type { BranchCleaner } from '../core/branch-cleaner.js';
import type { PipelineServiceConfig } from '../config/schema.js';
import { logger } from '../infrastructure/logger.js';

export interface MergeCleanupDeps {
  eventBus: EventBus;
  manifestManager: ManifestManager;
  branchCleaner: BranchCleaner;
  config: PipelineServiceConfig;
  projectPath: string;
}

export function registerMergeCleanup({ eventBus, manifestManager, branchCleaner, config, projectPath }: MergeCleanupDeps): () => void {
  return eventBus.onEventType('integration.pr.merged', async (event) => {
    const { branch, pipeline_branch, integration_branch, commit_sha } = event.data as Record<string, any>;
    if (!branch) return;

    try {
      await manifestManager.moveToMergeHistory(branch, (commit_sha as string) ?? '');
    } catch (err: any) {
      logger.error({ err: err.message, branch }, 'Failed to move branch to merge_history');
    }

    try {
      await branchCleaner.cleanupAfterMerge(
        projectPath,
        branch,
        pipeline_branch ?? `${config.branch.pipeline_prefix}${branch}`,
        integration_branch ?? `${config.branch.integration_prefix}${branch}`,
        event.request_id,
      );
    } catch (err: any) {
      logger.error({ err: err.message, branch }, 'Post-merge branch cleanup failed');
    }
  });
}
