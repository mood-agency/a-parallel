/**
 * AdapterManager — dispatches EventBus events to outbound adapters.
 *
 * On delivery failure, enqueues in the DLQ for retry.
 * A background timer periodically processes DLQ retries.
 */

import type { PipelineEvent } from '../core/types.js';
import type { EventBus } from './event-bus.js';
import type { DeadLetterQueue } from './dlq.js';
import { logger } from './logger.js';

// ── Interface ───────────────────────────────────────────────────

export interface IOutboundAdapter {
  readonly name: string;
  deliver(event: PipelineEvent): Promise<void>;
}

// ── AdapterManager ──────────────────────────────────────────────

export class AdapterManager {
  private adapters: IOutboundAdapter[] = [];
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private eventListener: ((event: PipelineEvent) => void) | null = null;

  constructor(
    private eventBus: EventBus,
    private dlq: DeadLetterQueue,
    private retryIntervalMs: number = 60_000,
  ) {}

  /**
   * Register an outbound adapter.
   */
  register(adapter: IOutboundAdapter): void {
    this.adapters.push(adapter);
    logger.info({ adapter: adapter.name }, 'Outbound adapter registered');
  }

  /**
   * Start listening to EventBus and dispatching to adapters.
   * Also starts the background DLQ retry timer.
   */
  start(): void {
    if (this.adapters.length === 0) {
      logger.info('No outbound adapters registered, skipping adapter manager start');
      return;
    }

    this.eventListener = (event: PipelineEvent) => {
      for (const adapter of this.adapters) {
        this.dispatchToAdapter(adapter, event);
      }
    };

    this.eventBus.on('event', this.eventListener);

    this.retryTimer = setInterval(() => {
      this.processRetries();
    }, this.retryIntervalMs);

    logger.info(
      { adapters: this.adapters.map((a) => a.name), retryIntervalMs: this.retryIntervalMs },
      'Adapter manager started',
    );
  }

  /**
   * Stop the background retry timer and remove event listener.
   */
  stop(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.eventListener) {
      this.eventBus.off('event', this.eventListener);
      this.eventListener = null;
    }
    logger.info('Adapter manager stopped');
  }

  // ── Internal ──────────────────────────────────────────────────

  private async dispatchToAdapter(adapter: IOutboundAdapter, event: PipelineEvent): Promise<void> {
    try {
      await adapter.deliver(event);
    } catch (err: any) {
      logger.warn(
        { adapter: adapter.name, eventType: event.event_type, err: err.message },
        'Adapter delivery failed, enqueuing in DLQ',
      );
      await this.dlq.enqueue(adapter.name, event, err);
    }
  }

  private async processRetries(): Promise<void> {
    for (const adapter of this.adapters) {
      try {
        const result = await this.dlq.processRetries(
          adapter.name,
          (event) => adapter.deliver(event),
        );
        if (result.delivered > 0 || result.failed > 0 || result.exhausted > 0) {
          logger.info({ adapter: adapter.name, ...result }, 'DLQ retry cycle completed');
        }
      } catch (err: any) {
        logger.error({ adapter: adapter.name, err: err.message }, 'DLQ retry processing failed');
      }
    }
  }
}
