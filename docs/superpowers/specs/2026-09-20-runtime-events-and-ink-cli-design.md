# Runtime Events and Ink CLI Design

**Date:** 2026-09-20

**Status:** Approved implementation direction

## Goal

Evolve dev-agent from a strong single-agent CLI into a reusable agent platform
with one runtime event contract shared by CLI and Desktop, durable behavior
evaluation, checkpoint metadata, Skills, Hooks, richer tool metadata, and a
modern Ink-based interactive terminal experience inspired by Gemini CLI without
copying its source or directory structure.

## Current Baseline

The repository already has:

- `packages/agent-core` with the model/tool loop, context budgets, summaries,
  cancellation, approval, validation, usage accounting, and loop detection.
- `packages/tools` with filesystem, shell, git, search, and code-search tools.
- `packages/mcp` with stdio JSON-RPC, tools, resources, prompts, progress,
  cancellation, reconnect, and notification handling.
- `packages/executor` and `runtime/rust` with local and Rust-backed sandbox
  execution.
- `apps/cli` with a raw ANSI Signal Loom renderer, a blue composer, prompt
  queue, tool cards, approvals, status states, and PTY coverage.
- `apps/desktop` with an SSE stream and the same AgentLoop.

The current problem is boundary consistency rather than a missing core loop:
the CLI and Desktop expose similar concepts through separate event types, the
rich CLI renderer owns too much terminal bookkeeping, and platform extension
points are not first-class packages.

## Design Principles

1. Keep Agent Runtime independent from presentation.
2. Preserve all existing non-rich CLI contracts.
3. Add new interfaces beside working behavior before removing compatibility
   paths.
4. Make every user-visible run reconstructable from ordered runtime events.
5. Use Ink only for interactive TTY rendering; do not force React into
   `--once`, pipe, JSON, or MCP-server modes.
6. Treat checkpoint metadata and filesystem rollback as related but distinct:
   a checkpoint can identify required workspace evidence, but it must not
   silently mutate files during a conversation restore.
7. Load Skills on demand and keep Hooks observable, bounded, and cancellable.
8. Defer Scheduler, additional sandbox backends, ACP, and A2A until the
   single-agent event and evaluation contracts are stable.

## Target Architecture

```text
                         CLI / Desktop
                              │
                     RuntimeEvent stream
                              │
                        Agent Runtime
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
   AgentLoop             ToolRegistry          Session/Checkpoint
       │                      │                      │
   Context               Policy/Approval        FileMemory
       │                      │                      │
   Model Router       Executor/Sandbox       Change-set evidence
       │                      │
       └────────────── Runtime Events
```

The new shared package is `packages/runtime-events` and is published inside
the workspace as `@dev-agent/runtime-events`. It owns only event contracts,
validation, sequence helpers, and sink interfaces. It does not render terminal
escape sequences, write files, or know about HTTP.

The CLI rich mode is migrated to:

```text
apps/cli/src/ink/
├── app.tsx
├── composer.tsx
├── transcript.tsx
├── status-bar.tsx
├── tool-card.tsx
├── welcome.tsx
└── terminal-adapter.ts
```

The existing raw ANSI renderer remains available as a fallback while Ink is
being verified. The final selection rule is:

- interactive TTY: Ink renderer;
- non-TTY, `--once`, `--json`, pipe, and `--mcp-server`: current line-oriented
  path;
- `DEV_AGENT_TUI=ansi`: explicit compatibility fallback for diagnostics.

## Shared Runtime Event Contract

Every event has a stable envelope:

```ts
export interface RuntimeEventEnvelope<TType extends RuntimeEventType, TData> {
  readonly version: 1;
  readonly sequence: number;
  readonly emittedAt: string;
  readonly sessionId: string;
  readonly runId?: string;
  readonly type: TType;
  readonly data: TData;
}
```

The initial event union is:

```ts
export type RuntimeEvent =
  | RuntimeEventEnvelope<"session.started", SessionStarted>
  | RuntimeEventEnvelope<"input.submitted", InputSubmitted>
  | RuntimeEventEnvelope<"input.queued", InputQueued>
  | RuntimeEventEnvelope<"run.started", RunStarted>
  | RuntimeEventEnvelope<"run.status", RunStatusChanged>
  | RuntimeEventEnvelope<"assistant.delta", AssistantDelta>
  | RuntimeEventEnvelope<"assistant.completed", AssistantCompleted>
  | RuntimeEventEnvelope<"tool.started", ToolStarted>
  | RuntimeEventEnvelope<"tool.progress", ToolProgress>
  | RuntimeEventEnvelope<"tool.approval-requested", ToolApprovalRequested>
  | RuntimeEventEnvelope<"tool.approval-resolved", ToolApprovalResolved>
  | RuntimeEventEnvelope<"tool.completed", ToolCompleted>
  | RuntimeEventEnvelope<"tool.failed", ToolFailed>
  | RuntimeEventEnvelope<"validation.started", ValidationStarted>
  | RuntimeEventEnvelope<"validation.completed", ValidationCompleted>
  | RuntimeEventEnvelope<"checkpoint.created", CheckpointCreated>
  | RuntimeEventEnvelope<"run.completed", RunCompleted>
  | RuntimeEventEnvelope<"run.interrupted", RunInterrupted>
  | RuntimeEventEnvelope<"run.failed", RunFailed>;
```

The contract deliberately separates:

- `input.queued` from `run.started`, so a prompt waiting behind an active run
  is never mistaken for a second active run.
- `assistant.delta` from `assistant.completed`, so renderers can stream without
  inventing completion events.
- `tool.approval-requested` from `tool.started`, so a tool waiting for a user
  decision cannot appear to be executing.
- `run.interrupted` from `run.failed`, so Ctrl-C, Escape, EOF, and provider
  errors remain distinguishable.

Events are ordered per session by `sequence`. Consumers must tolerate unknown
future event types and ignore events from a different session or run.

## CLI and Desktop Migration

`AgentLoop` will gain an optional `eventSink` in addition to its existing
callbacks. Existing callbacks remain in place until all consumers have moved.
The loop emits model, tool, approval, validation, usage, completion, and
interruption events. The CLI queue emits input events because queue ownership
belongs to the client, not the core runtime.

Desktop will expose the same event payloads over SSE with a thin transport
adapter. Existing `StreamEvent` names remain readable during migration but are
derived from `RuntimeEvent`; new clients consume the shared event names.

The CLI `TuiSessionModel` becomes a projection of `RuntimeEvent`, and both the
ANSI fallback and Ink renderer consume that projection. This removes the
current split between `TuiSessionEvent` and Desktop `StreamEvent` without
forcing a big-bang rewrite.

## Ink Experience

The Ink renderer will reproduce the current Signal Loom information hierarchy
with a more stable component tree:

```text
Signal Loom
├── Welcome / runtime summary
├── Transcript
│   ├── submitted prompt
│   ├── queued prompt
│   ├── assistant streaming block
│   ├── tool card
│   └── approval / validation card
├── Runtime status
├── Composer
│   ├── multiline editor
│   ├── `/` and `:` command palette
│   └── queue count
└── Session footer
    ├── working directory
    ├── model/provider
    └── executor state
```

The selected dependency line is Ink 6 with React 19 because the repository
supports Node 20. Ink 7 currently raises the Node floor to 22, which would
violate the project’s existing engine contract.

The composer is a custom Ink component using `useInput`, not a third-party
single-line prompt. It must preserve:

- multiline editing and cursor movement;
- history;
- command completion after `/` or `:`;
- blue focus frame;
- queued prompt rendering while a run is active;
- Ctrl-C, Escape, visible `^C`, EOF, and resize behavior;
- one active input cursor only.

## Behavior Evaluation

Create a root `evals/` suite that launches the built CLI through a PTY and
asserts user-visible behavior rather than internal methods. The first matrix
covers:

- one prompt produces one request and one answer;
- a second prompt during streaming becomes queued and is sent after the first
  run completes;
- answer blocks stay attached to their own prompt;
- no duplicate response, footer, cursor, or tool-card frame appears;
- tool approval waits, resolves, and resumes the same run;
- Ctrl-C and Escape interrupt active and idle states;
- visible `^C` and EOF terminate cleanly;
- narrow terminal widths do not overlap the composer or footer;
- resize redraws the active composer once;
- repeated tool failures stop at the configured loop boundary.

Existing package tests remain as fast unit/contract tests. `evals/` becomes the
cross-component behavior gate and should run through a dedicated
`pnpm test:evals` script.

## Checkpoint Interface

Add a core `CheckpointStore` abstraction:

```ts
export interface AgentCheckpoint {
  readonly id: string;
  readonly sessionId: string;
  readonly workingDirectory: string;
  readonly createdAt: string;
  readonly lastEntryId?: string;
  readonly entryCount: number;
  readonly changeSetIds: readonly string[];
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface CheckpointStore {
  create(context: AgentContext, options?: CreateCheckpointOptions): Promise<AgentCheckpoint>;
  list(sessionId: string): Promise<readonly AgentCheckpoint[]>;
  inspect(id: string): Promise<AgentCheckpoint | undefined>;
  restore(id: string): Promise<CheckpointRestoreResult>;
}
```

The first implementation persists checkpoint metadata in `FileMemory`. Restore
returns the target memory anchor and referenced change-set evidence; it does
not silently rewrite workspace files. A future workspace-aware restore can
explicitly invoke the existing guarded filesystem rollback path after a user
confirmation.

## Skills and Hooks

Skills are named, bounded instruction bundles loaded on demand:

```ts
export interface SkillDefinition {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly resourcePaths: readonly string[];
}
```

`SkillRegistry` loads project-local `.dev-agent/skills` first, then the user
skill directory, with fixed file-size and resource-count limits. Skill
instructions are added through the existing `systemPromptProvider`; they are
not silently injected into persisted user messages.

Hooks are lifecycle observers with explicit cancellation and error policy:

```ts
export type AgentHookName =
  | "session.start"
  | "before.model"
  | "after.model"
  | "before.tool"
  | "after.tool"
  | "session.end";
```

Hooks receive sanitized runtime event context. A failing observer hook is
recorded and does not change a successful run; a future policy hook may
explicitly deny a tool through the existing approval layer.

## Tool Metadata

Extend `AgentTool` with backward-compatible metadata:

```ts
export type ToolRisk = "read-only" | "mutating" | "dangerous";
export type ToolConfirmation = "never" | "on-risk" | "always";

export interface AgentToolMetadata {
  readonly risk: ToolRisk;
  readonly confirmation: ToolConfirmation;
  readonly resultFormat?: "text" | "json" | "diff" | "summary";
  readonly supportsProgress?: boolean;
}
```

Existing tools receive conservative defaults. Approval policy remains the
security authority; metadata informs the policy and renderers but never grants
permission by itself.

## Deferred Work

The following are recorded as later phases, not hidden requirements of the
first migration:

- Scheduler and durable background task state.
- Docker, Podman, Windows, and dynamic sandbox expansion backends.
- ACP protocol integration.
- A2A and multi-agent orchestration.

A2A stays last because the single-agent loop, event protocol, and evaluation
suite must be stable first.

## Acceptance Criteria

The migration is accepted only when:

1. Shared runtime events are consumed by both CLI and Desktop.
2. Rich TTY mode runs through Ink while all non-rich contracts remain green.
3. The behavior suite proves queue ordering, cursor ownership, interruption,
   approvals, tool-card lifecycle, resize, EOF, and loop termination.
4. FileMemory-backed checkpoint metadata can be created, listed, inspected, and
   restored without silently changing workspace files.
5. Skills and Hooks have bounded, tested loading and lifecycle behavior.
6. Tool metadata is exposed through the registry and used by rendering/policy
   without bypassing approval.
7. `pnpm build`, focused tests, `pnpm test:evals`, `pnpm verify`, and
   `git diff --check` pass.

## Non-Goals

- Copying Gemini CLI source, branding, or directory structure.
- Replacing the AgentLoop with a React component.
- Rewriting non-interactive CLI output.
- Adding multi-agent behavior before single-agent reliability is proven.
