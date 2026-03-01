/**
 * @domain context: Agent Execution
 * @domain type: handler
 * @domain layer: application
 * @domain consumes: agent:completed
 * @domain depends: MessageQueue, AgentRunner
 *
 * Drains the message queue when an agent completes, fails, or is stopped.
 * If the project uses queue mode and there's a queued message, it auto-starts
 * the agent with the next message in the queue.
 */

import type { AgentCompletedEvent } from '../thread-event-bus.js';
import type { EventHandler } from './types.js';

export const agentCompletedQueueHandler: EventHandler<'agent:completed'> = {
  name: 'drain-message-queue-on-completion',
  event: 'agent:completed',

  async action(event: AgentCompletedEvent, ctx) {
    const { threadId } = event;

    const thread = ctx.getThread(threadId);
    if (!thread) return;

    const project = ctx.getProject(thread.projectId);
    if (!project || (project.followUpMode ?? 'interrupt') !== 'queue') return;

    const next = ctx.dequeueMessage(threadId);
    if (!next) return;

    ctx.log(`Auto-sending queued message for thread ${threadId} (messageId: ${next.id})`);

    const effectiveCwd = thread.worktreePath ?? project.path;

    try {
      await ctx.startAgent(
        threadId,
        next.content,
        effectiveCwd,
        next.model || thread.model || 'sonnet',
        next.permissionMode || thread.permissionMode || 'autoEdit',
        next.images ? JSON.parse(next.images) : undefined,
        next.disallowedTools ? JSON.parse(next.disallowedTools) : undefined,
        next.allowedTools ? JSON.parse(next.allowedTools) : undefined,
        next.provider || thread.provider || 'claude',
      );

      // Emit updated queue count
      const remaining = ctx.queueCount(threadId);
      const peekNext = ctx.peekMessage(threadId);
      ctx.emitToUser(thread.userId, {
        type: 'thread:queue_update',
        threadId,
        data: {
          threadId,
          queuedCount: remaining,
          nextMessage: peekNext?.content?.slice(0, 100),
        },
      });
    } catch (err: any) {
      ctx.log(`Failed to auto-send queued message for thread ${threadId}: ${err.message}`);
    }
  },
};
