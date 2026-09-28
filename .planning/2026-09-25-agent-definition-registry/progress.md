# Progress — Agent Definition Registry

## 2026-09-25

- Design narrowed to a bounded, metadata-and-instructions-only Markdown registry; no executable agent plugins, hooks, MCP startup, network fetch, or authority escalation.
- Implemented `AgentDefinitionRegistry` in Agent Core with deterministic project-over-user precedence, bounded files/instructions/metadata, safe front matter parsing, and best-effort malformed-definition handling.
- Added CLI role merging so discovered definitions augment built-ins while explicit JSON `collaboration.roles` remains authoritative for duplicate IDs and the existing tool-ceiling intersection remains in force.
- Added read-only `:agents` / `:agent <id>` inspection commands and wired registry discovery into both rich and line-oriented interactive CLI paths.
- Added unit and integration coverage for registry parsing, precedence, malformed inputs, role merging, command sanitization, and discovered-role tool narrowing.
- Added README, architecture, and Gemini CLI alignment documentation describing the file contract and non-executable boundary.

## Verification evidence

- `pnpm --filter @dev-agent/agent-core build && pnpm --filter @dev-agent/agent-core test`: 217 passed, 0 failed, including malformed front matter, no-tools, and instruction bounds.
- `pnpm --filter @agent_cli/cli typecheck`: passed.
- Focused CLI tests: agent command 4/4; project `Agent.md` integration under inherited `INIT_CWD` 1/1; collaboration CLI file 14/14.
- Full CLI suite failed during compilation of concurrently added `model-budget.ts` / `model-routing.ts` (five TypeScript errors; unrelated in-flight work). Rerun after those sources stabilize; do not claim the gate passed.

## 2026-09-25 · follow-up

- Reproduced the earlier full CLI test failure under `INIT_CWD` and traced it to the CLI's documented `--cwd` > `DEV_AGENT_WORKING_DIRECTORY` > `INIT_CWD` > process cwd precedence. The test helper now explicitly passes `--cwd` for its temporary workspace.
- The project-agent integration now configures a global filesystem-only ceiling while its definition requests filesystem plus search, and verifies only filesystem reaches the specialist provider.
- Tightened malformed front matter handling and added explicit `toolAllowlist: []` semantics (no tools); inspection distinguishes no tools from an omitted allowlist.
- Verified Agent Core 217/217, CLI agent command 4/4, collaboration integration under inherited `INIT_CWD`, collaboration test file 14/14, CLI build/typecheck before concurrently authored model-routing sources changed, documentation contract 60/60, and `git diff --check`. The complete CLI suite is not yet green (independent in-flight TypeScript errors listed above).

## Release-gate audit

- Current-worktree `pnpm check` and `pnpm typecheck` passed; `git diff --check` and documentation contracts (60/60) passed after the documentation edits.
- The TypeScript release gate passed structure, workspace build, and workspace typecheck. Its package tests passed Agent Core 217/217 and CLI 688/688, including the new `:agents`/`:agent` integration and the discovered role's global tool-ceiling intersection.
- The gate stopped at Desktop package tests (317/318): the separately authored, currently untracked `github-pr-review.test.ts` expects `/truncated/i` in a large prompt that omitted the marker. `typescript-test` is failed, so package smoke and later contract stages did not run. Do not report a green release gate or modify that independently owned Desktop work here.
- Earlier CLI failures were due to shared-worktree updates during the run: a new Ink pointer-geometry commit and an in-flight command-hint edit. Both failed cases passed when rerun against current compiled artifacts; the release gate's stable CLI run passed 688/688.

## Capability-validation follow-up

- RED: a project `AGENT.md` with an unsupported provider and another with an unavailable tool made `:team plan` fail; the optional definitions were also misleadingly listed by `:agents`. An Agent Core test first failed because runtime capability options did not exist.
- GREEN: Agent Core now accepts optional supported provider/tool sets. The CLI passes its active model provider IDs and registered tool names during discovery, so invalid optional definitions are skipped before project-over-user precedence and role binding. Explicit JSON role validation still fails closed independently.
- Focused evidence: Agent Core 218/218; CLI build passed; the end-to-end discovery/team test passed under inherited `INIT_CWD`; agent command plus role resolution tests passed 8/8 before the added JSON strictness assertion.
- A TypeScript release-gate attempt during independent Skill Marketplace edits stopped at that untracked CLI module's temporary syntax errors. The module subsequently compiled on a fresh CLI build. Re-run the complete gate after the new regression test and concurrent work stabilize.

## Final TypeScript gate for this milestone

- Re-ran `pnpm verify:typescript --report` after the unrelated Skill Marketplace source stabilized. The release report records all 13 selected TypeScript steps as passed, including structure, workspace build/typecheck, full workspace tests, package install smoke, publication/preview/gate/CI/documentation contracts, and native Desktop bundle contracts.
- Package counts in this run: Agent Core 218/218; CLI 695/695; Desktop 320/320; documentation contract 60/60. The project-level Agent registry test skips unavailable providers/tools, and the CLI end-to-end test verifies `:agents`, `:agent`, and `:team plan` still work in their presence.
- `git diff --check` passed after source and documentation changes. This verifies the TypeScript phase only; no Rust or integration phase is claimed here.

## 2026-09-26 continuation

- Fixed isolated CLI integration discovery by passing the final temporary project through `--cwd` and `INIT_CWD`; this prevents pnpm's caller directory from overriding project-scoped Agent.md discovery.
- Corrected the provider-boundary regression test to select the discovered role by id instead of assuming it precedes built-in roles.
- Verification:
  - Agent Core build: passed.
  - Agent Definition Registry tests: 6 passed, 0 failed.
  - CLI typecheck and test compilation: passed.
  - Specialist role and agent command tests: 14 passed, 0 failed.
  - Previously failing CLI test-file subset: 103 passed, 0 failed.
  - Full CLI run: 602 passed, 17 failed; the 17 failures were file-level failures in the broader all-files run plus the stale role-selection assertion. The affected 16-file subset passes independently, and the corrected specialist suite passes.

## 2026-09-26 · provider-boundary hardening

- Added a project-definition trust-boundary rule: a discovered project Agent
  may select a model only within the active session provider. If it requests a
  different provider, both provider and model selectors are ignored and the
  specialist inherits the caller session; user JSON roles retain their
  explicit cross-provider behavior.
- Added `scope` metadata at the CLI role boundary so the restriction applies
  only to discovered project definitions, not trusted explicit configuration.
- `:agent <id>` now reports the requested provider/model and explains when the
  project selection is not applied.
- Added unit coverage for cross-provider suppression, same-provider model
  selection, trusted JSON cross-provider selection, and inspection output; the
  CLI integration covers a real project `AGENT.md` and OpenAI session.
- Focused evidence: CLI typecheck/test compilation passed; specialist-role and
  agent-command tests passed 13/13; collaboration CLI tests passed 15/15.
- Final focused verification after the provider-boundary hardening: full CLI
  suite passed 700/700 on September 26, 2026; scoped `git diff --check`
  passed. This is CLI evidence only and does not claim the repository-wide
  release gate, because unrelated Desktop and other shared-worktree changes
  remain in flight.
