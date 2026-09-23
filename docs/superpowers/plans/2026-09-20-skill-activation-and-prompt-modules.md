# Skill Activation and Modular Prompt Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing bounded `SkillRegistry` to the interactive CLI so users can discover and explicitly activate project or user skills, while keeping the base system prompt small and preserving the same behavior in the ANSI and Ink renderers.

**Architecture:** Keep skill discovery in `@dev-agent/agent-core`, add a small CLI command/prompt adapter for activation state, and inject only the active skill into `AgentLoop.systemPromptProvider`. Commands are handled before model execution in both interactive loops. Skill metadata shown in the terminal is sanitized and never exposes filesystem paths or full instruction bodies.

**Tech Stack:** TypeScript, pnpm workspace, Node test runner, `@dev-agent/agent-core` `SkillRegistry`, ANSI TTY renderer, Ink 6/React 19 renderer.

**Spec:** `docs/geminicli/gemini-cli-coding-agent-architecture-study.md`

## Global Constraints

- Do not load every skill into the base prompt; only an explicit `:skill <name>` or `/skill <name>` activation may add instructions.
- Project skills in `<working-directory>/.dev-agent/skills` continue to shadow user skills with the same name.
- Do not expose skill paths, raw file contents, terminal control sequences, or unbounded user-controlled text in terminal notices.
- Keep command semantics identical for ANSI and Ink TTYs, including `/` aliases normalized to `:`.
- Preserve non-interactive, one-shot, JSON, MCP server, and provider-free CLI contracts.
- Do not publish packages or make network releases.
- Every implementation task starts with a failing focused test, followed by the smallest production change that makes it pass.

---

## Task 1: Record the slice and add the failing CLI contract

**Files:**
- Modify: `docs/README.md`
- Modify: `task_plan.md`
- Modify: `apps/cli/tests/interactive.test.ts`

- [x] Add this plan to the documentation index and record the next active Gemini-inspired phase in `task_plan.md`.
- [x] Add an integration test that creates a temporary project skill, verifies `:skills` lists it, verifies `:skill <name>` activates it, and verifies the next provider request contains the bounded active instructions.
- [x] Run the focused CLI test and capture the expected RED failure before changing production code.

## Task 2: Add a pure skill command and prompt adapter

**Files:**
- Create: `apps/cli/src/skill-command.ts`
- Create: `apps/cli/tests/skill-command.test.ts`

- [x] Write unit tests for listing, activation, deactivation, usage, unknown skills, and explicit prompt wrapping.
- [x] Run the unit test in RED state.
- [x] Implement a small adapter around `SkillRegistry` that stores only the active `SkillDefinition`, returns structured command results, and creates an explicit model-facing prompt section.
- [x] Keep user-visible messages stable and free of paths or instruction bodies.
- [x] Run the focused unit test to GREEN.

## Task 3: Wire skills into both interactive renderers and modularize Prompt composition

**Files:**
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/tui-renderer.ts`
- Modify: `apps/cli/tests/interactive.test.ts`
- Modify: `apps/cli/tests/tui-renderer.test.ts`

- [x] Add the failing ANSI and Ink command tests for `:skills`, `:skill <name>`, and `:skill off`.
- [x] Load `SkillRegistry` once from the resolved working directory and keep activation state scoped to the current CLI session.
- [x] Handle skill commands before `runPrompt` in ANSI and Ink loops.
- [x] Inject the active skill section through `systemPromptProvider` while preserving the existing base prompt and MCP supplement.
- [x] Add command hints for `:skills` and `:skill <name>`, and ensure `/skills` and `/skill <name>` normalize identically.
- [x] Run focused renderer and interactive tests, then run the complete CLI suite.

## Task 4: Update user-facing guidance and verification evidence

**Files:**
- Modify: `apps/cli/README.md`
- Modify: `docs/README.md`
- Modify: `task_plan.md`
- Modify: `progress.md`

- [x] Document the skill directory layout, command syntax, explicit activation behavior, and project-over-user precedence.
- [x] Add a behavior evaluation covering skill discovery, activation, prompt injection, and deactivation without leaking instructions into the idle prompt.
- [x] Run CLI build, focused tests, full CLI tests, behavior evaluations, and `git diff --check`.
- [x] Record exact verification results and any deferred Gemini-inspired areas without claiming a package release.

## Verification

Completed on 2026-09-20:

- CLI build passed.
- Focused skill adapter, ANSI, Ink, and renderer tests passed.
- Full CLI suite passed **419/419**.
- Rich CLI behavior evaluations passed **6/6**.
- `git diff --check` passed.
- No npm publish, tag, release, or network package operation was performed.
