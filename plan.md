# Plan: `packages/openai-compat` — OpenAI-compatible API server

## Goal

Create a new package `packages/openai-compat` that exposes an OpenAI-compatible HTTP API (`/v1/chat/completions` + `/v1/models`). Any tool that speaks the OpenAI API (Cursor, Continue, Open WebUI, LM Studio clients, etc.) can point at this server and use Claude/Codex/Gemini models transparently.

## Architecture

Uses the existing **`ModelFactory`** from `@funny/core` (which wraps the Vercel AI SDK) to create language models, then uses `generateText` / `streamText` from the `ai` package to translate between OpenAI wire format and provider-specific calls.

```
External Client (OpenAI format)
    │
    ▼
packages/openai-compat (Hono server)
    │  Translates OpenAI messages → Vercel AI SDK calls
    ▼
ModelFactory (@funny/core)
    │  Creates LanguageModel for any provider
    ▼
@ai-sdk/anthropic, @ai-sdk/openai, etc.
    │
    ▼
Claude API / OpenAI API / Ollama / etc.
```

## Files to create

### 1. `packages/openai-compat/package.json`
- Name: `@funny/openai-compat`
- Dependencies: `hono`, `ai`, `@funny/core`, `@funny/shared`
- Bin entry for `funny-openai-proxy` standalone usage
- Scripts: `dev`, `start`

### 2. `packages/openai-compat/tsconfig.json`
- Extends `../../tsconfig.base.json`

### 3. `packages/openai-compat/src/index.ts` — Entry point
- Creates the Hono app
- Mounts routes
- Starts the server (port from `--port` flag or `OPENAI_COMPAT_PORT` env, default `4010`)
- Prints available models and base URL on startup

### 4. `packages/openai-compat/src/routes/models.ts` — `GET /v1/models`
- Returns all available models from the model registry (`@funny/shared/models`)
- Maps to OpenAI `List models` response format: `{ object: "list", data: [{ id, object: "model", created, owned_by }] }`
- Includes Claude, Codex, and Gemini models
- Model IDs use the full model IDs (e.g. `claude-sonnet-4-5-20250929`)

### 5. `packages/openai-compat/src/routes/chat.ts` — `POST /v1/chat/completions`
- Accepts OpenAI `ChatCompletionRequest` format
- Extracts `model`, `messages`, `temperature`, `max_tokens`, `stream`
- Maps the model ID to a provider using the model resolver
- Creates a `LanguageModel` via `ModelFactory.create(provider, modelId)`
- **Non-streaming**: Uses `generateText()` → returns OpenAI `ChatCompletion` response
- **Streaming (SSE)**: Uses `streamText()` → returns `text/event-stream` with `data: {...}` chunks in OpenAI format, ending with `data: [DONE]`

### 6. `packages/openai-compat/src/utils/model-resolver.ts`
- Takes an OpenAI-style model ID string and resolves it to `{ provider, modelId }`
- Supports aliases: `claude-sonnet` → `anthropic` + `claude-sonnet-4-5-20250929`
- Falls through to full model IDs: `claude-opus-4-6` → `anthropic` + `claude-opus-4-6`
- Also supports `gpt-4-turbo` → `openai` + `gpt-4-turbo`, etc.

### 7. `packages/openai-compat/src/utils/format.ts`
- `toOpenAIChatCompletion()` — Converts `generateText` result to OpenAI response format
- `toOpenAIStreamChunk()` — Converts `streamText` chunk to OpenAI SSE chunk format
- Handles `id`, `object`, `created`, `model`, `choices`, `usage` fields

## Key design decisions

1. **Hono for HTTP** — Same framework as the main server, lightweight and fast
2. **Standalone server** — Runs on its own port, independent from the main funny server. Can be started with `bun run --cwd packages/openai-compat dev`
3. **No auth by default** — Local proxy. Optional `OPENAI_COMPAT_API_KEY` env var to require a Bearer token
4. **Model auto-detection** — Detects provider from model ID prefix (`claude-*` → anthropic, `gpt-*` → openai, `gemini-*` → gemini)
5. **Provider API keys from env** — Uses `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc. (same as ModelFactory already does)

## Changes to existing files

None. The root `package.json` already uses `packages/*` glob for workspaces, so the new package is auto-discovered.

## Usage

```bash
# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Start the proxy
cd packages/openai-compat && bun run dev

# Use with any OpenAI client
curl http://localhost:4010/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-5-20250929","messages":[{"role":"user","content":"Hello!"}]}'
```
