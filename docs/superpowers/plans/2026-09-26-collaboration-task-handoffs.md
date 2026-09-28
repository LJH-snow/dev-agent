# Collaboration Task Handoffs Implementation Plan

> **For agentic workers:** implement this plan task-by-task with focused RED/GREEN tests.

**Goal:** Turn collaboration dependency edges into bounded, explicit context handoffs without weakening isolation or authorization.

**Spec:** `docs/superpowers/specs/2026-09-26-collaboration-task-handoffs-design.md`

**Status (2026-09-28): complete.** Tasks 1–3 shipped in `packages/agent-core/src/collaboration-execution.ts`
with regression coverage in `packages/agent-core/tests/collaboration-execution.test.ts`
("passes a bounded direct dependency handoff to downstream workers",
independent-task isolation, bounded summaries, retry/failed-dependency blocking).
Task 4 records: `docs/architecture.md` documents the bounded handoff projection
and untrusted labeling, `docs/gemini-cli-architecture-alignment.md` documents
the information handoff, and
`.planning/2026-09-26-worker-scoped-mcp/progress.md` carries the closure note.
Verification: agent-core typecheck clean, full agent-core suite 222/222,
`git diff --check` clean.

## Task 1: Define the bounded handoff projection

- Modify `packages/agent-core/src/collaboration-execution.ts`.
- Add a provider-neutral handoff projection with no workspace path or raw error fields.
- Add constants and helpers for per-handoff and aggregate prompt limits.

## Task 2: Inject direct dependency handoffs into worker prompts

- Build handoffs from completed dependency results immediately before each AgentLoop run.
- Append an explicitly untrusted `DEPENDENCY HANDOFFS` section to the task prompt.
- Keep retries deterministic and do not expose failed-attempt partial output.

## Task 3: Add regression coverage

- Extend `packages/agent-core/tests/collaboration-execution.test.ts` for:
  - direct dependency handoff;
  - independent-task isolation;
  - bounded handoff content;
  - retry behavior and failed dependency blocking.
- Run Agent Core focused and full suites, then the CLI suite.

## Task 4: Document the information-flow boundary

- Update `docs/architecture.md` and `docs/gemini-cli-architecture-alignment.md`.
- Update `.planning/2026-09-26-worker-scoped-mcp/progress.md` or create a dedicated progress note.
- Run `git diff --check` and record exact verification counts.
