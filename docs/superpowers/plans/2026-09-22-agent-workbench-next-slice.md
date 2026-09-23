# Agent Workbench Next Slice

Date: 2026-09-22

This slice turns the existing Ink CLI foundation into a safer, more
inspectable coding-agent workbench.

## Scope

1. Interactive Plan Mode with an exact reviewed change-set apply path.
2. Provider-neutral reasoning normalization for streamed and non-streamed
   OpenAI-compatible, Anthropic, Gemini, and Ollama responses.
3. Tool timeline, retry, cancellation, and repeated-failure recovery affordances.
4. First-use provider/model setup without storing credentials.
5. Provider-free MCP server configuration management.
6. Bounded parallel specialist planning with a lead synthesis.

## Safety boundaries

- Plan Mode denies mutating tools before execution.
- `:apply` uses the reviewed change set directly when one exists; it does not
  ask the model to recreate an unreviewed mutation.
- Reasoning is displayed only when the provider emits an explicit reasoning
  channel; hidden chain-of-thought is never inferred.
- Setup and MCP writes are atomic, size-bounded, symlink-guarded, and use
  restrictive file permissions.
- MCP add/remove never starts a configured server and never echoes environment
  values.
- Collaborative specialists run with isolated memory and Plan Mode, with
  bounded concurrency and abort propagation.

## Verification

Focused tests cover Plan Mode, reasoning adapters, setup, MCP add/remove,
collaborative planning, Ink rendering, queueing, retries, and runtime events.
The final gate is the full CLI suite plus TypeScript builds and
`git diff --check`.
