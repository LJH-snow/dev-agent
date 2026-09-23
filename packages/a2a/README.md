# @dev-agent/a2a

The reusable local A2A v1 boundary for `dev-agent`.

The package owns protocol-facing concerns:

- bounded Agent Card and task metadata
- JSON-RPC request handling with the official A2A SDK
- JSON-RPC streaming over server-sent events
- task cancellation and client disconnect signals
- bounded task/context retention and same-context concurrency protection
- loopback-first Node HTTP hosting with optional bearer authentication

It does not own a model provider or an interactive approval UI. Callers supply
an `A2aRuntimeFactory` that adapts their existing runtime into bounded text,
status, reasoning, and tool progress updates. Reasoning updates are hidden by
default and require explicit `exposeReasoning: true`.

JSON-RPC task requests must send `A2A-Version: 1.0`. A loopback server can run
without authentication. Non-loopback `startA2aServer` binds require an
`authToken`; task requests then use `Authorization: Bearer <token>`. Agent Card
discovery remains available so clients can learn the security scheme.
