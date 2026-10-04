# Progress

## 2026-10-04 — setup

- Scope confirmed with the user: publish 0.2.1 first, then runtime evidence.
- 15 commits landed after `cd8ff68` (0.2.0 release, 2026-09-30 13:55); all are
  unpublished. Headline groups: CLI TUI hardening (mouse parser resync, editor
  mouse suspend, MCP/notice panel windows, Ctrl-R incremental search,
  persistent session-scoped prompt history), Desktop execution history +
  execution center, MCP notification isolation, CI verify gate, zh README,
  and the security boundary hardening round (2a501fb).
- npm identity: `libai168` (authenticated). Release governance followed:
  `docs/release-cli-npm.md`; preflight = `scripts/npm-release-preflight.mjs`.
- Rust runtime binaries exist at `runtime/rust/target/{debug,release}/dev-agent-executor`;
  integration suite uses the debug binary and macOS sandbox-exec backend.

## 2026-10-04 — release 0.2.1 published

- `docs/CHANGELOG.md` gained a 0.2.1 entry covering the 15 post-0.2.0 commits;
  `apps/cli/package.json` bumped to 0.2.1; `docs/release-state.json` moved to
  candidate then published.
- `pnpm release:preflight` passed (candidate 0.2.1 > registry 0.2.0, auth ok,
  5-file artifact allowlist).
- The gated `pnpm release:publish` wrapper failed with `publish_failed`: npm
  now requires web-based 2FA (EOTP) which `execFile` cannot complete. The user
  approved the browser flow; a pty-wrapped `npm publish --access public`
  printed the auth URL, the user authenticated, and npm accepted the tarball
  (shasum `e6bacff4fd044b2680d5d517476b1eddd2c87d77`).
- Registry propagation delay observed (E404 twice) as documented for earlier
  releases; final verification: `npm view @agent_cli/cli@0.2.1 version` =
  `0.2.1`, `dist-tags.latest` = `0.2.1`.
- No Git tag or GitHub Release created (project convention: separate
  authorization).
