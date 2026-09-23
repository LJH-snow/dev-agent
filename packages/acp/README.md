# @dev-agent/acp

Reusable ACP v1 transport and lifecycle bridge for `dev-agent`.

The package adapts the official `@agentclientprotocol/sdk` to a small runtime
factory contract. It owns ACP connection state, session ids, prompt
serialization, cancellation, cleanup, and NDJSON stdio framing. The caller
supplies the provider-backed runtime, tool policy, memory, and approval
adapter.

`connectAcpStdio()` reserves stdout for protocol frames. Human diagnostics
belong on stderr. The current bridge accepts text prompt blocks and exposes
`initialize`, `session/new`, `session/prompt`, `session/cancel`, streamed
`session/update`, and client permission requests.

The package is an internal workspace dependency used by the CLI's `--acp`
entry point. It does not implement A2A, multi-agent orchestration, or a
second model configuration system.
