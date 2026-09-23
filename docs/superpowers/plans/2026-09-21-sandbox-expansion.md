# Sandbox Expansion Implementation Plan

> Date: 2026-09-21
> Scope: Agent Core, Rust executor adapter, built-in tools, CLI, Desktop

**Goal:** Implement Gemini CLI-inspired sandbox expansion for a denied tool
execution: preserve the default sandbox profile, expose a structured
permission request, require an explicit user decision, and retry the same tool
call at most once with a bounded expanded profile.

**Architecture:** The Rust executor reports policy/sandbox denials through a
typed TypeScript error. Agent Core owns the one-retry state machine and emits
runtime events around the expansion request and decision. Application edges
decide how to ask the user and may return only a caller-constructed profile.
The built-in profile factory expands network access only; no model-provided
policy script or arbitrary filesystem path can widen a sandbox. Non-interactive
and MCP server paths fail closed when no approval requester is available.

**Tech Stack:** TypeScript, Node.js 20+, pnpm workspaces, Node test runner,
Rust stdio/protobuf executor, React + Ink CLI, Desktop SSE approval transport.

## Requirements

- Decode `SANDBOX_DENIED` and the existing `POLICY_DENIED` compatibility code
  into a typed error with a bounded capability classification.
- Allow one expansion attempt for one tool call; never loop on repeated denial.
- Require an explicit approval callback before retrying.
- Keep the original profile immutable and preserve all existing limits when
  expanding network access.
- Emit `tool.sandbox-expansion-requested` and
  `tool.sandbox-expansion-resolved` runtime events.
- Show the request in the CLI approval channel and Desktop approval channel.
- Deny expansion in non-interactive CLI and MCP paths without waiting for
  stdin or a client that cannot answer.
- Keep local executor behavior unchanged and do not publish packages.

## Global Constraints

- Do not accept a profile, policy script, or path directly from model output.
- Retry the original command and arguments exactly as received.
- Expansion approval is separate from ordinary dangerous-command approval.
- A denied or unavailable expansion becomes a normal tool failure so the model
  can adapt; it must not bypass the existing approval policy.
- Keep error messages bounded and do not expose credentials or absolute paths
  beyond the existing tool input/result contracts.
- Update `task_plan.md`, `progress.md`, and this plan when behavior changes.

## Tasks

### Task 1: Type the sandbox denial and expansion contracts

**Files:**

- Modify: `packages/executor/src/errors.ts`
- Modify: `packages/executor/src/rust-executor.ts`
- Modify: `packages/agent-core/src/tools.ts`
- Modify: `packages/agent-core/src/loop.ts`
- Modify: `packages/agent-core/src/index.ts`

**Tests first:**

- Modify: `packages/executor/tests/rust-executor.test.ts`
- Modify: `packages/agent-core/tests/agent-loop.test.ts`

- [x] Add a failing Rust adapter test proving `POLICY_DENIED` becomes a typed
      sandbox denial with a stable capability.
- [x] Add a failing Agent Loop test proving an approved expansion retries once
      with the returned profile and preserves the original tool input.
- [x] Add a failing test proving a denied expansion is reported to the model
      and is not retried.
- [x] Add `SandboxExpansionRequest`, `SandboxExpansionDecision`, and the
      structural denial guard to Agent Core.
- [x] Add the `onSandboxExpansion` callback to `AgentLoopOptions`.
- [x] Implement the bounded one-retry state machine in `runToolSafely`.

### Task 2: Add runtime event coverage

**Files:**

- Modify: `packages/runtime-events/src/index.ts`
- Modify: `packages/runtime-events/tests/events.test.ts`
- Modify: `apps/cli/src/tui-session.ts`
- Modify: `apps/cli/src/ink/runtime-store.ts` only if the event projection
  needs a store-specific update

- [x] Add request and resolution payloads with tool, capability, reason, and
      decision metadata.
- [x] Project expansion requests into the existing approval card surface.
- [x] Keep ordinary approval and sandbox expansion events distinguishable in
      the event stream and card detail.
- [x] Add event sequence/replay coverage.

### Task 3: Bound profile expansion in built-in tools

**Files:**

- Modify: `packages/tools/src/sandbox-profile.ts`
- Modify: `packages/tools/src/index.ts`
- Modify: `packages/tools/tests/tools.test.ts`

- [x] Add a network-only expansion helper.
- [x] Preserve writable/readonly paths, environment, timeout, and profile
      identity metadata.
- [x] Return `undefined` for unknown capabilities and unsupported profiles.
- [x] Add tests for immutability, network expansion, and fail-closed cases.

### Task 4: Wire CLI approval and fail-closed non-interactive behavior

**Files:**

- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/tests/interactive.test.ts`
- Modify: `apps/cli/tests/rust-executor-wiring.test.ts`

- [x] Add the interactive expansion question to the existing shared
      `QuestionBox` path.
- [x] Render the expansion request/resolution through ANSI and Ink approval
      surfaces without opening a second stdin reader.
- [x] Return a denial when the CLI has no interactive approval requester.
- [x] Verify a sandbox denial followed by approval sends the same command with
      the expanded profile once.
- [x] Verify a denial does not hang, duplicate tool cards, or rerun twice.

### Task 5: Wire Desktop SSE approval

**Files:**

- Modify: `apps/desktop/src/chat-session.ts`
- Modify: `apps/desktop/src/server.ts` only if request metadata must be
      exposed to the approval endpoint
- Modify: `apps/desktop/tests/approval-interactive.test.ts`
- Modify: `apps/desktop/tests/chat-session-e2e.test.ts`

- [x] Reuse the existing approval requester with a sandbox-specific reason.
- [x] Emit a stable `approval-request` followed by `approval` and runtime
      resolution events.
- [x] Deny on timeout, abort, disconnect, or absent requester.
- [x] Verify the expansion does not weaken ordinary approval mode behavior.

### Task 6: Documentation and verification

**Files:**

- Modify: `task_plan.md`
- Modify: `progress.md`
- Modify: `docs/geminicli/gemini-cli-coding-agent-architecture-study.md`
- Modify: `docs/superpowers/plans/2026-09-21-sandbox-expansion.md`

- [x] Record the bounded scope and the non-interactive fail-closed rule.
- [x] Run focused executor, Agent Core, runtime event, tools, CLI, and Desktop
      tests.
- [x] Run the full TypeScript verification gate and relevant rich TTY evals.
- [x] Run `git diff --check`.
- [x] Confirm no publish, tag, release, or package network operation occurred.

## Completion Record

Completed on 2026-09-21. The executor now preserves sandbox denials as typed
errors, Agent Core performs one bounded approval-and-retry transition, and CLI
and Desktop reuse their existing approval transports. Built-in expansion only
enables network access on an existing fixed profile; path and policy expansion
remain unavailable.

Verified locally with:

- Agent Core: **176/176**
- Executor: **57/57**
- Tools: **159/159**
- CLI: **450/450**
- Desktop: **144/144**
- `pnpm verify:typescript`
- `git diff --check`

No npm publish, tag, release, or package network operation was performed.

## Verification Commands

```text
pnpm --filter @dev-agent/executor test
pnpm --filter @dev-agent/agent-core test
pnpm --filter @dev-agent/tools test
pnpm --filter @dev-agent/runtime-events test
pnpm --filter @agent_cli/cli test
pnpm --filter @dev-agent/desktop test
pnpm verify:typescript
pnpm test:evals
git diff --check
```
