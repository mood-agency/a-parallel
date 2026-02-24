/**
 * Manifest Writer listener — when pipeline completes, add branch to ready[].
 */

import type { EventBus } from '../infrastructure/event-bus.js';
import type { ManifestManager } from '../core/manifest-manager.js';
import type { PipelineServiceConfig } from '../config/schema.js';
import type { ManifestReadyEntry } from '../core/manifest-types.js';
import type { Tier } from '../core/manifest-types.js';
import { logger } from '../infrastructure/logger.js';

export interface ManifestWriterDeps {
  eventBus: EventBus;
  manifestManager: ManifestManager;
  config: PipelineServiceConfig;
}

export function registerManifestWriter({ eventBus, manifestManager, config }: ManifestWriterDeps): () => void {
  return eventBus.onEventType('pipeline.completed', async (event) => {
    const { branch, pipeline_branch, worktree_path, tier, base_branch, skip_merge } = event.data as Record<string, any>;
    if (!branch) return;

    try {
      const entry: ManifestReadyEntry = {
        branch,
        pipeline_branch: pipeline_branch ?? `${config.branch.pipeline_prefix}${branch}`,
        worktree_path: worktree_path ?? '',
        request_id: event.request_id,
        tier: (tier as Tier) ?? 'medium',
        pipeline_result: (event.data.result as any) ?? {},
        corrections_applied: (event.data.corrections_applied as string[]) ?? [],
        ready_at: new Date().toISOString(),
        priority: (event.metadata?.priority as number) ?? config.director.default_priority,
        depends_on: (event.metadata?.depends_on as string[]) ?? [],
        base_main_sha: '',
        base_branch: (base_branch as string) ?? undefined,
        skip_merge: !!skip_merge,
        metadata: event.metadata,
      };
      await manifestManager.addToReady(entry);
    } catch (err: any) {
      logger.error({ err: err.message, branch }, 'Manifest Writer: failed to add to ready[]');
    }
  });
}
