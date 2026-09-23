# Tool-Level Sandbox Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an explicitly selected Rust executor enforce a bounded sandbox profile for executor-backed tools while preserving local execution as the default.

**Architecture:** `@dev-agent/agent-core` will expose a provider-neutral optional sandbox profile in `ToolExecutionContext` and resolve it per tool call through `AgentLoopOptions`. `@dev-agent/tools` will route Shell, Git, and Search through `SandboxExecutor.runSandboxed()` whenever a profile is present and fail closed when the selected executor cannot enforce it. CLI, Desktop, and MCP server entry points will supply workspace-write or read-only profiles only when the selected executor exposes the Rust sandbox capability.

**Tech Stack:** TypeScript 5, Node.js 20, pnpm workspace, Node test runner, existing `Executor`/`SandboxExecutor` protobuf boundary, Rust `sandbox-exec`/`bwrap` runtime.

**Spec:** `docs/geminicli/gemini-cli-coding-agent-architecture-study.md`, sections 18-19 and 35-37.

## Global Constraints

- Local execution remains the default and must not silently change behavior.
- `rust-sandbox` must fail closed if the runtime is unavailable or a tool cannot enforce the requested profile.
- The profile must never grant writes outside the current working directory.
- Read-only search runs with no writable paths and disabled network; shell and Git retain enabled network for existing developer workflows.
- Direct `FilesystemTool` mutations continue to use the existing workspace path and approval/change-set guards; this phase does not move them into a separate process.
- Do not add Docker, Podman, ACP, A2A, or a new policy language in this phase.
- Do not publish packages, create a release, or perform a network release operation.

---

### Task 1: Define the provider-neutral sandbox contract

**Files:**
- Modify: `packages/agent-core/src/tools.ts`
- Modify: `packages/agent-core/src/loop.ts`
- Modify: `packages/agent-core/src/index.ts` only if the new types need an explicit export
- Test: `packages/agent-core/tests/agent-loop.test.ts` or a focused new `packages/agent-core/tests/tool-sandbox.test.ts`

**Interfaces:**
- Produce:
  ```ts
  export type ToolSandboxNetworkPolicy = "enabled" | "disabled" | "loopback";

  export interface ToolSandboxProfile {
    readonly name: string;
    readonly network?: ToolSandboxNetworkPolicy;
    readonly writablePaths?: readonly string[];
    readonly readonlyPaths?: readonly string[];
    readonly environment?: Readonly<Record<string, string | undefined>>;
    readonly timeoutMs?: number;
  }

  export interface ToolExecutionContext {
    readonly sessionId: string;
    readonly workingDirectory: string;
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: ToolProgress) => void;
    readonly sandbox?: ToolSandboxProfile;
  }

  export interface AgentLoopOptions {
    readonly toolSandboxProfile?: (
      toolName: string,
      context: AgentContext
    ) => ToolSandboxProfile | undefined;
  }
  ```
- Consume: existing `AgentContext`, `ToolExecutionContext`, and `AgentLoopOptions`.

- [x] **Step 1: Write the failing test**

Add a test tool that records its `ToolExecutionContext` and run an `AgentLoop`
with:

```ts
toolSandboxProfile: (toolName, context) => ({
  name: `${toolName}-workspace`,
  network: "disabled",
  writablePaths: [context.workingDirectory],
}),
```

Assert that the recorded context contains the exact profile and that a loop
without the option records no sandbox profile.

- [x] **Step 2: Run the focused test to verify it fails**

Run:

```bash
pnpm --filter @dev-agent/agent-core run test -- tool-sandbox
```

Expected: FAIL because `AgentLoopOptions` and `ToolExecutionContext` do not
yet carry the profile.

- [x] **Step 3: Write the minimal implementation**

Store the resolver in `AgentLoop`, call it immediately before `runToolSafely`,
and add `sandbox` to the context object only when the resolver returns a
profile. Do not create a default profile inside Agent Core.

- [x] **Step 4: Run the focused test to verify it passes**

Run the same command and expect the new test plus the existing Agent Core
tests to pass.

- [x] **Step 5: Refactor only after green**

Keep the contract in `tools.ts`, where the existing tool metadata and execution
context already live; avoid a new package dependency from Agent Core to
Executor.

### Task 2: Route built-in command tools through sandbox profiles

**Files:**
- Create: `packages/tools/src/executor-run.ts`
- Modify: `packages/tools/src/shell.ts`
- Modify: `packages/tools/src/git.ts`
- Modify: `packages/tools/src/search.ts`
- Test: `packages/tools/tests/tools-edge-cases.test.ts`

**Interfaces:**
- Produce:
  ```ts
  export function runExecutorCommand(
    executor: Executor,
    command: string,
    args: readonly string[],
    context?: ToolExecutionContext
  ): Promise<ExecutorResult>;
  ```
- Consume: `Executor`, `SandboxExecutor`, `ExecutorRunOptions`, and the new
  `ToolExecutionContext.sandbox`.

- [x] **Step 1: Write failing tests**

Extend the recording executor fixture with both methods:

```ts
async run(command, args, options) {
  calls.push({ kind: "run", command, args, options });
  return result;
}
async runSandboxed(command, args, options) {
  calls.push({ kind: "sandboxed", command, args, options });
  return result;
}
```

Add tests proving Shell, Git, and Search call `runSandboxed` with the exact
profile when one is present, and add a test using an executor that only
implements `run` which rejects with:

```text
sandbox execution requested but the selected executor does not support sandbox profiles
```

Keep the existing no-profile assertions expecting ordinary `run`.

- [x] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
pnpm --filter @dev-agent/tools run test -- tools-edge-cases
```

Expected: FAIL because the three tools currently always call `executor.run`.

- [x] **Step 3: Write the minimal shared adapter**

Build ordinary options from `workingDirectory` and `signal`. If
`context.sandbox` is absent, call `executor.run`. If it is present, require a
callable `runSandboxed` method and pass the profile without changing the
command/argument arrays.

- [x] **Step 4: Migrate Shell, Git, and Search**

Replace their duplicated executor option construction with
`runExecutorCommand`. Do not change FilesystemTool or CodeSearchTool in this
phase.

- [x] **Step 5: Run focused and package tests**

Run:

```bash
pnpm --filter @dev-agent/tools run test
pnpm --filter @dev-agent/tools run typecheck
```

Expected: all existing tool behavior remains green and the new sandbox
dispatch tests pass.

### Task 3: Provide bounded workspace profiles at application edges

**Files:**
- Modify: `packages/executor/src/index.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/desktop/src/chat-session.ts`
- Modify: `apps/cli/src/index.ts` MCP server adapter path
- Test: `packages/executor/tests/executor.test.ts`
- Test: `apps/cli/tests/rust-executor-wiring.test.ts`
- Test: `apps/desktop/tests/chat-session-config.test.ts` or a focused new test

**Interfaces:**
- Produce:
  ```ts
  export function createWorkspaceSandboxProfile(
    workingDirectory: string,
    intent: "read-only" | "workspace-write"
  ): SandboxProfile;
  ```
- Consume: `Executor.mode`, `SandboxExecutor.runSandboxed`, and
  `AgentLoopOptions.toolSandboxProfile`.

- [x] **Step 1: Write failing profile tests**

Assert that:

```ts
createWorkspaceSandboxProfile("/repo", "read-only")
```

returns a stable profile with `network: "disabled"` and no writable paths,
while `"workspace-write"` returns `network: "enabled"` and exactly
`writablePaths: ["/repo"]`.

Add an application wiring regression with a reflect-style Rust fixture that
proves a selected `rust-sandbox` tool call receives a `run_sandboxed` envelope
and a workspace profile, while local mode continues to use the ordinary
executor path.

- [x] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
pnpm --filter @dev-agent/executor run test -- executor
pnpm --filter @agent_cli/cli run test -- rust-executor-wiring
```

Expected: FAIL because no profile factory or loop resolver is wired at the
application boundary.

- [x] **Step 3: Implement the profile factory**

Validate the working directory is non-empty and return only the fixed
workspace profile shape. Do not accept model-provided paths or arbitrary
profile fields from CLI input.

- [x] **Step 4: Wire CLI and Desktop**

When the selected executor is a Rust sandbox, pass a resolver to each
`AgentLoop`:

```ts
toolSandboxProfile: (toolName, context) =>
  toolName === "search"
    ? createWorkspaceSandboxProfile(context.workingDirectory, "read-only")
    : createWorkspaceSandboxProfile(context.workingDirectory, "workspace-write"),
```

When the executor is local, omit the resolver. Wire the same profile into the
CLI MCP server adapter so direct MCP tool calls do not bypass the boundary.

- [x] **Step 5: Run focused application tests**

Run:

```bash
pnpm --filter @dev-agent/executor run test
pnpm --filter @agent_cli/cli run test -- rust-executor-wiring
pnpm --filter @agent_desktop/desktop run test -- chat-session-config
```

Expected: all focused tests pass without changing the local default.

### Task 4: Document and verify the sandbox boundary

**Files:**
- Modify: `packages/executor/README.md`
- Modify: `packages/agent-core/README.md`
- Modify: `packages/tools/README.md`
- Modify: `apps/cli/README.md`
- Modify: `docs/architecture.md`
- Modify: `task_plan.md`
- Modify: `progress.md`

- [x] **Step 1: Document behavior**

Document that `--executor rust-sandbox` now routes Shell/Git/Search through a
profiled Rust sandbox, that local execution remains the default, that
read-only search disables network and writes, and that FilesystemTool retains
its existing direct path/approval boundary.

- [x] **Step 2: Run the complete verification**

Run:

```bash
pnpm --filter @dev-agent/agent-core run test
pnpm --filter @dev-agent/tools run test
pnpm --filter @dev-agent/executor run test
pnpm --filter @agent_cli/cli run test
pnpm test:evals
pnpm verify:typescript
git diff --check
```

Expected: all selected suites and the fixed TypeScript gate pass; no package
publish or release operation is performed.

- [x] **Step 3: Mark the plan complete**

## Completion Record

Completed on 2026-09-21.

- Agent Core: **174/174**
- Tools: **158/158**
- Executor: **56/56**
- CLI: **444/444**
- Desktop: **144/144**
- MCP: **69/69**
- Rich CLI behavior evaluations: **6/6**
- `pnpm verify:typescript`: passed
- `git diff --check`: passed
- No npm publish, tag, release, or network package operation was performed.

Record the exact passing counts and the explicit local-vs-Rust behavior in the
plan, `task_plan.md`, and `progress.md`.
