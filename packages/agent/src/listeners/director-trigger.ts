/**
 * Director Trigger listener — when pipeline completes, auto-trigger a director cycle.
 */

import type { EventBus } from '../infrastructure/event-bus.js';
import type { Director } from '../core/director.js';
import type { PipelineServiceConfig } from '../config/schema.js';
import { logger } from '../infrastructure/logger.js';

export interface DirectorTriggerDeps {
  eventBus: EventBus;
  director: Director;
  config: PipelineServiceConfig;
}

export function registerDirectorTrigger({ eventBus, director, config }: DirectorTriggerDeps): () => void {
  return eventBus.onEventType('pipeline.completed', async () => {
    if (director.isRunning()) return;

    // Configurable delay to ensure manifest write completes first
    setTimeout(() => {
      director.runCycle('event').catch((err) => {
        logger.error({ err: err.message }, 'Director auto-cycle failed');
      });
    }, config.director.auto_trigger_delay_ms);
  });
}
