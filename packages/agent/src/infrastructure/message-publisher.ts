/**
 * MessagePublisher — centralizes CLI message emission via EventBus.
 *
 * Extracts the duplicated pipeline.cli_message publishing logic from
 * PipelineRunner (emitCLIText) and QualityPipeline (emitCLIMessage/createStepCallback).
 */

import type { StepInfo } from '@funny/core/agents';
import type { EventBus } from './event-bus.js';
import { logger } from './logger.js';

export class MessagePublisher {
  constructor(private eventBus: EventBus) {}

  /**
   * Emit a pipeline.cli_message event with a simple assistant text message.
   * Returns the message ID for reference.
   */
  async emitText(
    requestId: string,
    text: string,
    msgId: string,
    metadata?: Record<string, unknown>,
    author?: string,
  ): Promise<void> {
    await this.eventBus.publish({
      event_type: 'pipeline.cli_message',
      request_id: requestId,
      timestamp: new Date().toISOString(),
      data: {
        cli_message: {
          type: 'assistant',
          message: {
            id: msgId,
            content: [{ type: 'text', text }],
          },
          author: author ?? 'pipeline',
        },
        author: author ?? 'pipeline',
      },
      metadata,
    });
  }

  /**
   * Emit a structured CLI message (assistant, user, or system).
   */
  async emitMessage(
    requestId: string,
    cliMessage: Record<string, unknown>,
    metadata?: Record<string, unknown>,
    author?: string,
  ): Promise<void> {
    await this.eventBus.publish({
      event_type: 'pipeline.cli_message',
      request_id: requestId,
      timestamp: new Date().toISOString(),
      data: { cli_message: { ...cliMessage, author }, author },
      metadata,
    });
  }

  /**
   * Build an onStepFinish callback that translates agent steps
   * into pipeline.cli_message events (CLIMessage format).
   */
  createStepCallback(
    requestId: string,
    agentName: string,
    metadata?: Record<string, unknown>,
  ): (step: StepInfo) => Promise<void> {
    let msgCounter = 0;

    return async (step: StepInfo) => {
      const msgId = `${agentName}-msg-${++msgCounter}`;

      logger.info(
        {
          requestId,
          agent: agentName,
          stepNumber: step.stepNumber,
          hasText: !!step.text,
          textLen: step.text?.length ?? 0,
          toolCalls: step.toolCalls?.length ?? 0,
          toolCallNames: step.toolCalls?.map((tc) => tc.function.name) ?? [],
          toolResults: step.toolResults?.length ?? 0,
          finishReason: step.finishReason,
        },
        'onStepFinish fired',
      );

      try {
        const contentBlocks: Array<Record<string, unknown>> = [];

        if (step.text) {
          contentBlocks.push({ type: 'text', text: step.text });
        }

        if (step.toolCalls && step.toolCalls.length > 0) {
          for (const tc of step.toolCalls) {
            contentBlocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments),
            });
          }
        }

        if (contentBlocks.length > 0) {
          await this.emitMessage(requestId, {
            type: 'assistant',
            message: { id: msgId, content: contentBlocks },
          }, metadata, agentName);
        }

        if (step.toolResults && step.toolResults.length > 0) {
          const resultBlocks = step.toolResults.map((tr) => ({
            type: 'tool_result',
            tool_use_id: tr.toolCallId,
            content: tr.result,
          }));

          await this.emitMessage(requestId, {
            type: 'user',
            message: { content: resultBlocks },
          }, metadata, agentName);
        }
      } catch (err: any) {
        logger.error({ err: err.message, requestId, agent: agentName }, 'Failed to emit CLI step messages');
      }
    };
  }
}
