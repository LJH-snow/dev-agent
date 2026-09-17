
## Current findings

- Desktop `/api/status` exposes executor mode, Node runtime, provider/model,
  approval, validation metadata, and a managed Rust runtime summary.
- The managed runtime summary is metadata-only: it accepts only allowlisted
  states/targets, exposes `version` only for verified installs, and reduces
  failure detail to a stable reason or stable error code.
- Runtime status is read offline through `@dev-agent/runtime-manager`; it does
  not start providers, MCP servers, or runtime binaries.
