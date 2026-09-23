# Shared Prompt Composition Plan
> **For agentic workers:** Follow the repository's test-first workflow. Every
> implementation task starts with a focused failing test and ends with the
> relevant verification gates.

**Goal:** Turn the CLI and Desktop system prompts into explicit, testable
modules while preserving the current behavior and keeping runtime context
injection bounded and visible to the AgentLoop.

**Architecture:** Put the generic prompt composer and the default coding-agent
modules in `@dev-agent/agent-core`. The CLI will compose its base, evidence,
audit, active-skill, and MCP modules at the point where `systemPromptProvider`
is evaluated. Desktop will use the same composer for its default prompt while
continuing to honor an explicit `systemPrompt` override.

**Tech Stack:** TypeScript, pnpm workspace, Node test runner, shared
`@dev-agent/agent-core` runtime, CLI ANSI/Ink frontends, Desktop chat session.

**Spec:** `docs/geminicli/gemini-cli-coding-agent-architecture-study.md`,
sections 20, 21, and 30.

## Constraints

- Preserve the current CLI evidence, audit, and response-contract guidance.
- Preserve the current Desktop custom `systemPrompt` override as the first
  caller-controlled section; AgentLoop runtime metadata remains appended.
- Do not load Skills or MCP metadata into the base prompt unless the current
  session explicitly provides them.
- Keep module composition deterministic and reject duplicate module IDs.
- Do not expose filesystem paths, raw skill files, or unbounded user text.
- Keep the change independent from queueing, streaming, approval, and
  checkpoint behavior already verified in the rich TTY.
- Do not publish packages or make network releases.

## Tasks

### Task 1: Define the shared prompt contract

- [x] Add focused tests for deterministic ordering, blank/disabled modules, and
  duplicate IDs.
- [x] Add `PromptModule` and `composePrompt` to `@dev-agent/agent-core`.
- [x] Export the shared prompt module from the package entry point.

### Task 2: Extract the CLI prompt into modules

- [x] Add the failing integration assertion that the CLI still receives the
  evidence, audit, and response-contract guidance.
- [x] Move the existing CLI guidance into named default modules.
- [x] Compose the base prompt, active Skill section, and MCP supplement through
  the shared composer.

### Task 3: Use the same composition boundary in Desktop

- [x] Add a Desktop test for the default prompt path and custom override path,
  including the existing runtime metadata envelope.
- [x] Compose the default Desktop prompt through `@dev-agent/agent-core`.
- [x] Keep the custom Desktop prompt text unchanged before the existing runtime
  metadata envelope.

### Task 4: Verify and document

- [x] Update `task_plan.md`, `progress.md`, and the documentation index.
- [x] Run focused Agent Core, CLI, and Desktop tests.
- [x] Run CLI build, Desktop build, full relevant suites, behavior evaluations,
  and `git diff --check`.

## Acceptance

The phase is complete only when the shared prompt contract and the existing
queue/streaming/approval behavior remain green together. This phase changes
prompt assembly only; package publishing, release tags, and network releases
are explicitly out of scope.

## Verification

Completed on 2026-09-20:

- Agent Core Prompt tests passed; the full Agent Core suite passed **148/148**.
- CLI build and typecheck passed; the full CLI suite passed **419/419**.
- Desktop build passed; the full Desktop suite passed **140/140**.
- CLI rich-TTY behavior evaluations passed **6/6**.
- The fixed `pnpm verify:typescript` gate passed, including Tools **152/152**,
  documentation contracts **57/57**, package install smoke, and release
  boundary contracts.
- `git diff --check` passed.
- No npm publish, tag, release, or network package operation was performed.
