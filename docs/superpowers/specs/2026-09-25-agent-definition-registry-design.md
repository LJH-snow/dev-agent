# Agent Definition Registry Design

**Date:** 2026-09-25
**Status:** approved for implementation in the active continuation

## Goal

Make Specialist Agents discoverable as bounded, project-local or user-local Markdown definitions while preserving the existing `:team` approval, tool-scope, plan-mode, and sandbox boundaries.

## Design

`@dev-agent/agent-core` gains an `AgentDefinitionRegistry` that reads only
`.dev-agent/agents/<id>/AGENT.md` in the selected project and
`~/.dev-agent/agents/<id>/AGENT.md` for the user. Project definitions shadow
user definitions by normalized id. Discovery is deterministic, bounded, and
best-effort: malformed, oversized, or unsupported definitions are ignored and
never prevent startup.

Each definition has a small front matter contract: `name`, `description`,
`provider`, `model`, `toolAllowlist`, and bounded budget fields. The Markdown
body is instruction text and is truncated at the registry boundary. The
registry does not execute code, start MCP servers, or interpret arbitrary YAML.

The CLI merges discovered definitions with the existing JSON
`collaboration.roles` configuration. Explicit JSON roles win on duplicate IDs;
otherwise discovered definitions augment the built-in role set. The resulting
roles still pass through the current user tool ceiling and active registry
checks. Planner/model output remains presentation-only and cannot grant tools
or choose untrusted model bindings.

A read-only `:agents` / `:agent <id>` command exposes the safe metadata needed
for inspection. It does not activate an agent or mutate configuration; the
existing `:team` workflow remains the only execution path.

## Non-goals

- No executable agent plugins, hooks, scripts, or MCP startup from Markdown.
- No remote marketplace, installation, or network fetch.
- No change to approval policy, Rust sandbox enforcement, task worktree
  creation, task-scope review, or merge behavior.
- No new dependency for YAML/front-matter parsing.

## Verification

Unit tests cover precedence, malformed front matter, bounds, budget parsing,
command rendering, and role merging. CLI focused tests cover discovered roles
being narrowed by the caller-owned tool ceiling. The normal CLI build,
typecheck, focused tests, and full TypeScript verification gate remain the
acceptance evidence.
