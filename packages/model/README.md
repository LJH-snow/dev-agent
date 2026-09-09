# @dev-agent/model

Unified model provider interface for OpenAI, Anthropic, Gemini, and Ollama.

Phase 1 provides:

- Shared `ChatMessage`, `ToolCall`, `ToolSchema`, and `ChatCompletion` types
- `ModelProvider` contract with optional tool-calling
- OpenAI, Anthropic, Gemini, and Ollama providers built on Node `fetch`, no SDK
  dependency
