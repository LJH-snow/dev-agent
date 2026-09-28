# Collaboration Task Handoffs Design

Date: 2026-09-26

## Goal

Make collaboration task dependencies carry bounded, explicit handoff context.
A dependency edge must mean more than scheduling: when a task starts, it should
receive a concise summary of the completed prerequisite tasks while independent
tasks remain isolated.

## Problem

`createCollaborativeExecution` currently waits for dependencies to complete,
but each task prompt is otherwise independent. The downstream worker cannot see
the prerequisite's verified summary, validation status, or diff summary. This
makes the DAG ordering real but the information flow implicit and incomplete.

## Design

### Agent Core owns the handoff contract

Add a provider-neutral `CollaborationTaskHandoff` projection derived from a
completed `CollaborationTaskResult`. It contains only:

- dependency task id, title, and role;
- attempt count and completed status;
- bounded assistant summary;
- bounded diff summary and addition/deletion counts;
- bounded validation summary when available.

It must not contain workspace paths, raw provider errors, credentials, tool
inputs, or private memory entries.

### Prompt boundary

When a task starts, `buildTaskPrompt` appends a bounded
`DEPENDENCY HANDOFFS` section only for its direct dependencies. The section is
explicitly labeled as untrusted worker-produced evidence, not instructions,
policy, or authorization. The original request and task instructions remain
separate trusted caller context.

A dependency handoff is generated only after the dependency is `completed`, so
failed, cancelled, or blocked tasks never leak partial output to a downstream
worker. Independent tasks receive no handoff section.

### Boundedness and compatibility

- Keep existing task and prompt size limits.
- Cap each handoff summary and the aggregate dependency section.
- Preserve existing `CollaborationTaskResult`, event, workspace, merge, and
  retry contracts.
- Retry a task with the same completed dependency handoffs; a failed attempt's
  partial memory is never handed to a later attempt.
- Do not make handoffs a capability or tool-grant mechanism.

## Verification

- Unit tests prove direct dependency handoff content and bounded projection.
- Unit tests prove independent tasks do not receive another task's output.
- Unit tests prove failed/blocked dependencies do not launch downstream work.
- Existing Agent Core and CLI suites remain green.
