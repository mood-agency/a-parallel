/**
 * Idempotency Releaser listener — when pipeline completes, fails, or stops, release the branch.
 */

import type { EventBus } from '../infrastructure/event-bus.js';
import type { IdempotencyGuard } from '../infrastructure/idempotency.js';

export interface IdempotencyReleaserDeps {
  eventBus: EventBus;
  idempotencyGuard: IdempotencyGuard;
}

export function registerIdempotencyReleaser({ eventBus, idempotencyGuard }: IdempotencyReleaserDeps): () => void {
  return eventBus.onEventTypes(
    ['pipeline.completed', 'pipeline.failed', 'pipeline.stopped'],
    (event) => {
      const branch = (event.data as Record<string, any>).branch;
      if (branch) {
        idempotencyGuard.release(branch);
      }
    },
  );
}
