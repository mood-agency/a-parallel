import type { IThreadManager, IWSBroker, IClaudeProcess } from './interfaces.js';
import type { WSEvent } from '@a-parallel/shared';
import type { AgentStateTracker } from './agent-state.js';

/**
 * Handles Control Protocol requests from Claude CLI processes —
 * tool approval hooks and can_use_tool permission checks.
 */
export class AgentControlHandler {
  constructor(
    private state: AgentStateTracker,
    private threadManager: IThreadManager,
    private wsBroker: IWSBroker,
  ) {}

  private emitWS(threadId: string, type: WSEvent['type'], data: unknown): void {
    const event = { type, threadId, data } as WSEvent;
    const thread = this.threadManager.getThread(threadId);
    const userId = thread?.userId;
    if (userId) {
      this.wsBroker.emitToUser(userId, event);
    } else {
      this.wsBroker.emit(event);
    }
  }

  handle(threadId: string, msg: any, process: IClaudeProcess): void {
    const subtype = msg.request?.subtype;

    // Handle hook_callback for tool approval
    if (subtype === 'hook_callback' && msg.request.callback_id === 'tool_approval') {
      this.handleToolApproval(threadId, msg, process);
      return;
    }

    // Handle can_use_tool requests (permission check)
    if (subtype === 'can_use_tool') {
      this.handleCanUseTool(threadId, msg, process);
      return;
    }

    // Unhandled request type
    console.log(`[agent] Unhandled control request subtype=${subtype} thread=${threadId}`);
  }

  private handleToolApproval(threadId: string, msg: any, process: IClaudeProcess): void {
    const toolName = msg.request.input?.tool_name || msg.request.input?.tool || 'Unknown';
    console.log(`[agent] hook_callback tool_approval: ${toolName} thread=${threadId}`);

    if (toolName === 'AskUserQuestion') {
      console.log(`[agent] Intercepted AskUserQuestion - pausing for user input`);
      this.state.pendingUserInput.set(threadId, 'question');
      const toolUseId = msg.request.input?.tool_use_id;
      if (toolUseId) {
        this.state.lastToolUseId.set(threadId, toolUseId);
      }
    } else if (toolName === 'ExitPlanMode') {
      console.log(`[agent] Intercepted ExitPlanMode - pausing for user input`);
      this.state.pendingUserInput.set(threadId, 'plan');
      const toolUseId = msg.request.input?.tool_use_id;
      if (toolUseId) {
        this.state.lastToolUseId.set(threadId, toolUseId);
      }
    }

    // Always ALLOW the tool
    const response = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: msg.request_id,
        response: { behavior: 'allow' }
      }
    };
    process.sendControlResponse(response);
  }

  private handleCanUseTool(threadId: string, msg: any, process: IClaudeProcess): void {
    const toolName = msg.request.tool_name || 'Unknown';
    console.log(`[agent] can_use_tool: ${toolName} thread=${threadId}`);

    // For AskUserQuestion or ExitPlanMode, DON'T respond yet — wait for the user's answer
    if (toolName === 'AskUserQuestion' || toolName === 'ExitPlanMode') {
      console.log(`[agent] Holding can_use_tool for ${toolName} — waiting for user answer`);
      this.state.pendingCanUseTool.set(threadId, {
        requestId: msg.request_id,
        process,
        input: msg.request.input,
      });

      const waitingReason = this.state.pendingUserInput.get(threadId) ?? (toolName === 'ExitPlanMode' ? 'plan' : 'question');
      this.threadManager.updateThread(threadId, { status: 'waiting' });
      this.emitWS(threadId, 'agent:status', { status: 'waiting', waitingReason });
      return;
    }

    // For all other tools, allow immediately
    const response = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: msg.request_id,
        response: { behavior: 'allow', updatedInput: msg.request.input }
      }
    };
    process.sendControlResponse(response);
  }
}
