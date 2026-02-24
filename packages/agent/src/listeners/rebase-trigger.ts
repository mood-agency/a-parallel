/**
 * Rebase Trigger listener — when Director detects base SHA mismatch, trigger rebase.
 */

import type { EventBus } from '../infrastructure/event-bus.js';
import type { ManifestManager } from '../core/manifest-manager.js';
import type { Integrator } from '../core/integrator.js';
import { logger } from '../infrastructure/logger.js';

export interface RebaseTriggerDeps {
  eventBus: EventBus;
  manifestManager: ManifestManager;
  integrator: Integrator;
  projectPath: string;
}

export function registerRebaseTrigger({ eventBus, manifestManager, integrator, projectPath }: RebaseTriggerDeps): () => void {
  return eventBus.onEventType('director.pr.rebase_needed', async (event) => {
    const { branch, new_base } = event.data as Record<string, any>;
    if (!branch) return;

    const pendingEntry = await manifestManager.findPendingMerge(branch);
    if (!pendingEntry) return;

    try {
      const result = await integrator.rebase(pendingEntry, projectPath, new_base as string);
      if (result.success) {
        await manifestManager.updatePendingMergeBaseSha(branch, new_base as string);
      }
    } catch (err: any) {
      logger.error({ err: err.message, branch }, 'Rebase handler failed');
    }
  });
}
