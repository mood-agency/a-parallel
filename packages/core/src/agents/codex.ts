/**
 * CodexProcess — adapter that wraps @openai/codex-sdk behind the
 * IAgentProcess EventEmitter interface.
 *
 * Translates Codex SDK events into CLIMessage format so that
 * AgentMessageHandler works unchanged (same as SDKClaudeProcess).
 *
 * Uses dynamic import so the server doesn't crash if @openai/codex-sdk
 * is not installed.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { CLIMessage, ClaudeProcessOptions } from './types.js';

// Lazy-loaded SDK types (avoid crash if not installed)
type CodexSDK = typeof import('@openai/codex-sdk');
type CodexInstance = import('@openai/codex-sdk').Codex;
type CodexThread = Awaited<ReturnType<CodexInstance['startThread']>>;

export class CodexProcess extends EventEmitter {
  private abortController = new AbortController();
  private _exited = false;
  private threadId: string | null = null;

  constructor(private options: ClaudeProcessOptions) {
    super();
  }

  // ── IAgentProcess API ─────────────────────────────────────────

  start(): void {
    this.runCodex().catch((err) => {
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

  // ── Internal ──────────────────────────────────────────────────

  private async runCodex(): Promise<void> {
    // Dynamic import — fails gracefully if SDK not installed
    let SDK: CodexSDK;
    try {
      SDK = await import('@openai/codex-sdk');
    } catch {
      throw new Error('Codex SDK not installed. Run: npm install @openai/codex-sdk');
    }

    const { Codex } = SDK;

    const codexConfig: Record<string, any> = {};
    if (this.options.model) {
      codexConfig.model = this.options.model;
    }

    const codex = new Codex({ config: codexConfig });

    // Start or resume a thread
    let thread: CodexThread;
    const isResume = !!this.options.sessionId;

    if (isResume) {
      thread = codex.resumeThread(this.options.sessionId!);
    } else {
      thread = codex.startThread({
        workingDirectory: this.options.cwd,
        skipGitRepoCheck: true,
      });
    }

    // Generate a session ID (Codex threads persist to disk at ~/.codex/sessions)
    const sessionId = this.options.sessionId ?? randomUUID();
    this.threadId = sessionId;

    // Emit init message (mirrors Claude's system:init)
    const initMsg: CLIMessage = {
      type: 'system',
      subtype: 'init',
      session_id: sessionId,
      tools: [],
      model: this.options.model ?? 'o4-mini',
      cwd: this.options.cwd,
    };
    this.emit('message', initMsg);

    const startTime = Date.now();
    let totalCost = 0;
    let numTurns = 0;
    let lastResult = '';
    const assistantMsgId = randomUUID();

    try {
      const { events } = await thread.runStreamed(this.options.prompt);

      for await (const event of events) {
        if (this.abortController.signal.aborted) break;

        switch (event.type) {
          case 'item.completed': {
            const item = (event as any).item;
            if (!item) break;

            // Translate Codex items to CLIMessage format
            const cliMsg = this.translateItem(item, assistantMsgId);
            if (cliMsg) {
              this.emit('message', cliMsg);
            }

            // Extract text for the final result
            if (item.type === 'message' && item.role === 'assistant') {
              const text = this.extractText(item);
              if (text) lastResult = text;
            }
            break;
          }

          case 'turn.completed': {
            numTurns++;
            const usage = (event as any).usage;
            if (usage) {
              // Estimate cost based on token usage (rough approximation)
              const inputTokens = usage.input_tokens ?? 0;
              const outputTokens = usage.output_tokens ?? 0;
              // Codex pricing is similar to GPT-4o class
              totalCost += (inputTokens * 0.0025 + outputTokens * 0.01) / 1000;
            }
            break;
          }
        }
      }

      // Emit result message
      const resultMsg: CLIMessage = {
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: Date.now() - startTime,
        num_turns: numTurns,
        result: lastResult || undefined,
        total_cost_usd: totalCost,
        session_id: sessionId,
      };
      this.emit('message', resultMsg);

    } catch (err: any) {
      if (this.abortController.signal.aborted) {
        // Normal cancellation — not an error
      } else {
        // Emit a failed result
        const resultMsg: CLIMessage = {
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          duration_ms: Date.now() - startTime,
          num_turns: numTurns,
          result: err.message,
          total_cost_usd: totalCost,
          session_id: sessionId,
          errors: [err.message],
        };
        this.emit('message', resultMsg);
      }
    } finally {
      this._exited = true;
      this.emit('exit', this.abortController.signal.aborted ? null : 0);
    }
  }

  // ── Item translation ──────────────────────────────────────────

  private translateItem(item: any, assistantMsgId: string): CLIMessage | null {
    if (!item) return null;

    // Assistant message with text
    if (item.type === 'message' && item.role === 'assistant') {
      const text = this.extractText(item);
      if (!text) return null;

      return {
        type: 'assistant',
        message: {
          id: assistantMsgId,
          content: [{ type: 'text', text }],
        },
      };
    }

    // Function/tool call
    if (item.type === 'function_call' || item.type === 'tool_call') {
      const toolUseId = item.id ?? item.call_id ?? randomUUID();
      const name = item.name ?? item.function?.name ?? 'unknown';
      let input: unknown = {};

      try {
        const args = item.arguments ?? item.function?.arguments;
        input = typeof args === 'string' ? JSON.parse(args) : (args ?? {});
      } catch {
        input = { raw: item.arguments ?? '' };
      }

      // Emit as assistant message with tool_use block
      return {
        type: 'assistant',
        message: {
          id: randomUUID(),
          content: [{ type: 'tool_use', id: toolUseId, name, input }],
        },
      };
    }

    // Function/tool call output
    if (item.type === 'function_call_output' || item.type === 'tool_result') {
      const toolUseId = item.call_id ?? item.tool_use_id ?? '';
      const output = typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '');

      return {
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: output,
          }],
        },
      };
    }

    return null;
  }

  /** Extract text content from a Codex message item. */
  private extractText(item: any): string | null {
    if (typeof item.content === 'string') return item.content;
    if (Array.isArray(item.content)) {
      const texts = item.content
        .filter((c: any) => c.type === 'output_text' || c.type === 'text')
        .map((c: any) => c.text ?? c.content ?? '')
        .filter(Boolean);
      return texts.length > 0 ? texts.join('\n\n') : null;
    }
    return null;
  }
}
