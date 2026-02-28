/**
 * Git Status handler — emits git status via WebSocket when file-modifying
 * tools are executed, ensuring the UI stays in sync with git state.
 *
 * Fully decoupled: uses HandlerServiceContext for all git operations
 * instead of importing @funny/core/git directly.
 *
 * Uses per-thread debouncing to avoid flooding getStatusSummary() when
 * an agent writes many files in quick succession.
 */

import { invalidateStatusCache } from '@funny/core/git';

import type { GitChangedEvent } from '../thread-event-bus.js';
import type { EventHandler, HandlerServiceContext } from './types.js';

// Per-thread debounce state
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 500;

export const gitStatusHandler: EventHandler<'git:changed'> = {
  name: 'emit-git-status-on-change',
  event: 'git:changed',

  // Only emit for worktree threads
  filter(event: GitChangedEvent) {
    return event.worktreePath !== null;
  },

  action(event: GitChangedEvent, ctx) {
    const { threadId } = event;

    // Clear any pending timer for this thread
    const existing = pendingTimers.get(threadId);
    if (existing) clearTimeout(existing);

    // Schedule the actual work after debounce period
    pendingTimers.set(
      threadId,
      setTimeout(() => {
        pendingTimers.delete(threadId);
        emitGitStatus(event, ctx);
      }, DEBOUNCE_MS),
    );
  },
};

async function emitGitStatus(event: GitChangedEvent, ctx: HandlerServiceContext) {
  const { threadId, worktreePath, userId } = event;

  if (!worktreePath) return;

  const thread = ctx.getThread(threadId);
  if (!thread) return;

  const project = ctx.getProject(thread.projectId);
  if (!project) return;

  ctx.log(`Emitting git status for thread ${threadId} (debounced, tool: ${event.toolName})`);

  // Invalidate core-level cache so we get fresh data after the file modification
  invalidateStatusCache(worktreePath);

  const summaryResult = await ctx.getGitStatusSummary(
    worktreePath,
    thread.baseBranch ?? undefined,
    project.path,
  );

  if (summaryResult.isErr()) {
    ctx.log(`Failed to get git status for thread ${threadId}: ${String(summaryResult.error)}`);
    return;
  }

  const summary = summaryResult.value;

  // Invalidate the HTTP cache so subsequent fetches don't return stale data
  ctx.invalidateGitStatusCache(project.id);

  ctx.emitToUser(userId, {
    type: 'git:status',
    threadId,
    data: {
      statuses: [
        {
          threadId,
          state: ctx.deriveGitSyncState(summary),
          ...summary,
        },
      ],
    },
  });
}

/** Clear pending debounce timer for a thread (e.g. on thread deletion). */
export function clearGitStatusDebounce(threadId: string): void {
  const timer = pendingTimers.get(threadId);
  if (timer) {
    clearTimeout(timer);
    pendingTimers.delete(threadId);
  }
}
