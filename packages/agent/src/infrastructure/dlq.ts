/**
 * Dead Letter Queue — file-based retry mechanism for failed event deliveries.
 *
 * When an outbound adapter fails to deliver an event, it's enqueued here.
 * A background processor retries with exponential backoff until success
 * or max_retries is exhausted.
 *
 * Storage: `.pipeline/dlq/{adapter}/{request_id}.jsonl`
 */

import { join } from 'path';
import { mkdirSync, existsSync, readdirSync } from 'fs';
import type { PipelineEvent } from '../core/types.js';
import { logger } from './logger.js';

export interface DLQConfig {
  enabled: boolean;
  path: string;
  max_retries: number;
  base_delay_ms: number;
  backoff_factor: number;
}

export interface DLQEntry {
  event: PipelineEvent;
  error: string;
  enqueued_at: string;
  retry_count: number;
  next_retry_at: string;
  last_error?: string;
}

export class DeadLetterQueue {
  private basePath: string;
  private maxRetries: number;
  private baseDelay: number;
  private backoffFactor: number;
  private enabled: boolean;

  constructor(private config: DLQConfig, projectPath: string) {
    this.enabled = config.enabled;
    this.basePath = join(projectPath, config.path);
    this.maxRetries = config.max_retries;
    this.baseDelay = config.base_delay_ms;
    this.backoffFactor = config.backoff_factor;

    if (this.enabled && !existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
  }

  /**
   * Enqueue a failed event for retry.
   */
  async enqueue(adapter: string, event: PipelineEvent, error: Error): Promise<void> {
    if (!this.enabled) return;

    const dir = join(this.basePath, adapter);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const entry: DLQEntry = {
      event,
      error: error.message,
      enqueued_at: new Date().toISOString(),
      retry_count: 0,
      next_retry_at: new Date(Date.now() + this.baseDelay).toISOString(),
    };

    const filePath = join(dir, `${event.request_id}.jsonl`);
    const file = Bun.file(filePath);
    const existing = (await file.exists()) ? await file.text() : '';
    await Bun.write(filePath, existing + JSON.stringify(entry) + '\n');

    logger.warn(
      { adapter, requestId: event.request_id, error: error.message },
      'Event enqueued in DLQ',
    );
  }

  /**
   * Process pending retries for an adapter.
   */
  async processRetries(
    adapter: string,
    deliverFn: (event: PipelineEvent) => Promise<void>,
  ): Promise<{ delivered: number; failed: number; exhausted: number }> {
    if (!this.enabled) return { delivered: 0, failed: 0, exhausted: 0 };

    const dir = join(this.basePath, adapter);
    if (!existsSync(dir)) return { delivered: 0, failed: 0, exhausted: 0 };

    let delivered = 0;
    let failed = 0;
    let exhausted = 0;

    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      return { delivered: 0, failed: 0, exhausted: 0 };
    }

    for (const fileName of files) {
      const filePath = join(dir, fileName);
      const file = Bun.file(filePath);
      const content = await file.text();
      const lines = content.trim().split('\n').filter(Boolean);
      if (lines.length === 0) continue;

      const latest = JSON.parse(lines[lines.length - 1]) as DLQEntry;

      // Check if retries exhausted
      if (latest.retry_count >= this.maxRetries) {
        logger.error(
          { adapter, requestId: latest.event.request_id, retries: latest.retry_count },
          'DLQ: max retries exhausted',
        );
        exhausted++;
        continue;
      }

      // Check if it's time to retry
      if (new Date(latest.next_retry_at) > new Date()) {
        continue; // Not yet time
      }

      try {
        await deliverFn(latest.event);
        // Success — remove the file
        await Bun.write(filePath, '');
        delivered++;
        logger.info(
          { adapter, requestId: latest.event.request_id },
          'DLQ: event delivered on retry',
        );
      } catch (retryError: any) {
        const delay = this.baseDelay * Math.pow(this.backoffFactor, latest.retry_count);
        const retryEntry: DLQEntry = {
          ...latest,
          retry_count: latest.retry_count + 1,
          next_retry_at: new Date(Date.now() + delay).toISOString(),
          last_error: retryError.message,
        };
        await Bun.write(filePath, content + JSON.stringify(retryEntry) + '\n');
        failed++;
        logger.warn(
          { adapter, requestId: latest.event.request_id, retry: retryEntry.retry_count, nextRetry: retryEntry.next_retry_at },
          'DLQ: retry failed, rescheduled',
        );
      }
    }

    return { delivered, failed, exhausted };
  }

  /**
   * Get all pending DLQ entries for an adapter.
   */
  async getPending(adapter: string): Promise<DLQEntry[]> {
    if (!this.enabled) return [];

    const dir = join(this.basePath, adapter);
    if (!existsSync(dir)) return [];

    const entries: DLQEntry[] = [];
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      return [];
    }

    for (const fileName of files) {
      const filePath = join(dir, fileName);
      const content = await Bun.file(filePath).text();
      const lines = content.trim().split('\n').filter(Boolean);
      if (lines.length === 0) continue;
      entries.push(JSON.parse(lines[lines.length - 1]) as DLQEntry);
    }

    return entries;
  }
}
