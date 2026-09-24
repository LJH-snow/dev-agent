# @dev-agent/model

Unified model provider interface for OpenAI, Anthropic, Gemini, and Ollama.

Current package capabilities include:

- Shared `ChatMessage`, `ToolCall`, `ToolSchema`, and `ChatCompletion` types
- `ModelProvider` contract with optional tool-calling
- OpenAI, Gemini, and Ollama providers use Node `fetch`; the Anthropic adapter
  uses the official `@anthropic-ai/sdk` client while retaining the package's
  shared retry, cancellation, streaming, and response-size boundaries

## Usage reporting

When a provider reports token counts, `ChatCompletion.usage` carries them as
`{ promptTokens, completionTokens, totalTokens }`. All four providers map their
own field names (OpenAI `usage`, Anthropic `input_tokens`/`output_tokens`,
Gemini `usageMetadata`, Ollama `prompt_eval_count`/`eval_count`), including the
usage that arrives in a stream's final event. Responses without usage leave the
field undefined rather than reporting zeros.

When a provider bills cache hits separately, `usage.cachedPromptTokens` carries
the cached part of `promptTokens` (OpenAI
`prompt_tokens_details.cached_tokens`, Anthropic `cache_read_input_tokens`).
Anthropic's `cache_creation_input_tokens` become
`usage.cacheCreationPromptTokens` and also count as prompt tokens. Both fields
are omitted when a response has no cache tokens.

## Cost estimation

`estimateCost(usage, model, prices)` turns a `ChatUsage` into USD when the caller
supplies a price table:

```ts
estimateCost(
  { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
  "gpt-4o-mini-2024-07-18",
  { "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 } }
); // 0.00045
```

- `PriceTable` maps a model-name prefix to `inputPerMillion` /
  `outputPerMillion` (USD per one million tokens). The optional
  `cachedInputPerMillion` prices the cached part of the prompt instead of the
  regular input price, and `cacheCreationInputPerMillion` does the same for
  cache writes; either falls back to the full input price when unset. The
  longest matching prefix wins, so `gpt-4o` and `gpt-4o-mini` can coexist and a
  dated snapshot picks the more specific entry.
- No match, an empty model name, or a malformed/negative price returns
  `undefined`; this package never guesses a price or assumes the defaults of a
  provider.
- The CLI and desktop read the table from the `pricing` section of
  `~/.dev-agent/config.json`.

## Retries

Every provider retries the initial HTTP request when the server answers 429 or
5xx, or when the connection fails. `Retry-After` is honoured in both delta
seconds and HTTP-date form, capped at 2 seconds; other 4xx responses fail
immediately. Retry behaviour is configurable per provider via
`retry: { retries, baseDelayMs, maxDelayMs }` (defaults: 2 retries, 250ms base,
2s cap, exponential backoff with jitter).

Streaming calls only retry the initial request. Once a token reached the
caller, the stream is never restarted, so output is never duplicated.

## Model routing

`ModelRouter` composes one primary provider with an explicit, lazily resolved
fallback sequence. It applies the same bounded routing contract to both
`chat()` and `streamChat()`:

- a failed non-streaming call can move to the next fallback;
- a stream can move to the next fallback only before answer or reasoning output
  reaches the caller;
- once visible stream output has been delivered, the original error is
  re-thrown so a partial answer is never replayed or silently continued by a
  different model;
- aborts fail closed and never trigger a fallback;
- fallback callbacks receive provider/model metadata and the classified failure
  reason, but never prompt or model-output content.

The CLI keeps profile, alias, and provider construction at its application
edge, then supplies the resolved providers to `ModelRouter`. This keeps model
selection policy separate from the shared provider execution contract.
