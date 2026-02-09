import { wsBroker } from './ws-broker.js';
import * as tm from './thread-manager.js';
import type { WSEvent, ClaudeModel, PermissionMode, WaitingReason } from '@a-parallel/shared';
import {
  ClaudeProcess,
  type CLIMessage,
} from './claude-process.js';

// Active running agents (in-memory only)
const activeAgents = new Map<string, ClaudeProcess>();

function emitWS(threadId: string, type: WSEvent['type'], data: unknown) {
  wsBroker.emit({ type, threadId, data });
}

const PERMISSION_MAP: Record<PermissionMode, string> = {
  plan: 'plan',
  autoEdit: 'acceptEdits',
  confirmEdit: 'default',
};

const MODEL_MAP: Record<ClaudeModel, string> = {
  sonnet: 'claude-sonnet-4-5-20250929',
  opus: 'claude-opus-4-6',
  haiku: 'claude-haiku-4-5-20251001',
};

// ── Message handler ────────────────────────────────────────────────

/**
 * Track whether we received a result message before the process exited.
 * Keyed by threadId.
 */
const resultReceived = new Set<string>();

/**
 * Track threads that were manually stopped so the exit handler
 * doesn't overwrite the 'stopped' status with 'failed'.
 */
const manuallyStopped = new Set<string>();

/**
 * Track the current assistant message DB ID per thread.
 * The CLI sends multiple `assistant` messages during streaming, each with
 * the FULL content so far (not deltas). We upsert a single DB row and
 * send a stable messageId to the client so it can replace instead of append.
 */
const currentAssistantMsgId = new Map<string, string>();

/**
 * Track tool_use block IDs that have already been processed per thread.
 * The CLI streams cumulative content, so the same tool_use blocks appear
 * in multiple assistant messages. We deduplicate using the CLI's block ID.
 * Maps threadId → (cliToolUseId → our toolCallId) for matching tool results.
 */
const processedToolUseIds = new Map<string, Map<string, string>>();

/**
 * Map CLI message IDs to our DB message IDs per thread.
 * The CLI sends the same assistant message multiple times (cumulative streaming).
 * After a tool_use deletes currentAssistantMsgId, we still need to find the
 * DB message for the same CLI message to avoid creating duplicates.
 * Maps threadId → (cliMessageId → dbMessageId).
 */
const cliToDbMsgId = new Map<string, Map<string, string>>();

/**
 * Track threads where the last tool call was AskUserQuestion or ExitPlanMode.
 * When the result arrives for these threads, we use 'waiting' status instead
 * of 'completed' because Claude is waiting for user input.
 * The value stores the reason so the client can differentiate UI.
 */
const pendingUserInput = new Map<string, WaitingReason>();

/**
 * Decode literal Unicode escape sequences (\uXXXX) that may appear
 * in CLI output when the text was double-encoded or the CLI emits
 * escaped Unicode instead of raw UTF-8 characters.
 */
function decodeUnicodeEscapes(str: string): string {
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

function handleCLIMessage(threadId: string, msg: CLIMessage): void {
  // System init — capture session ID and broadcast init info
  if (msg.type === 'system' && 'subtype' in msg && msg.subtype === 'init') {
    console.log(`[agent] init session=${msg.session_id} thread=${threadId}`);
    tm.updateThread(threadId, { sessionId: msg.session_id });

    emitWS(threadId, 'agent:init', {
      tools: msg.tools ?? [],
      cwd: msg.cwd ?? '',
      model: msg.model ?? '',
    });
    return;
  }

  // Assistant messages — text and tool calls
  if (msg.type === 'assistant') {
    const cliMsgId = msg.message.id; // stable across cumulative streaming updates

    // Get or init the CLI→DB message ID map for this thread
    const cliMap = cliToDbMsgId.get(threadId) ?? new Map<string, string>();
    cliToDbMsgId.set(threadId, cliMap);

    // Combine all text blocks into a single string
    const textContent = decodeUnicodeEscapes(
      msg.message.content
        .filter((b): b is { type: 'text'; text: string } => 'text' in b && !!b.text)
        .map((b) => b.text)
        .join('\n\n')
    );

    if (textContent) {
      // Reuse existing DB message: first check currentAssistantMsgId, then CLI map
      let msgId = currentAssistantMsgId.get(threadId) || cliMap.get(cliMsgId);
      if (msgId) {
        // Update existing row (streaming update — same turn, fuller content)
        tm.updateMessage(msgId, textContent);
      } else {
        // First text for this turn — insert new row
        msgId = tm.insertMessage({ threadId, role: 'assistant', content: textContent });
      }
      currentAssistantMsgId.set(threadId, msgId);
      cliMap.set(cliMsgId, msgId);

      emitWS(threadId, 'agent:message', {
        messageId: msgId,
        role: 'assistant',
        content: textContent,
      });
    }

    // Handle tool calls (deduplicate — streaming sends cumulative content)
    const seen = processedToolUseIds.get(threadId) ?? new Map<string, string>();
    for (const block of msg.message.content) {
      if ('type' in block && block.type === 'tool_use') {
        if (seen.has(block.id)) {
          // Already processed — still reset currentAssistantMsgId so the
          // next CLI message creates a new DB row instead of appending here
          currentAssistantMsgId.delete(threadId);
          continue;
        }

        console.log(`[agent] tool_use: ${block.name} thread=${threadId}`);

        // Ensure there's always a parent assistant message for tool calls
        let parentMsgId = currentAssistantMsgId.get(threadId) || cliMap.get(cliMsgId);
        if (!parentMsgId) {
          parentMsgId = tm.insertMessage({ threadId, role: 'assistant', content: '' });
          // Notify client so it creates the message before tool calls arrive
          emitWS(threadId, 'agent:message', {
            messageId: parentMsgId,
            role: 'assistant',
            content: '',
          });
        }
        currentAssistantMsgId.set(threadId, parentMsgId);
        cliMap.set(cliMsgId, parentMsgId);

        // Check DB for existing duplicate (guards against session resume re-sending old tool_use blocks)
        const inputJson = JSON.stringify(block.input);
        const existingTC = tm.findToolCall(parentMsgId, block.name, inputJson);

        if (existingTC) {
          seen.set(block.id, existingTC.id);
        } else {
          const toolCallId = tm.insertToolCall({
            messageId: parentMsgId,
            name: block.name,
            input: inputJson,
          });
          seen.set(block.id, toolCallId);

          emitWS(threadId, 'agent:tool_call', {
            toolCallId,
            messageId: parentMsgId,
            name: block.name,
            input: block.input,
          });
        }

        // Track if this tool call means Claude is waiting for user input
        if (block.name === 'AskUserQuestion') {
          pendingUserInput.set(threadId, 'question');
        } else if (block.name === 'ExitPlanMode') {
          pendingUserInput.set(threadId, 'plan');
        } else {
          pendingUserInput.delete(threadId);
        }

        // Reset currentAssistantMsgId — next CLI message's text should be a new DB message
        // But cliMap keeps the mapping so cumulative updates of THIS message still work
        currentAssistantMsgId.delete(threadId);
      }
    }
    processedToolUseIds.set(threadId, seen);
    return;
  }

  // User messages — tool results (output from tool executions)
  if (msg.type === 'user') {
    const seen = processedToolUseIds.get(threadId);
    if (seen && msg.message.content) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          const toolCallId = seen.get(block.tool_use_id);
          if (toolCallId && block.content) {
            // Update DB
            const decodedOutput = decodeUnicodeEscapes(block.content);
            tm.updateToolCallOutput(toolCallId, decodedOutput);
            // Notify clients
            emitWS(threadId, 'agent:tool_output', {
              toolCallId,
              output: decodedOutput,
            });
          }
        }
      }
    }
    return;
  }

  // Result — agent finished (deduplicate: CLI may send result more than once)
  if (msg.type === 'result') {
    if (resultReceived.has(threadId)) return;

    console.log(`[agent] result thread=${threadId} status=${msg.subtype} cost=$${msg.total_cost_usd} duration=${msg.duration_ms}ms`);
    resultReceived.add(threadId);
    currentAssistantMsgId.delete(threadId);
    // NOTE: processedToolUseIds preserved to deduplicate on next session resume

    // If the last tool call was AskUserQuestion or ExitPlanMode, Claude is
    // waiting for user input — use 'waiting' instead of 'completed'.
    const waitingReason = pendingUserInput.get(threadId);
    const isWaitingForUser = !!waitingReason;
    const finalStatus = isWaitingForUser
      ? 'waiting'
      : msg.subtype === 'success' ? 'completed' : 'failed';
    pendingUserInput.delete(threadId);

    tm.updateThread(threadId, {
      status: finalStatus,
      cost: msg.total_cost_usd,
      // Only set completedAt for truly terminal states
      ...(finalStatus !== 'waiting' ? { completedAt: new Date().toISOString() } : {}),
    });

    // Don't save msg.result to DB — already captured in the last assistant message

    // Emit agent:result which already contains the final status.
    // No separate agent:status emit needed — handleWSResult updates both
    // threadsByProject and activeThread atomically, avoiding race conditions.
    emitWS(threadId, 'agent:result', {
      result: msg.result ? decodeUnicodeEscapes(msg.result) : msg.result,
      cost: msg.total_cost_usd,
      duration: msg.duration_ms,
      status: finalStatus,
      ...(waitingReason ? { waitingReason } : {}),
    });
  }
}

// ── Public API (same interface as before) ──────────────────────────

export async function startAgent(
  threadId: string,
  prompt: string,
  cwd: string,
  model: ClaudeModel = 'sonnet',
  permissionMode: PermissionMode = 'autoEdit',
  images?: any[]
): Promise<void> {
  console.log(`[agent] start thread=${threadId} model=${model} cwd=${cwd}`);

  // Stop existing agent for this thread (if any) before starting a new one.
  // Without this, the old process stays running and its exit handler would
  // remove the new process from activeAgents, causing tracking issues.
  const existing = activeAgents.get(threadId);
  if (existing && !existing.exited) {
    console.log(`[agent] stopping existing agent for thread=${threadId} before restart`);
    manuallyStopped.add(threadId);
    try { await existing.kill(); } catch { /* best-effort */ }
    activeAgents.delete(threadId);
  }

  // Clear stale state from previous runs.
  // NOTE: processedToolUseIds and cliToDbMsgId are intentionally preserved
  // across sessions to deduplicate re-sent content on session resume (--resume).
  currentAssistantMsgId.delete(threadId);
  resultReceived.delete(threadId);
  manuallyStopped.delete(threadId);
  pendingUserInput.delete(threadId);

  // Update thread status
  tm.updateThread(threadId, { status: 'running' });

  emitWS(threadId, 'agent:status', { status: 'running' });

  // Save user message
  tm.insertMessage({
    threadId,
    role: 'user',
    content: prompt,
    images: images ? JSON.stringify(images) : null,
  });

  // User message is NOT broadcast via WS — the client adds it optimistically
  // and polling will sync from DB. Broadcasting caused triple-display.

  // Check if we're resuming a previous session
  const thread = tm.getThread(threadId);

  // Spawn claude CLI process
  const claudeProcess = new ClaudeProcess({
    prompt,
    cwd,
    model: MODEL_MAP[model],
    permissionMode: PERMISSION_MAP[permissionMode],
    allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
    maxTurns: 30,
    sessionId: thread?.sessionId ?? undefined,
    images,
  });

  activeAgents.set(threadId, claudeProcess);
  resultReceived.delete(threadId);

  // Handle messages from the CLI
  claudeProcess.on('message', (msg: CLIMessage) => {
    handleCLIMessage(threadId, msg);
  });

  // Handle errors
  claudeProcess.on('error', (err: Error) => {
    console.error(`[agent] Error in thread ${threadId}:`, err);

    // Don't overwrite status if manually stopped or result already received
    if (!resultReceived.has(threadId) && !manuallyStopped.has(threadId)) {
      tm.updateThread(threadId, { status: 'failed', completedAt: new Date().toISOString() });

      emitWS(threadId, 'agent:error', { error: err.message });
      emitWS(threadId, 'agent:status', { status: 'failed' });
    }
  });

  // Handle process exit
  claudeProcess.on('exit', (code: number | null) => {
    activeAgents.delete(threadId);

    // If manually stopped, don't overwrite the 'stopped' status
    if (manuallyStopped.has(threadId)) {
      manuallyStopped.delete(threadId);
      resultReceived.delete(threadId);
      return;
    }

    // If the process exited without sending a result, mark as failed
    if (!resultReceived.has(threadId)) {
      tm.updateThread(threadId, { status: 'failed', completedAt: new Date().toISOString() });

      emitWS(threadId, 'agent:error', {
        error: 'Agent process exited unexpectedly without a result',
      });
      emitWS(threadId, 'agent:status', { status: 'failed' });
    }

    resultReceived.delete(threadId);
  });

  // Start the process
  claudeProcess.start();
}

export async function stopAgent(threadId: string): Promise<void> {
  const claudeProcess = activeAgents.get(threadId);
  if (claudeProcess) {
    manuallyStopped.add(threadId);
    try {
      await claudeProcess.kill();
    } catch (e) {
      console.error(`[agent] Error killing process for thread ${threadId}:`, e);
    }
    activeAgents.delete(threadId);
  }

  tm.updateThread(threadId, { status: 'stopped', completedAt: new Date().toISOString() });

  emitWS(threadId, 'agent:status', { status: 'stopped' });
}

export function isAgentRunning(threadId: string): boolean {
  return activeAgents.has(threadId);
}

