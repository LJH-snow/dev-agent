# Progress

## 2026-09-17

- Restored context from repository docs and confirmed `@agent_cli/cli@0.1.6`
  has a GitHub Release while npm `latest` remains `0.1.5`.
- Selected Desktop managed-runtime visibility as the first non-CLI project slice.
- Implemented the safe managed-runtime status snapshot, API merge, and Desktop
  panel row.
- Desktop focused tests passed **86/86**.

## 2026-09-18

- Re-inspected the worktree and confirmed the missing type import noted in the
  handoff had already been fixed.
- Rebuilt all workspace packages successfully.
- Desktop focused tests passed **88/88**.
- Runtime-manager focused tests passed **14/14**.
- Full `pnpm verify:typescript` passed, including all workspace tests, CLI
  package smoke, preview contracts, and TypeScript documentation contracts.
- Marked both current task-plan phases complete without publishing, tagging,
  pushing, or starting the next release.

## 2026-09-20

- Started the next eight-hour development slice from the completed native
  desktop milestone.
- Re-read the current input-boundary audit and identified five active `FIX`
  findings: MCP error frames, CLI session listing, doctor subprocess output,
  Rust probe framing, and FilesystemTool writes/postimages.
- Confirmed the worktree already contains an in-flight MCP error-response
  change; it remains preserved while the next tasks use disjoint files.
- Saved the executable plan in
  `docs/superpowers/plans/2026-09-20-eight-hour-hardening.md`.

## 2026-09-20 hardening progress

- Closed the five reproducible input-boundary findings with RED/GREEN tests:
  bounded MCP error responses, newest-256 CLI session JSON, capped doctor
  subprocess output/Rust probe frames, and 16 MiB FilesystemTool writes and
  postimages.
- Updated the CLI session-list contract to
  `{ sessions, truncated, total }` and documented the 64 KiB/8 MiB/16 KiB
  doctor limits and 16 MiB filesystem write limit.
- Focused evidence is green for MCP (66/66), tools (145/145), Agent Core
  (134/134), Desktop (138/138), Model (66/66), Runtime Manager (23/23), and
  Rust (54/54 unit tests plus doc tests).
- The full CLI suite passed **383/383**, including the bounded session-list
  envelope and doctor overflow cases. The workspace `pnpm verify` gate passed,
  including documentation contracts **57/57**, CLI package smoke, preview
  contracts, and real Rust integration **11/11**.
- Native macOS verification passed: Swift package tests **8/8**, launcher
  verification succeeded without a residual app process, and `Info.plist`
  lint passed.
- The five reproducible audit findings are closed. The four
  `NEEDS-EVIDENCE` rows remain open; this is a verified development state,
  not a release authorization.

## 2026-09-20 input-boundary closure

- Implemented the shared 16 MiB UTF-8 cumulative stream budget across OpenAI,
  Anthropic, Gemini, and Ollama, including reader cancellation and tool-call
  fragment accounting.
- Added code-search and CLI index discovery limits of 100,000 eligible files
  and 256 MiB of eligible source bytes, with no partial cache/index install.
  Oversized 16 MiB serialized write-back preserves the previous valid index.
- Replaced rollback directory materialization with early-exit `opendir()`
  iteration and preserved the existing conflict behavior.
- Added a 4 KiB UTF-8 CLI approval boundary. Overflow denies safely, cleans up
  listeners, and closes non-TTY input so a one-shot producer without EOF does
  not hang.
- Focused evidence is green: model 72/72, Agent Core 134/134, tools 151/151,
  and CLI 391/391. Task-level reviews are clean; the documented
  normal-newline/open-non-TTY compatibility observation remains parked.
- Final workspace, Rust, native macOS, and push gates are still pending.
