# Findings — dev-agent 10-hour sprint

## Baseline — 2026-09-24

- Current branch: `codex/desktop-cli-workbench`; it tracks
  `origin/codex/desktop-cli-workbench`.
- The latest pushed commit is `9a1e08f` (`feat: complete Anthropic and Desktop
  workbench capabilities`).
- The tracked worktree is clean. `.playwright-cli/` and `output/` are local
  untracked QA artifacts and are intentionally not part of the implementation.
- Existing evidence before this sprint includes CLI **629/629**, Desktop
  **222/222**, Claude Agent SDK **13/13**, documentation **60/60**, native
  Desktop **2/2**, package smoke, build/typecheck, and `git diff --check`.
- The active source has task worktrees, diff grouping/file review/comments,
  loopback terminal APIs, preview URL validation, GitHub capability probing,
  skills/jobs metadata, and read-only monitoring.

## Initial security/lifecycle observations

- `apps/desktop/src/task-terminal.ts` currently uses a direct shell spawn for
  the user-facing terminal. It has bounded command/input/output, process-group
  termination, retention, and session binding, but it is a separate execution
  seam from the AgentLoop's shared approval/executor path.
- The Desktop server currently gates terminal/monitoring routes to loopback
  addresses and loopback origins. That is useful containment, but a local
  non-browser process can still call a loopback mutation route without a
  browser-origin token.
- `task-workspaces.ts` already performs managed-root and worktree checks; the
  sprint must verify canonical-path behavior at the terminal boundary as well,
  especially around symlink replacement and cleanup races.
- GitHub support is intentionally metadata-only today: the optional probe can
  report whether `gh` is available/authenticated, but mutation is permanently
  false. The sprint must preserve that invariant.

## Design direction

Use a server-scoped capability token for mutating browser APIs rather than
trying to infer trust from loopback origin alone. The token should be generated
per server instance, never logged or returned by a general API, and inserted
only into the served UI document. All mutating UI requests should use one
central request helper so the protection cannot drift route by route.

Do not turn this into an executable plugin loader or a remote-control surface.
Those remain deferred until a separate trust/install/rollback design exists.


## 2026-09-24 — capability boundary correction

- The token must be opt-in at the server factory boundary for tests and custom embedding hosts, but the normal `startDesktopEntry()` production path opts in. This keeps the browser security boundary explicit without silently breaking hosts that intentionally use `createDesktopServer()` as a test double.
- The token is not exposed by an API response. It is substituted into the HTML response only; direct `/public/index.html` loads receive the same token when served by an opted-in server.


## 2026-09-24 — verification findings

- The capability guard is centralized at the HTTP boundary: when enabled, every
  `POST`, `PUT`, `PATCH`, or `DELETE` under `/api/` requires the server-scoped
  header, while read-only `GET` metadata remains readable subject to the existing
  loopback/origin rules.
- `startDesktopEntry()` enables the guard in the production launcher.
  `createDesktopServer()` stays opt-in unless a token is supplied, preserving
  embedding/test-host compatibility.
- The served HTML receives the token through a no-store substitution, and the
  browser wrapper adds it only to same-origin API mutations; the token is not
  returned by a capability API or written to browser storage.
- Full evidence after the tranche: Desktop **224/224**, CLI **630/630**, package
  build/typecheck passed, TypeScript release gate passed, and `git diff --check`
  passed.
- The full ten-hour plan still contains deferred terminal cwd/lifecycle,
  read-only project capability-panel, metadata trace, and manual browser/PTY
  acceptance work. Those items are not represented as complete by this push.
