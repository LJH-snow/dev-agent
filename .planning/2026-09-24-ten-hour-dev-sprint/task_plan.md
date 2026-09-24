# dev-agent 10-hour development sprint

**Date:** 2026-09-24
**Objective:** Continue turning dev-agent into a production-ready Gemini-inspired
coding agent while preserving the current AgentLoop, shared approval policy,
Rust sandbox, MCP boundaries, CLI/Desktop compatibility, and fail-closed
behavior.

## Why this sprint

The repository already has the core architecture, multi-provider model layer,
CLI TUI, Desktop workbench, task worktrees, diff review, terminal/preview
surfaces, skills/jobs metadata, monitoring, and an opt-in Claude Agent SDK
adapter. The next highest-value work is not another broad UI feature: it is to
make the Desktop execution surfaces obey the same explicit capability and
lifecycle boundaries as the model/tool runtime, then prove that boundary with
strong tests and browser evidence.

## Ten-hour schedule

### Hour 0–1 — baseline and threat-model inventory

- [x] Restore the current repository/plan context and inspect the active
      Desktop, executor, approval, MCP, and worktree seams.
- [x] Record the current branch, remote, dirty/untracked artifacts, and
      verification baseline.
- [x] Identify any direct process-spawn or mutation route that bypasses the
      shared policy/sandbox boundary.

### Hour 1–3 — Desktop local capability authorization boundary

- [x] Design and implement a server-scoped, non-secret-leaking capability
      token for browser-originated mutating Desktop APIs.
- [x] Require the token for terminal start/input/stop, task workspace create,
      merge, cleanup, session mutation, approval decisions, chat, and plan
      mutations; keep metadata-only GET routes readable on loopback.
- [x] Inject the token only into the served Desktop document and centralize
      browser request headers so UI behavior remains unchanged.
- [x] Add negative tests for missing and wrong tokens plus existing loopback/origin
      rejection coverage; per-server token rotation makes stale tokens invalid;
      add positive tests for the served UI path.

### Hour 3–5 — task terminal execution hardening

- [ ] Ensure terminal cwd is canonical, exists, remains inside the managed task
      worktree, and cannot be redirected through a symlink after assignment.
- [ ] Add explicit lifecycle cleanup when a session/worktree is deleted or the
      Desktop server closes; preserve process-group termination and output
      bounds.
- [ ] Add command/environment redaction to metadata and bounded event output;
      keep terminal input/output behavior compatible with the existing UI.
- [ ] Add regressions for cwd escape, cleanup races, abort/stop, retention, and
      bounded output.

### Hour 5–7 — read-only project capability panel

- [ ] Extend the metadata-only capability projection with repository branch,
      dirty state, remote host, and opt-in GitHub/CI status.
- [ ] Keep GitHub operations read-only and explicit-opt-in; no PR creation,
      merge, comment, workflow dispatch, or credential material may be exposed.
- [ ] Surface unavailable/unauthenticated/unsupported states distinctly in the
      Desktop panel and monitoring snapshot.
- [ ] Add bounded parsing and tests for malformed Git/GitHub metadata.

### Hour 7–8.5 — Gemini-inspired policy and observability audit

- [ ] Verify every new Desktop capability is represented in trusted registry
      metadata or an explicit host-owned boundary; remote annotations must not
      downgrade risk.
- [ ] Add metadata-only run-trace fields for authorization result, capability
      class, and terminal/preview lifecycle without prompts, file contents, or
      secrets.
- [ ] Document the boundary and list deliberately deferred executable plugin
      loading, remote control, and unrestricted GitHub mutation.

### Hour 8.5–10 — acceptance, release gate, and delivery

- [x] Run focused Desktop tests, package build/typecheck, CLI/Desktop suites,
      documentation contracts, and the repository release gate.
- [ ] Run browser acceptance against an isolated temporary repository and
      capture fresh evidence without using the real project worktree.
- [ ] Review the diff, exclude QA artifacts, update progress/findings, and
      commit/push only the intended source, test, and documentation changes.

## Non-negotiable invariants

1. The default CLI AgentLoop remains the default runtime; no provider or SDK
   adapter may bypass the shared tool registry.
2. Missing/invalid approval or capability authorization fails closed.
3. Rust sandbox and executor mode semantics are not silently weakened by a
   Desktop convenience route.
4. Read-only metadata never includes prompts, source contents, credentials,
   raw command lines, or unbounded process output.
5. Task worktrees cannot escape their canonical managed root; cleanup never
   uses a forceful Git worktree removal for dirty user data.
6. Existing dirty/untracked QA artifacts are preserved and not added unless
   they are intentionally part of the sprint deliverable.

## Current status

The plan is active. The baseline/inventory hour, CLI/Desktop UX tranche,
capability-token tranche, and full TypeScript release gate are complete. The next
concrete slices are terminal canonical-cwd/lifecycle hardening and manual browser/
PTY acceptance; they are intentionally not part of this push.
