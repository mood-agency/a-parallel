/**
 * SDKClaudeProcess — adapter that wraps @anthropic-ai/claude-agent-sdk query()
 * behind the IClaudeProcess EventEmitter interface.
 *
 * Drop-in replacement for the former ClaudeProcess (CLI subprocess).
 * AgentRunner and AgentMessageHandler work unchanged.
 */

import { EventEmitter } from 'events';
import { query, AbortError } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage, HookCallback } from '@anthropic-ai/claude-agent-sdk';
import type { CLIMessage, ClaudeProcessOptions } from './claude-types.js';

export class SDKClaudeProcess extends EventEmitter {
  private abortController = new AbortController();
  private _exited = false;

  constructor(private options: ClaudeProcessOptions) {
    super();
  }

  // ── IClaudeProcess API ──────────────────────────────────────────

  start(): void {
    this.runQuery().catch((err) => {
      if (!this._exited) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async kill(): Promise<void> {
    this.abortController.abort();
  }

  get exited(): boolean {
    return this._exited;
  }

  // ── Internal ────────────────────────────────────────────────────

  private async runQuery(): Promise<void> {
    const promptInput = this.buildPromptInput();

    const sdkOptions: Record<string, any> = {
      model: this.options.model,
      cwd: this.options.cwd,
      maxTurns: this.options.maxTurns,
      abortController: this.abortController,
      allowedTools: this.options.allowedTools,
      disallowedTools: this.options.disallowedTools,
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      tools: { type: 'preset', preset: 'claude_code' },
      settingSources: ['user', 'project'],
      hooks: {
        PreToolUse: [{
          matcher: '.*',
          hooks: [this.preToolUseHook.bind(this) as HookCallback],
        }],
      },
      stderr: (data: string) => {
        console.error('[sdk-claude-process:stderr]', data.trimEnd());
      },
    };

    if (this.options.sessionId) {
      sdkOptions.resume = this.options.sessionId;
    }

    if (this.options.permissionMode) {
      sdkOptions.permissionMode = this.options.permissionMode;
    }

    const gen = query({ prompt: promptInput, options: sdkOptions });

    try {
      for await (const sdkMsg of gen) {
        if (this.abortController.signal.aborted) break;

        const cliMsg = this.translateMessage(sdkMsg);
        if (cliMsg) {
          this.emit('message', cliMsg);
        }
      }
    } catch (err: any) {
      if (err instanceof AbortError || this.abortController.signal.aborted) {
        // Normal cancellation — not an error
      } else {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      this._exited = true;
      this.emit('exit', this.abortController.signal.aborted ? null : 0);
    }
  }

  // ── Prompt building ─────────────────────────────────────────────

  private buildPromptInput(): string | AsyncIterable<any> {
    if (!this.options.images?.length) {
      return this.options.prompt;
    }
    return this.createImagePrompt();
  }

  private async *createImagePrompt(): AsyncGenerator<any, void, unknown> {
    yield {
      type: 'user',
      session_id: '',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: this.options.prompt },
          ...this.options.images!,
        ],
      },
      parent_tool_use_id: null,
    };
  }

  // ── PreToolUse hook ─────────────────────────────────────────────

  private async preToolUseHook(
    input: any,
    _toolUseID: string | undefined,
    { signal }: { signal: AbortSignal },
  ): Promise<any> {
    const toolName: string = input.tool_name ?? '';

    // For AskUserQuestion / ExitPlanMode: hold the hook until the process
    // is killed. The message handler already sets the thread to "waiting"
    // when it sees the tool_use block. When the user answers, AgentRunner
    // kills this process and starts a new one with session resume.
    if (toolName === 'AskUserQuestion' || toolName === 'ExitPlanMode') {
      return new Promise<any>((resolve) => {
        const onAbort = () => {
          resolve({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: 'Session will resume with user input',
            },
          });
        };
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      });
    }

    // Auto-allow all other tools
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    };
  }

  // ── Message translation ─────────────────────────────────────────

  private translateMessage(sdkMsg: SDKMessage): CLIMessage | null {
    switch (sdkMsg.type) {
      case 'system':
        if ('subtype' in sdkMsg && sdkMsg.subtype === 'init') {
          return {
            type: 'system',
            subtype: 'init',
            session_id: (sdkMsg as any).session_id,
            tools: (sdkMsg as any).tools,
            model: (sdkMsg as any).model,
            cwd: (sdkMsg as any).cwd,
          };
        }
        return null;

      case 'assistant':
        return {
          type: 'assistant',
          message: (sdkMsg as any).message,
          parent_tool_use_id: (sdkMsg as any).parent_tool_use_id,
        };

      case 'user': {
        const raw = sdkMsg as any;
        if (!raw.message?.content) return null;
        // Ensure tool_result content is always a string
        const content = raw.message.content.map((block: any) => {
          if (block.type === 'tool_result' && typeof block.content !== 'string') {
            return { ...block, content: JSON.stringify(block.content) };
          }
          return block;
        });
        return {
          type: 'user',
          message: { ...raw.message, content },
        };
      }

      case 'result': {
        const r = sdkMsg as any;
        return {
          type: 'result',
          subtype: r.subtype,
          is_error: r.is_error,
          duration_ms: r.duration_ms,
          num_turns: r.num_turns,
          result: r.result,
          total_cost_usd: r.total_cost_usd,
          session_id: r.session_id,
          errors: r.errors,
        };
      }

      default:
        // stream_event, compact_boundary, hook_*, etc. — skip
        return null;
    }
  }
}
