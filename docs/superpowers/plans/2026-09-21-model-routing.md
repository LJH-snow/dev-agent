# 2026-09-21 Shared Model Routing and Streaming-Safe Fallback

## Goal

Move the provider-neutral part of model routing into `@dev-agent/model` while
preserving the CLI's existing profile and alias resolution. A provider failure
may select the next explicitly configured route, but a streaming response that
has already emitted visible output must never switch models and replay the
request.

## Architecture

```text
AgentLoop
    |
    v
ModelProvider
    |
    v
ModelRouter
    |-- primary provider
    |-- lazy fallback resolver
    `-- bounded, metadata-only selection callback
```

The router owns invocation semantics and stream safety. The CLI remains
responsible for profile, alias, credential, and fallback-order resolution.
Desktop keeps its current single-provider configuration until it has an
explicit model-profile contract; this phase must not invent a second config
format.

## Tasks

### Task 1: Lock the shared router contract with RED tests

- Add model-package tests for:
  - chat fallback before any response is visible;
  - lazy, bounded fallback selection;
  - aborts do not trigger fallback;
  - stream fallback before the first token;
  - no fallback after an answer or reasoning token was emitted;
  - selection callbacks contain provider/model metadata but no raw errors.
- Add a CLI regression proving an interrupted stream does not invoke the next
  configured provider.
- Run the focused tests and confirm they fail for the missing shared behavior.

### Task 2: Implement `ModelRouter`

- Add a provider-neutral router to `@dev-agent/model`.
- Classify failures into bounded categories.
- Keep fallback selection lazy and at most one visit per returned route.
- Wrap stream callbacks to track visible output and fail closed against replay.
- Preserve the original error when no fallback is available.

### Task 3: Migrate CLI fallback to the shared router

- Replace the duplicated invocation loop in `apps/cli/src/fallback-provider.ts`
  with the shared router.
- Keep `model-profiles.ts` as the source of selection policy and configuration
  validation.
- Preserve existing provider/model metadata and fallback cycle behavior.
- Add the migration note to package architecture documentation.

### Task 4: Verify and record the phase

- Run model and CLI focused tests.
- Run `pnpm test:evals`, the fixed TypeScript gate, and `git diff --check`.
- Update `task_plan.md` and `progress.md` with exact evidence.
- Do not publish packages, create a release, or change Desktop's config shape.

## Acceptance Criteria

- A failed non-streaming primary call can use the next explicitly configured
  provider without constructing fallback providers in advance.
- A failed stream before its first visible token can use the next provider.
- A stream that emitted any answer/reasoning token rethrows the original error
  and never invokes a fallback provider.
- Aborted calls rethrow without fallback.
- Existing CLI selection, approval, tool, queue, and output contracts remain
  unchanged.
