/**
 * Saga — step-based workflow with compensating transactions.
 *
 * On failure at step N:
 *   1. Log the failure
 *   2. Run compensate() for steps N-1, N-2, ..., 0 in reverse
 *   3. Throw the original error
 *
 * Step progress is persisted to `.pipeline/sagas/{requestId}.json`
 * for forensics and potential crash recovery.
 */

import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { logger } from '../infrastructure/logger.js';

// ── Types ───────────────────────────────────────────────────────

export interface SagaStep<TCtx> {
  name: string;
  action: (ctx: TCtx) => Promise<void>;
  compensate?: (ctx: TCtx) => Promise<void>;
}

export interface SagaLog {
  saga_name: string;
  request_id: string;
  steps_completed: string[];
  current_step: string | null;
  started_at: string;
  completed_at?: string;
  failed_at_step?: string;
  compensations_run?: string[];
  error?: string;
}

// ── Saga class ──────────────────────────────────────────────────

export class Saga<TCtx> {
  private steps: SagaStep<TCtx>[] = [];
  private sagaDir: string;

  constructor(
    private name: string,
    sagaBasePath: string,
  ) {
    this.sagaDir = join(sagaBasePath, '.pipeline', 'sagas');
  }

  /**
   * Register a step (builder pattern).
   */
  addStep(step: SagaStep<TCtx>): this {
    this.steps.push(step);
    return this;
  }

  /**
   * Execute all steps in order. On failure, run compensations in reverse.
   */
  async execute(requestId: string, context: TCtx): Promise<void> {
    const sagaLog: SagaLog = {
      saga_name: this.name,
      request_id: requestId,
      steps_completed: [],
      current_step: null,
      started_at: new Date().toISOString(),
    };

    await this.persistLog(requestId, sagaLog);

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      sagaLog.current_step = step.name;
      await this.persistLog(requestId, sagaLog);

      try {
        await step.action(context);
        sagaLog.steps_completed.push(step.name);
        sagaLog.current_step = null;
        await this.persistLog(requestId, sagaLog);
      } catch (err: any) {
        logger.error(
          { saga: this.name, requestId, step: step.name, err: err.message },
          'Saga step failed, running compensations',
        );

        sagaLog.failed_at_step = step.name;
        sagaLog.error = err.message;

        // Run compensations in reverse order (only for completed steps)
        const compensations: string[] = [];
        for (let j = sagaLog.steps_completed.length - 1; j >= 0; j--) {
          const completedStep = this.steps[j];
          if (completedStep.compensate) {
            try {
              await completedStep.compensate(context);
              compensations.push(completedStep.name);
            } catch (compErr: any) {
              logger.error(
                { saga: this.name, requestId, step: completedStep.name, err: compErr.message },
                'Saga compensation failed',
              );
              compensations.push(`${completedStep.name} (FAILED)`);
            }
          }
        }

        sagaLog.compensations_run = compensations;
        await this.persistLog(requestId, sagaLog);

        throw err;
      }
    }

    sagaLog.completed_at = new Date().toISOString();
    sagaLog.current_step = null;
    await this.persistLog(requestId, sagaLog);
  }

  /**
   * Read a saga log from disk (for forensics / crash recovery).
   */
  async loadLog(requestId: string): Promise<SagaLog | null> {
    const filePath = join(this.sagaDir, `${requestId}.json`);
    const file = Bun.file(filePath);
    if (!(await file.exists())) return null;

    try {
      return JSON.parse(await file.text()) as SagaLog;
    } catch {
      return null;
    }
  }

  // ── Internal ──────────────────────────────────────────────────

  private async persistLog(requestId: string, log: SagaLog): Promise<void> {
    if (!existsSync(this.sagaDir)) {
      mkdirSync(this.sagaDir, { recursive: true });
    }
    const filePath = join(this.sagaDir, `${requestId}.json`);
    await Bun.write(filePath, JSON.stringify(log, null, 2) + '\n');
  }
}
