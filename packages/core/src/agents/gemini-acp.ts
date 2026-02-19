/**
 * GeminiACPProcess — adapter that wraps the Gemini CLI behind the
 * IAgentProcess EventEmitter interface, communicating via the
 * Agent Client Protocol (ACP) over stdio.
 *
 * Spawns `gemini --experimental-acp` as a subprocess and translates
 * ACP session updates into CLIMessage format so that AgentMessageHandler
 * works unchanged (same as SDKClaudeProcess and CodexProcess).
 *
 * Uses dynamic import of @agentclientprotocol/sdk so the server doesn't
 * crash if the SDK is not installed.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { spawn, type ChildProcess } from 'child_process';
import { Readable, Writable } from 'stream';
import type { CLIMessage, ClaudeProcessOptions } from './types.js';

// Lazy-loaded SDK types (avoid crash if not installed)
type ACPSDK = typeof import('@agentclientprotocol/sdk');
type ACPClient = import('@agentclientprotocol/sdk').Client;
type ACPAgent = import('@agentclientprotocol/sdk').Agent;
type ACPSessionNotification = import('@agentclientprotocol/sdk').SessionNotification;
type ACPSessionUpdate = import('@agentclientprotocol/sdk').SessionUpdate;
type ACPRequestPermissionRequest = import('@agentclientprotocol/sdk').RequestPermissionRequest;
type ACPRequestPermissionResponse = import('@agentclientprotocol/sdk').RequestPermissionResponse;

export class GeminiACPProcess extends EventEmitter {
  private abortController = new AbortController();
  private _exited = false;
  private childProcess: ChildProcess | null = null;

  constructor(private options: ClaudeProcessOptions) {
    super();
  }

  // ── IAgentProcess API ─────────────────────────────────────────

  start(): void {
    this.runGemini().catch((err) => {
      if (!this._exited) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async kill(): Promise<void> {
    this.abortController.abort();
    if (this.childProcess && !this.childProcess.killed) {
      this.childProcess.kill('SIGTERM');
    }
  }

  get exited(): boolean {
    return this._exited;
  }

  // ── Internal ──────────────────────────────────────────────────

  private async runGemini(): Promise<void> {
    // Dynamic import — fails gracefully if SDK not installed
    let SDK: ACPSDK;
    try {
      SDK = await import('@agentclientprotocol/sdk');
    } catch {
      throw new Error(
        'ACP SDK not installed. Run: bun add @agentclientprotocol/sdk\n' +
        'Also ensure gemini-cli is installed: npm install -g @anthropic-ai/gemini-cli or see https://github.com/google-gemini/gemini-cli',
      );
    }

    const { ClientSideConnection, ndJsonStream } = SDK;

    // Resolve Gemini binary
    const geminiBin = this.resolveGeminiBinary();

    // Build CLI args
    const args = ['--experimental-acp'];
    if (this.options.model) {
      args.push('--model', this.options.model);
    }

    // Spawn gemini subprocess with stdio pipes
    const child = spawn(geminiBin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.options.cwd,
      env: { ...process.env },
      signal: this.abortController.signal,
    });

    this.childProcess = child;

    // Handle process errors
    child.on('error', (err) => {
      if (!this._exited && !this.abortController.signal.aborted) {
        this.emit('error', err);
      }
    });

    // Pipe stderr to console for debugging
    child.stderr?.on('data', (data: Buffer) => {
      console.error('[gemini-acp:stderr]', data.toString());
    });

    // Convert Node streams to Web streams for ACP SDK
    const outputStream = Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>;
    const inputStream = Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>;

    // Create ACP NDJSON stream
    const stream = ndJsonStream(outputStream, inputStream);

    const sessionId = this.options.sessionId ?? randomUUID();
    const startTime = Date.now();
    let numTurns = 0;
    let totalCost = 0;
    let lastAssistantText = '';
    const assistantMsgId = randomUUID();

    // Track tool calls for deduplication
    const toolCallsSeen = new Map<string, boolean>();

    // Create ACP client implementation
    const acpClient: ACPClient = {
      // Handle streaming session updates from the agent
      sessionUpdate: async (params: ACPSessionNotification): Promise<void> => {
        if (this.abortController.signal.aborted) return;

        const update = params.update;
        this.translateUpdate(update, assistantMsgId, toolCallsSeen);
      },

      // Auto-allow all permission requests (matches autoEdit behavior)
      requestPermission: async (params: ACPRequestPermissionRequest): Promise<ACPRequestPermissionResponse> => {
        // Find the first "allow" option
        const allowOption = params.options.find(
          (opt) => opt.kind === 'allow_once' || opt.kind === 'allow_always',
        );

        if (allowOption) {
          return {
            outcome: {
              outcome: 'selected',
              optionId: allowOption.optionId,
            },
          };
        }

        // Fallback — allow the first option
        return {
          outcome: {
            outcome: 'selected',
            optionId: params.options[0]?.optionId ?? '',
          },
        };
      },
    };

    // Create client-side ACP connection
    const connection = new ClientSideConnection(
      (_agent: ACPAgent) => acpClient,
      stream,
    );

    // Emit init message (mirrors Claude's system:init)
    const initMsg: CLIMessage = {
      type: 'system',
      subtype: 'init',
      session_id: sessionId,
      tools: [],
      model: this.options.model ?? 'gemini-3-flash',
      cwd: this.options.cwd,
    };
    this.emit('message', initMsg);

    try {
      // Step 1: Initialize the ACP connection
      await connection.initialize({
        protocolVersion: 1,
        clientInfo: { name: 'funny', version: '1.0.0' },
        clientCapabilities: {},
      });

      // Step 2: Create a new session
      const sessionResponse = await connection.newSession({
        cwd: this.options.cwd,
        mcpServers: [],
      });

      // Step 3: Send the prompt
      const promptResponse = await connection.prompt({
        sessionId: sessionResponse.sessionId,
        prompt: [{ type: 'text', text: this.options.prompt }],
      });

      // Extract usage if available
      if (promptResponse.usage) {
        const u = promptResponse.usage;
        // Rough Gemini pricing estimate
        const inputTokens = u.inputTokens ?? 0;
        const outputTokens = u.outputTokens ?? 0;
        totalCost = (inputTokens * 0.00025 + outputTokens * 0.001) / 1000;
      }

      numTurns = 1;

      // Map stop reason
      const subtype = promptResponse.stopReason === 'end_turn'
        ? 'success' as const
        : promptResponse.stopReason === 'cancelled'
          ? 'error_during_execution' as const
          : promptResponse.stopReason === 'max_tokens'
            ? 'error_max_turns' as const
            : 'success' as const;

      // Emit result message
      const resultMsg: CLIMessage = {
        type: 'result',
        subtype,
        is_error: subtype !== 'success',
        duration_ms: Date.now() - startTime,
        num_turns: numTurns,
        result: lastAssistantText || undefined,
        total_cost_usd: totalCost,
        session_id: sessionId,
      };
      this.emit('message', resultMsg);

    } catch (err: any) {
      if (this.abortController.signal.aborted) {
        // Normal cancellation — not an error
      } else {
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
      // Clean up child process
      if (this.childProcess && !this.childProcess.killed) {
        this.childProcess.kill('SIGTERM');
      }
      this.emit('exit', this.abortController.signal.aborted ? null : 0);
    }
  }

  // ── Update translation ──────────────────────────────────────

  private translateUpdate(
    update: ACPSessionUpdate,
    assistantMsgId: string,
    toolCallsSeen: Map<string, boolean>,
  ): void {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        // Text content from the agent
        const content = update.content;
        if (content.type === 'text' && content.text) {
          const msg: CLIMessage = {
            type: 'assistant',
            message: {
              id: assistantMsgId,
              content: [{ type: 'text', text: content.text }],
            },
          };
          this.emit('message', msg);
        }
        break;
      }

      case 'agent_thought_chunk': {
        // Thought/reasoning content — emit as assistant text
        const content = update.content;
        if (content.type === 'text' && content.text) {
          const msg: CLIMessage = {
            type: 'assistant',
            message: {
              id: assistantMsgId,
              content: [{ type: 'text', text: content.text }],
            },
          };
          this.emit('message', msg);
        }
        break;
      }

      case 'tool_call': {
        // New tool call from the agent
        const toolCallId = update.toolCallId;
        if (toolCallsSeen.has(toolCallId)) break;
        toolCallsSeen.set(toolCallId, true);

        const msg: CLIMessage = {
          type: 'assistant',
          message: {
            id: randomUUID(),
            content: [{
              type: 'tool_use',
              id: toolCallId,
              name: update.title || 'tool',
              input: update.rawInput ?? {},
            }],
          },
        };
        this.emit('message', msg);
        break;
      }

      case 'tool_call_update': {
        // Tool call result/update
        const toolCallId = update.toolCallId;

        if (update.status === 'completed' || update.status === 'failed') {
          // Emit as tool result
          const output = update.rawOutput != null
            ? (typeof update.rawOutput === 'string'
              ? update.rawOutput
              : JSON.stringify(update.rawOutput))
            : update.title ?? '';

          const msg: CLIMessage = {
            type: 'user',
            message: {
              content: [{
                type: 'tool_result',
                tool_use_id: toolCallId,
                content: output,
              }],
            },
          };
          this.emit('message', msg);
        }
        break;
      }

      case 'plan': {
        // Plan update — format as assistant text
        const entries = update.entries ?? [];
        if (entries.length > 0) {
          const planText = entries
            .map((e: any, i: number) => {
              const status = e.status === 'completed' ? '[x]'
                : e.status === 'in_progress' ? '[~]'
                  : '[ ]';
              return `${status} ${i + 1}. ${e.title ?? e.description ?? 'Task'}`;
            })
            .join('\n');

          const msg: CLIMessage = {
            type: 'assistant',
            message: {
              id: assistantMsgId,
              content: [{ type: 'text', text: `**Plan:**\n${planText}` }],
            },
          };
          this.emit('message', msg);
        }
        break;
      }

      // Ignore other update types (available_commands_update, current_mode_update, etc.)
      default:
        break;
    }
  }

  // ── Binary resolution ───────────────────────────────────────

  private resolveGeminiBinary(): string {
    // 1. GEMINI_BINARY_PATH env var
    const envPath = process.env.GEMINI_BINARY_PATH;
    if (envPath) return envPath;

    // 2. ACP_GEMINI_BIN env var (Python SDK convention)
    const acpEnvPath = process.env.ACP_GEMINI_BIN;
    if (acpEnvPath) return acpEnvPath;

    // 3. Default to 'gemini' in PATH
    return 'gemini';
  }
}
