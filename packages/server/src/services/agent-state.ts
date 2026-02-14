import type { WaitingReason } from '@a-parallel/shared';
import type { IClaudeProcess } from './interfaces.js';

/**
 * Tracks per-thread in-memory state for running agents.
 * Centralizes all the Maps that agent-runner previously owned.
 */
export class AgentStateTracker {
  /** Active running agent processes */
  readonly activeAgents = new Map<string, IClaudeProcess>();

  /** Threads that received a result message before exit */
  readonly resultReceived = new Set<string>();

  /** Threads that were manually stopped */
  readonly manuallyStopped = new Set<string>();

  /** Current assistant message DB ID per thread */
  readonly currentAssistantMsgId = new Map<string, string>();

  /**
   * CLI tool_use block IDs → our DB toolCallId per thread.
   * Preserved across session resume to deduplicate re-sent content.
   */
  readonly processedToolUseIds = new Map<string, Map<string, string>>();

  /**
   * CLI message IDs → our DB message IDs per thread.
   * Preserved across session resume.
   */
  readonly cliToDbMsgId = new Map<string, Map<string, string>>();

  /** Threads waiting for user input (AskUserQuestion / ExitPlanMode) */
  readonly pendingUserInput = new Map<string, WaitingReason>();

  /** Pending permission requests per thread */
  readonly pendingPermissionRequest = new Map<string, { toolName: string; toolUseId: string }>();

  /** ID of the last tool use for AskUserQuestion */
  readonly lastToolUseId = new Map<string, string>();

  /** Pending can_use_tool requests waiting for user answer */
  readonly pendingCanUseTool = new Map<string, { requestId: string; process: IClaudeProcess; input: any }>();

  /**
   * Clear stale state when starting a new agent run.
   * processedToolUseIds and cliToDbMsgId are intentionally preserved
   * across sessions to deduplicate re-sent content on --resume.
   */
  clearRunState(threadId: string): void {
    this.currentAssistantMsgId.delete(threadId);
    this.resultReceived.delete(threadId);
    this.manuallyStopped.delete(threadId);
    this.pendingUserInput.delete(threadId);
  }

  /** Completely remove all in-memory state for a thread. */
  cleanupThread(threadId: string): void {
    this.activeAgents.delete(threadId);
    this.resultReceived.delete(threadId);
    this.manuallyStopped.delete(threadId);
    this.currentAssistantMsgId.delete(threadId);
    this.processedToolUseIds.delete(threadId);
    this.cliToDbMsgId.delete(threadId);
    this.pendingUserInput.delete(threadId);
    this.pendingPermissionRequest.delete(threadId);
    this.lastToolUseId.delete(threadId);
    this.pendingCanUseTool.delete(threadId);
  }
}
