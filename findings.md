
## Current findings

- Desktop `/api/status` exposes executor mode, Node runtime, provider/model,
  approval, validation metadata, and a managed Rust runtime summary.
- The managed runtime summary is metadata-only: it accepts only allowlisted
  states/targets, exposes `version` only for verified installs, and reduces
  failure detail to a stable reason or stable error code.
- Runtime status is read offline through `@dev-agent/runtime-manager`; it does
  not start providers, MCP servers, or runtime binaries.

## 2026-09-20 Eight-hour slice

- The native macOS shell is complete and verified; the next work should stay
  in the shared CLI/tooling surface instead of adding another desktop client.
- The authoritative audit listed five reproducible `FIX` findings. The current
  worktree now closes them in `packages/mcp/src/server.ts`,
  `apps/cli/src/index.ts` session listing, `apps/cli/src/doctor.ts` subprocess
  readers, and `packages/tools/src/filesystem.ts` write/postimage handling.
- The current MCP source/test diff is already present in the worktree and must
  be treated as concurrent work until its focused tests are read and passed.
- Four audit entries remain `NEEDS-EVIDENCE`; they are not part of this
  implementation slice and must not be silently changed.
