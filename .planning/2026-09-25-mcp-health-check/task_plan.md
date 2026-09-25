# MCP tool health check

## Goal
Expose a bounded, metadata-only MCP health surface in the Desktop workbench: per-server connection state, safe tool/resource/prompt counts, ping latency, last-check time, and stable failure categories. Add a refreshable UI panel without exposing commands, args, environment values, credentials, or raw errors.

## Phases
- [x] Inventory current MCP session/status contracts
- [x] Add bounded health snapshot types and session health checks
- [x] Add loopback Desktop endpoint and safe normalization
- [x] Add bilingual health panel and refresh lifecycle
- [x] Add focused tests and run full verification
- [ ] Commit and push the verified feature

## Constraints
- Preserve the unrelated in-progress Task Validation Center edits and `.playwright-cli/`/`output/` artifacts.
- Health checks are read-only; never invoke MCP tools or return server command/env/config details.
- Bound server count, names, counts, latency, timestamps, response bytes, and request timeouts.
- Fail closed for malformed injected snapshots and stale/unknown sessions.
