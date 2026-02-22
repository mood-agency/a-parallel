/**
 * Format utilities — convert Vercel AI SDK results to OpenAI wire format.
 */

import { randomUUID } from 'crypto';

// ── Types ────────────────────────────────────────────────────

export interface OpenAIChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: 'assistant'; content: string | null };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: string; content?: string };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ── Formatters ───────────────────────────────────────────────

export function makeCompletionId(): string {
  return `chatcmpl-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export function toOpenAIChatCompletion(params: {
  id: string;
  model: string;
  text: string;
  promptTokens: number;
  completionTokens: number;
  finishReason?: string;
}): OpenAIChatCompletion {
  return {
    id: params.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: params.model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: params.text },
        finish_reason: params.finishReason ?? 'stop',
      },
    ],
    usage: {
      prompt_tokens: params.promptTokens,
      completion_tokens: params.completionTokens,
      total_tokens: params.promptTokens + params.completionTokens,
    },
  };
}

export function toOpenAIStreamChunk(params: {
  id: string;
  model: string;
  delta: { role?: string; content?: string };
  finishReason?: string | null;
  usage?: { promptTokens: number; completionTokens: number };
}): OpenAIStreamChunk {
  const chunk: OpenAIStreamChunk = {
    id: params.id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: params.model,
    choices: [
      {
        index: 0,
        delta: params.delta,
        finish_reason: params.finishReason ?? null,
      },
    ],
  };

  if (params.usage) {
    chunk.usage = {
      prompt_tokens: params.usage.promptTokens,
      completion_tokens: params.usage.completionTokens,
      total_tokens: params.usage.promptTokens + params.usage.completionTokens,
    };
  }

  return chunk;
}

/** Encode a chunk as an SSE line. */
export function sseEncode(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}
