/**
 * QualityPipeline — orchestrates multiple quality agents in parallel.
 *
 * Replaces the old "single Claude process using Task tool" approach with
 * direct AgentExecutor calls per agent. Each agent gets its own model/provider,
 * runs in parallel, and returns structured AgentResult objects.
 *
 * Correction cycles are deterministic: re-run agents with status === 'failed'.
 */

import { AgentExecutor, ModelFactory } from '@funny/core/agents';
import type { AgentContext, AgentResult, DiffStats } from '@funny/core/agents';
import type { PipelineRequest, AgentName, Tier } from './types.js';
import type { EventBus } from '../infrastructure/event-bus.js';
import type { PipelineServiceConfig } from '../config/schema.js';
import { MessagePublisher } from '../infrastructure/message-publisher.js';
import { resolveAgentRole } from './agent-roles.js';
import { logger } from '../infrastructure/logger.js';
import { errorMessage } from './errors.js';
import { nanoid } from 'nanoid';

// ── Result type ─────────────────────────────────────────────────

export interface QualityPipelineResult {
  agentResults: AgentResult[];
  correctionsApplied: string[];
  overallStatus: 'passed' | 'failed';
}

// ── QualityPipeline ─────────────────────────────────────────────

export class QualityPipeline {
  /** Metadata from the pipeline request (carries projectId, userId, etc.) */
  private requestMetadata?: Record<string, unknown>;
  private messagePublisher: MessagePublisher;

  constructor(
    private eventBus: EventBus,
    private config: PipelineServiceConfig,
    private modelFactory: ModelFactory,
    private signal?: AbortSignal,
  ) {
    this.messagePublisher = new MessagePublisher(eventBus);
  }

  /**
   * Run the quality pipeline: parallel agents → correction cycles → result.
   */
  async run(
    requestId: string,
    request: PipelineRequest,
    tier: Tier,
    agents: AgentName[],
    diffStats: DiffStats,
  ): Promise<QualityPipelineResult> {
    const baseBranch = request.base_branch ?? this.config.branch.main;
    this.requestMetadata = request.metadata;

    // Build shared context for all agents
    const context: AgentContext = {
      branch: request.branch,
      worktreePath: request.worktree_path,
      tier,
      diffStats,
      previousResults: [],
      baseBranch,
      metadata: {
        ...request.metadata,
        appUrl: request.config?.appUrl,
      },
    };

    logger.info(
      { requestId, agents, tier, filesChanged: diffStats.files_changed },
      'Starting quality pipeline',
    );

    // Wave 1: run all agents in parallel
    let results = await this.runAgentWave(requestId, agents, context);

    // Correction cycles with exponential backoff
    const correctionsApplied: string[] = [];
    const maxCorrections = this.config.auto_correction.max_attempts;
    const backoffBaseMs = this.config.auto_correction.backoff_base_ms;
    const backoffFactor = this.config.auto_correction.backoff_factor;

    for (let cycle = 0; cycle < maxCorrections; cycle++) {
      // Check for abort
      if (this.signal?.aborted) break;

      const failed = results.filter((r) => r.status === 'failed');
      if (failed.length === 0) break;

      // Exponential backoff: base * factor^cycle (e.g. 1s, 2s, 4s, ...)
      if (backoffBaseMs > 0) {
        const delayMs = backoffBaseMs * Math.pow(backoffFactor, cycle);
        logger.info({ requestId, cycle: cycle + 1, delayMs }, 'Correction backoff delay');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delayMs);
          // Allow abort to cancel the wait
          this.signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
        if (this.signal?.aborted) break;
      }

      const failedNames = failed.map((r) => r.agent);
      correctionsApplied.push(`cycle-${cycle + 1}: ${failedNames.join(',')}`);

      logger.info(
        { requestId, cycle: cycle + 1, failedAgents: failedNames },
        'Starting correction cycle',
      );

      await this.eventBus.publish({
        event_type: 'pipeline.correcting',
        request_id: requestId,
        timestamp: new Date().toISOString(),
        data: {
          correction_number: cycle + 1,
          failed_agents: failedNames,
        },
        metadata: this.requestMetadata,
      });

      // Re-run failed agents with accumulated results as context
      const correctionContext: AgentContext = {
        ...context,
        previousResults: results,
      };

      const correctionResults = await this.runAgentWave(
        requestId,
        failedNames as AgentName[],
        correctionContext,
      );

      // Merge corrected results back
      for (const cr of correctionResults) {
        const idx = results.findIndex((r) => r.agent === cr.agent);
        if (idx >= 0) {
          results[idx] = cr;
        } else {
          results.push(cr);
        }
      }
    }

    const hasFailed = results.some((r) => r.status !== 'passed');

    logger.info(
      {
        requestId,
        overallStatus: hasFailed ? 'failed' : 'passed',
        agentCount: results.length,
        corrections: correctionsApplied.length,
      },
      'Quality pipeline completed',
    );

    return {
      agentResults: results,
      correctionsApplied,
      overallStatus: hasFailed ? 'failed' : 'passed',
    };
  }

  // ── CLI message emission (delegated to MessagePublisher) ─────

  /**
   * Emit a structured CLI message via the shared MessagePublisher.
   */
  private async emitCLIMessage(
    requestId: string,
    cliMessage: Record<string, unknown>,
    author?: string,
  ): Promise<void> {
    await this.messagePublisher.emitMessage(requestId, cliMessage, this.requestMetadata, author);
  }

  // ── Agent wave execution ──────────────────────────────────────

  /**
   * Run a set of agents in parallel. Each agent gets its own AgentExecutor.
   */
  private async runAgentWave(
    requestId: string,
    agents: AgentName[],
    context: AgentContext,
  ): Promise<AgentResult[]> {
    const promises = agents.map(async (agentName) => {
      // Resolve role with optional config overrides
      const configOverrides = (this.config.agents as Record<string, any>)[agentName];
      const role = resolveAgentRole(agentName, configOverrides);

      // Emit agent started event
      await this.eventBus.publish({
        event_type: 'pipeline.agent.started',
        request_id: requestId,
        timestamp: new Date().toISOString(),
        data: { agent_name: agentName, model: role.model, provider: role.provider },
        metadata: this.requestMetadata,
      });

      // Emit system init CLI message so the thread shows as running
      const sessionId = nanoid();
      await this.emitCLIMessage(requestId, {
        type: 'system',
        subtype: 'init',
        session_id: sessionId,
        tools: role.tools,
        model: role.model,
        cwd: context.worktreePath,
      }, agentName);

      // Emit dispatch message for this agent
      await this.emitCLIMessage(requestId, {
        type: 'assistant',
        message: {
          id: `${agentName}-dispatch`,
          content: [{ type: 'text', text: `Dispatching agent \`${agentName}\` (model: \`${role.model}\`, provider: \`${role.provider}\`)...` }],
        },
      }, agentName);

      const startTime = Date.now();

      try {
        const resolved = this.modelFactory.resolve(role.provider, role.model);
        const executor = new AgentExecutor(resolved.baseURL, resolved.modelId, resolved.apiKey);

        const result = await executor.execute(role, context, {
          signal: this.signal,
          onStepFinish: this.messagePublisher.createStepCallback(requestId, agentName, this.requestMetadata),
        });

        // Emit a final assistant message with the agent's summary
        const durationSec = ((result.metadata.duration_ms ?? 0) / 1000).toFixed(1);
        const summaryLines = [
          `**Agent \`${agentName}\` finished: ${result.status}** (${durationSec}s, ${result.metadata.turns_used} steps)`,
          `Findings: ${result.findings.length}, Fixes applied: ${result.fixes_applied}`,
        ];
        if (result.findings.length > 0) {
          summaryLines.push('');
          for (const [i, f] of result.findings.entries()) {
            summaryLines.push(`${i + 1}. [${f.severity}] ${f.description}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''}${f.fix_applied ? ' ✓ fixed' : ''}`);
          }
        }
        const summaryText = summaryLines.join('\n');

        await this.emitCLIMessage(requestId, {
          type: 'assistant',
          message: {
            id: `${agentName}-summary`,
            content: [{ type: 'text', text: summaryText }],
          },
        }, agentName);

        // Emit agent completed event
        await this.eventBus.publish({
          event_type: 'pipeline.agent.completed',
          request_id: requestId,
          timestamp: new Date().toISOString(),
          data: {
            agent_name: agentName,
            status: result.status,
            findings_count: result.findings.length,
            fixes_applied: result.fixes_applied,
            duration_ms: result.metadata.duration_ms,
          },
          metadata: this.requestMetadata,
        });

        logger.info(
          {
            requestId,
            agent: agentName,
            status: result.status,
            findings: result.findings.length,
            fixes: result.fixes_applied,
            durationMs: result.metadata.duration_ms,
            ...(result.status === 'error' && result.findings.length > 0
              ? { error: result.findings[0].description }
              : {}),
          },
          'Agent completed',
        );

        return result;
      } catch (err: unknown) {
        const durationMs = Date.now() - startTime;
        const msg = errorMessage(err);

        logger.error(
          { requestId, agent: agentName, err: msg, durationMs },
          'Agent execution failed',
        );

        // Emit agent failed event
        await this.eventBus.publish({
          event_type: 'pipeline.agent.failed',
          request_id: requestId,
          timestamp: new Date().toISOString(),
          data: {
            agent_name: agentName,
            error: msg,
            duration_ms: durationMs,
          },
          metadata: this.requestMetadata,
        });

        // Return an error result so the pipeline can continue
        const errorResult: AgentResult = {
          agent: agentName,
          status: 'error',
          findings: [
            {
              severity: 'critical',
              description: `Agent execution error: ${msg}`,
              fix_applied: false,
            },
          ],
          fixes_applied: 0,
          metadata: {
            duration_ms: durationMs,
            turns_used: 0,
            tokens_used: { input: 0, output: 0 },
            model: role.model,
            provider: role.provider,
          },
        };

        return errorResult;
      }
    });

    // Run all agents in parallel
    return Promise.all(promises);
  }
}
