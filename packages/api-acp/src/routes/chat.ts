/**
 * POST /v1/chat/completions — OpenAI-compatible chat completions endpoint.
 *
 * Uses the Claude Agent SDK `query()` directly — same as SDKClaudeProcess.
 * No API keys needed — uses the CLI's own authentication.
 * Supports both streaming (SSE) and non-streaming responses.
 */

import { Hono } from 'hono';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { resolveModel } from '../utils/model-resolver.js';
import {
  makeCompletionId,
  toOpenAIChatCompletion,
  toOpenAIStreamChunk,
  sseEncode,
} from '../utils/format.js';

export const chatRoute = new Hono();

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  stop?: string | string[];
}

/** Convert OpenAI messages array into a single prompt string for the SDK. */
function messagesToPrompt(messages: OpenAIMessage[]): string {
  // Separate system messages from conversation
  const systemMsgs = messages.filter((m) => m.role === 'system');
  const conversationMsgs = messages.filter((m) => m.role !== 'system');

  const parts: string[] = [];

  if (systemMsgs.length > 0) {
    parts.push(systemMsgs.map((m) => m.content).join('\n'));
    parts.push('---');
  }

  // For single user message, just use the content directly
  if (conversationMsgs.length === 1 && conversationMsgs[0].role === 'user') {
    parts.push(conversationMsgs[0].content);
  } else {
    // Multi-turn: format as conversation
    for (const msg of conversationMsgs) {
      const label = msg.role === 'user' ? 'User' : 'Assistant';
      parts.push(`${label}: ${msg.content}`);
    }
  }

  return parts.join('\n\n');
}

chatRoute.post('/', async (c) => {
  const body = await c.req.json<ChatCompletionRequest>();
  const { model: requestedModel, messages, stream } = body;

  if (!requestedModel) {
    return c.json({ error: { message: 'model is required', type: 'invalid_request_error' } }, 400);
  }
  if (!messages?.length) {
    return c.json({ error: { message: 'messages is required', type: 'invalid_request_error' } }, 400);
  }

  const { modelId } = resolveModel(requestedModel);
  const prompt = messagesToPrompt(messages);
  const completionId = makeCompletionId();

  if (stream) {
    return handleStreaming(completionId, requestedModel, modelId, prompt);
  }
  return handleNonStreaming(c, completionId, requestedModel, modelId, prompt);
});

// ── Non-streaming ────────────────────────────────────────────

async function handleNonStreaming(
  c: any,
  completionId: string,
  requestedModel: string,
  modelId: string,
  prompt: string,
) {
  try {
    const textParts: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    const gen = query({
      prompt,
      options: {
        model: modelId,
        maxTurns: 1,
        executable: 'node',
        systemPrompt: '',
        tools: [],
        permissionMode: 'plan',
      },
    });

    for await (const msg of gen) {
      if (msg.type === 'assistant') {
        const raw = msg as any;
        if (raw.message?.content) {
          for (const block of raw.message.content) {
            if (block.type === 'text') {
              textParts.push(block.text);
            }
          }
          if (raw.message.usage) {
            inputTokens += raw.message.usage.input_tokens ?? 0;
            outputTokens += raw.message.usage.output_tokens ?? 0;
          }
        }
      }
      if (msg.type === 'result') {
        const raw = msg as any;
        // Use result text if we didn't get assistant messages
        if (textParts.length === 0 && raw.result) {
          textParts.push(raw.result);
        }
      }
    }

    return c.json(
      toOpenAIChatCompletion({
        id: completionId,
        model: requestedModel,
        text: textParts.join(''),
        promptTokens: inputTokens,
        completionTokens: outputTokens,
      }),
    );
  } catch (err: any) {
    console.error('[api-acp] query error:', err.message);
    return c.json(
      { error: { message: err.message, type: 'server_error' } },
      500,
    );
  }
}

// ── Streaming ────────────────────────────────────────────────

async function handleStreaming(
  completionId: string,
  requestedModel: string,
  modelId: string,
  prompt: string,
) {
  const encoder = new TextEncoder();
  const id = completionId;
  const model = requestedModel;

  const readableStream = new ReadableStream({
    async start(controller) {
      try {
        // Send initial chunk with role
        controller.enqueue(
          encoder.encode(
            sseEncode(
              toOpenAIStreamChunk({ id, model, delta: { role: 'assistant', content: '' } }),
            ),
          ),
        );

        let inputTokens = 0;
        let outputTokens = 0;

        const gen = query({
          prompt,
          options: {
            model: modelId,
            maxTurns: 1,
            executable: 'node',
            systemPrompt: '',
            tools: [],
            permissionMode: 'plan',
          },
        });

        for await (const msg of gen) {
          if (msg.type === 'assistant') {
            const raw = msg as any;
            if (raw.message?.content) {
              for (const block of raw.message.content) {
                if (block.type === 'text') {
                  controller.enqueue(
                    encoder.encode(
                      sseEncode(
                        toOpenAIStreamChunk({ id, model, delta: { content: block.text } }),
                      ),
                    ),
                  );
                }
              }
              if (raw.message.usage) {
                inputTokens += raw.message.usage.input_tokens ?? 0;
                outputTokens += raw.message.usage.output_tokens ?? 0;
              }
            }
          }

          if (msg.type === 'result') {
            const raw = msg as any;
            // If result has text and we haven't streamed anything yet
            if (raw.result) {
              controller.enqueue(
                encoder.encode(
                  sseEncode(
                    toOpenAIStreamChunk({ id, model, delta: { content: raw.result } }),
                  ),
                ),
              );
            }
          }
        }

        // Send final chunk with finish_reason and usage
        controller.enqueue(
          encoder.encode(
            sseEncode(
              toOpenAIStreamChunk({
                id,
                model,
                delta: {},
                finishReason: 'stop',
                usage: { promptTokens: inputTokens, completionTokens: outputTokens },
              }),
            ),
          ),
        );

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (err: any) {
        console.error('[api-acp] stream error:', err.message);
        controller.error(err);
      }
    },
  });

  return new Response(readableStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
