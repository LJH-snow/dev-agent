# Progress — Desktop Security Center completion round

## 2026-10-05

- Slice 2a (`ab86731`): clear-history. RED test first for
  `SecurityAuditHistoryStore.clear()` (persist + reload shows empty + store
  keeps accepting records), then the DELETE /api/security-center route
  (capability-token gated like all /api mutations, loopback metadata family,
  fail-closed 500 on persist failure) and the panel's Clear history button
  with a browser confirm step. Desktop suite 449/449.
- Slice 2b (`0262122`): MCP metadata inspection. RED test first (injected
  shell MCP entry surfaces an `mcp` finding and its env value never
  persists), then `securityScanMcpServers` server option defaulting to a
  bounded, fail-closed read of `~/.dev-agent/config.json` `mcpServers`
  (1 MiB file cap, 64 entries). Aligns Desktop with the CLI scan. Desktop
  suite 450/450.
- Remaining follow-up deliberately not done here: per-session worktree scan
  selection from the panel (the route accepts a sessionId; a session picker
  in the panel is UI work left for a later slice).
- Slice 3 (npm provenance) was investigated and is **blocked on a governance
  decision, not implemented**: npm provenance attestations can only be
  generated from a supported CI (GitHub Actions with `id-token: write` OIDC
  and an `NPM_TOKEN` secret) — the current flow publishes locally after the
  user's browser 2FA authorization, which cannot produce provenance. Adding
  it therefore means moving npm publication into the release workflow with a
  stored token, which changes the standing "publish only after explicit
  user authorization + interactive 2FA" governance and requires the user to
  create the repo secret. No code was changed for this slice.
- Session-scope picker (later the same day, contract RED first): the panel
  gains a labeled scan-scope select populated from `GET /api/sessions`
  (bounded to 256 ids; only `sessionId` strings are read — content-derived
  previews are ignored), preserving the selection across refreshes. "Run
  bounded scan" sends `{ sessionId }` when a session is selected, so the
  existing route scans that session's task worktree; unknown/too-long ids
  remain fail-closed server-side (400/404). i18n en/zh keys added; scoped
  select styling follows the panel conventions. Desktop suite 450/450.
- Closing scan: `scan-2026-10-05T12-42-14.564Z-0cec65d49f7f`, seal
  `sha256:967c2d5d2ee130df21b161f7fd879498062bfbf87578dbf2ae248cdd2fffeb84`,
  depth deep, 198 dependencies / 0 advisories, verdict effect `none`.
  Findings: 21 — unchanged across seven consecutive scans; zero findings in
  the touched files. Static-only evidence, not a runtime security proof.
