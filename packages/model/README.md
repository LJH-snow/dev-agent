# @dev-agent/model

Unified model provider interface for OpenAI, Anthropic, Gemini, and Ollama.

Phase 1 provides:

- Shared `ChatMessage`, `ToolCall`, `ToolSchema`, and `ChatCompletion` types
- `ModelProvider` contract with optional tool-calling
- OpenAI, Anthropic, Gemini, and Ollama providers built on Node `fetch`, no SDK
  dependency

## Retries

Every provider retries the initial HTTP request when the server answers 429 or
5xx, or when the connection fails. `Retry-After` is honoured in both delta
seconds and HTTP-date form, capped at 2 seconds; other 4xx responses fail
immediately. Retry behaviour is configurable per provider via
`retry: { retries, baseDelayMs, maxDelayMs }` (defaults: 2 retries, 250ms base,
2s cap, exponential backoff with jitter).

Streaming calls only retry the initial request. Once a token reached the
caller, the stream is never restarted, so output is never duplicated.
