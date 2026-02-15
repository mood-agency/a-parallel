/**
 * Idempotency guard — prevents duplicate pipeline runs for the same branch.
 *
 * Tracks active pipelines in memory + `.pipeline/active-pipelines.json`.
 * On startup, loads persisted state to recover from crashes.
 */

import { join } from 'path';
import { logger } from './logger.js';

export interface IdempotencyCheckResult {
  isDuplicate: boolean;
  existingRequestId?: string;
}

export class IdempotencyGuard {
  private active = new Map<string, string>(); // branch → request_id
  private persistPath: string;

  constructor(pipelineDir: string) {
    this.persistPath = join(pipelineDir, 'active-pipelines.json');
  }

  /**
   * Check if a pipeline is already active for this branch.
   */
  check(branch: string): IdempotencyCheckResult {
    const existing = this.active.get(branch);
    if (existing) {
      return { isDuplicate: true, existingRequestId: existing };
    }
    return { isDuplicate: false };
  }

  /**
   * Register a new active pipeline for a branch.
   */
  register(branch: string, requestId: string): void {
    this.active.set(branch, requestId);
    this.persist().catch((err) => {
      logger.error({ err: err.message }, 'Failed to persist idempotency state');
    });
  }

  /**
   * Release a branch when its pipeline completes or fails.
   */
  release(branch: string): void {
    this.active.delete(branch);
    this.persist().catch((err) => {
      logger.error({ err: err.message }, 'Failed to persist idempotency state');
    });
  }

  /**
   * Load persisted state from disk (call at startup).
   */
  async loadFromDisk(): Promise<void> {
    const file = Bun.file(this.persistPath);
    if (!(await file.exists())) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text) as Record<string, string>;
      for (const [branch, requestId] of Object.entries(data)) {
        this.active.set(branch, requestId);
      }
      logger.info({ count: this.active.size }, 'Loaded idempotency state from disk');
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to load idempotency state, starting fresh');
    }
  }

  /**
   * Persist current state to disk.
   */
  private async persist(): Promise<void> {
    const data: Record<string, string> = {};
    for (const [branch, requestId] of this.active) {
      data[branch] = requestId;
    }
    await Bun.write(this.persistPath, JSON.stringify(data, null, 2) + '\n');
  }
}
