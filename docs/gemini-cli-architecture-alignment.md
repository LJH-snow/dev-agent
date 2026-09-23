# Gemini CLI Architecture Alignment

**Comparison snapshot:** 2026-09-23
**Purpose:** use Gemini CLI as a design reference for dev-agent, not as a
requirement to copy its implementation or package choices.

## Executive summary

The projects already share a closely related foundation: Node.js, TypeScript,
React/Ink for the interactive terminal, a CLI-facing package, and a separate
agent/core layer. Replacing pnpm, Node's built-in test runner, or the current
package boundaries solely to imitate Gemini CLI would add migration cost
without a demonstrated product benefit.

The more valuable comparison is architectural. Gemini CLI emphasizes
fine-grained tool policies and isolated subagent capabilities. dev-agent
already has a shared approval-policy factory, bounded collaborative task DAGs,
separate per-task memory, isolated worktrees, and a review-before-merge boundary.
The CLI team path passes its selected Rust sandbox-profile resolver and
bounded sandbox-expansion callback into worker AgentLoops. Agent Core also
supports caller-owned per-task tool scopes that narrow both advertised schemas
and runtime lookup. Before every `:team` execution, the CLI asks the user to select tool scopes
and confirm the complete normalized graph. The review binds them to ordered
task slots and a SHA-256 fingerprint of the graph, and Agent Core revalidates
the fingerprint, complete scope coverage, available tool names, and configured
global ceiling before creating any workspace. The legacy
`collaboration.reviewTaskToolScopes` boolean is accepted but ignored, so it
cannot disable authorization review. Planner-generated IDs are presentation
only, never authorization keys. Focused tests cover this boundary alongside
worktree-rooted sandbox retries.

## Technology snapshot

| Area | Gemini CLI source snapshot | dev-agent current workspace |
|---|---|---|
| Runtime/language | Node.js 20+, ESM, TypeScript | Node.js 20+, ESM, TypeScript |
| Workspace | npm workspaces | pnpm 12.3.4 workspace |
| Interactive CLI | React 19 and Ink 6 | React 19 and Ink 6 |
| Build/package | esbuild-based bundle and npm package scripts | TypeScript builds plus esbuild CLI package bundle |
| Tests | Vitest | Node.js built-in test runner; PTY behavior evaluations are separate |
| Core boundary | `packages/cli` calls `packages/core` | `apps/cli` and `apps/desktop` reuse `packages/agent-core` |

The Gemini values describe the upstream `main` manifest/documentation snapshot
accessed on the comparison date. Its manifest reported TypeScript 5.8.3 and
Vitest 3.2.4; these are snapshot values, not a claim about a stable release.

## Design ideas and fit

### 1. Keep UI and runtime responsibilities separate

Gemini CLI documents its core package as the backend that handles API
communication, tools, and requests from the CLI. dev-agent already follows the
same direction: Ink is a presentation/input layer, while `AgentLoop` owns model
and tool orchestration; Desktop projects the shared runtime events into SSE and
browser UI; ACP and A2A are transport adapters around that runtime.

**Fit:** strong. Continue keeping policy, session state, tool execution, and
cancellation out of renderers and protocol adapters.

### 2. Make tool policy explicit and composable

Gemini's Policy Engine uses rules with tool/argument/environment conditions,
`allow`/`deny`/`ask_user` decisions, priorities, and policy tiers. Its current
documentation explicitly warns that the workspace-policy tier is non-functional,
which is a useful reminder to distinguish documented design from operational
behavior.

dev-agent now centralizes approval mode behavior in Agent Core's
`createApprovalPolicy()` and reuses it across CLI, Desktop, and MCP. Its current
configuration is intentionally smaller (`allow`, `deny` patterns, and the
`allow`/`deny-dangerous`/`ask`/`review-writes` modes); the shared factory means
policy unification is no longer an architectural gap. A priority-rule language
should be added only if concrete user/admin policy requirements justify its
configuration and migration cost.

**Fit:** preserve the existing common decision path. If richer rules are later
needed, define precedence and non-interactive fail-closed behavior before
adding syntax; do not copy an upstream tier that is documented as disabled.

The registry also owns a conservative risk boundary: tools without explicit
metadata default to dangerous/always-confirm, and approval requests receive
only the normalized `risk` and `confirmation` fields. Plan mode permits
action-aware built-in inspection and explicitly classified read-only tools;
unclassified tools are blocked. MCP action wrappers remain dangerous regardless
of server-supplied annotations, while the host's resource and prompt wrappers
are classified as read-only from their local behavior. This is intentionally
stricter than trusting remote capability declarations.

### 3. Give collaborative workers bounded, deliberate capabilities

Gemini's subagent reference describes independent conversation histories,
restricted or specialized tool sets, isolated per-agent MCP configuration,
and agent-specific policy. dev-agent's collaborative execution already creates
separate task contexts/memory, validates a bounded DAG, runs tasks in isolated
worktrees, supports per-task cancellation/retry, and requires review before
merge.

The sandbox-parity gap from the initial audit is closed: the CLI passes its
selected profile resolver and bounded expansion callback to
`createCollaborativeExecution()`, which supplies both to every worker loop. A
focused test verifies a worktree-rooted restricted profile, an expansion
request, and one retry with the approved profile.

Agent Core now exposes the caller-owned `toolAllowlistForTask` execution option.
It resolves scopes before workspace creation, rejects invalid or unavailable
names, intersects scopes with the caller's `ToolCollection`, and uses that same
restricted collection for schemas and runtime lookups. `CollaborationTask` and
the planner parser do not contain tool-scope fields, so a model-generated plan
cannot self-grant capabilities. Regression coverage also forges a call to a
hidden tool and confirms it never executes.

The CLI exposes `collaboration.toolAllowlist` as an optional global ceiling
shared identically by every `:team` worker. Every team execution requires the
user to select `all`, `none`, or exact tool names per task, then confirm the
complete normalized plan and dependency graph. The immutable scope map is
indexed by ordered task slots and tied to the normalized-plan SHA-256
fingerprint. Agent Core recomputes and validates the fingerprint, complete slot
coverage, registered tool names, and global ceiling before workspace creation.
Both global and per-task scopes only narrow tool visibility; approval and
sandbox policy remain independent. Planner IDs, roles, titles, and instructions
never determine allowed tool names.

**MCP lifecycle boundary:** these reviewed scopes restrict which MCP tool
wrappers a worker can see and invoke, but they do not isolate MCP server
processes. The CLI starts configured MCP sessions once at the project root;
workers reuse those wrappers, and MCP calls do not receive a worker worktree
path. A cwd-sensitive server may therefore act on the main project, while a
remote MCP server may intentionally address shared external state. MCP process
cwd, advertised roots, and per-task tool allowlists are not server-side
filesystem or remote-resource enforcement. This is a concrete difference from
Gemini's documented per-subagent MCP configuration, but duplicating arbitrary
MCP processes is not automatically equivalent to isolating their resources.
Treat worker-scoped MCP startup as a separate design decision requiring explicit
server-selection semantics, resource/concurrency limits, and lifecycle tests.

**Fit:** the mandatory task-capability review is implemented without copying
upstream implementation details. Preserve the explicit user review,
caller-owned plan binding, global ceiling, and separate approval/sandbox
boundaries. Do not describe tool visibility as MCP process or resource
isolation.

### 4. Keep extension trust boundaries intentional

dev-agent Skills are bounded Markdown instructions that require explicit
activation. The extension registry is metadata-only: it does not execute
extension code or start declared MCP servers. That is a deliberate security
boundary, not a missing plugin loader. Gemini's layered Skills/extensions are
useful discovery and lifecycle references, but executable extensions should
remain deferred until dev-agent has an explicit trust, install, permission, and
rollback model.

## Recommended sequence

1. **Complete the collaboration sandbox parity work.** The active CLI and
   Agent Core sources now pass the application-owned profile resolver and
   expansion callback to every worker AgentLoop. The focused task-worktree test
   covers the restricted profile and bounded retry after approval.
2. **[Implemented] Mandatory task capability review.** The trusted, validated
   `toolAllowlistForTask` API only narrows caller-supplied tools. Before every
   team execution, the CLI binds explicit selections to ordered task slots and
   the exact normalized plan fingerprint, shows the complete graph and scopes
   for confirmation, and relies on Agent Core to revalidate all bindings and
   the optional global ceiling before workspace creation. The legacy
   `collaboration.reviewTaskToolScopes` flag is ignored. Keep approval and
   sandbox policy separate from tool visibility; the review does not isolate
   shared MCP processes.
3. **Evaluate policy-rule evolution only against concrete requirements.** Keep
   `createApprovalPolicy()` as the shared decision boundary; do not introduce
   priority tiers, workspace policy, or administrator semantics speculatively.
4. **Defer executable extension loading.** Continue metadata-only discovery
   until a separate trust/permissions design is approved.

## Sources

Upstream references are live documents and may change; this page records the
comparison date and the specific design points used:

- [Gemini CLI technology and contribution overview](https://github.com/google-gemini/gemini-cli/blob/main/GEMINI.md)
- [Gemini CLI package manifest](https://github.com/google-gemini/gemini-cli/blob/main/package.json)
- [Gemini CLI npm workspaces and package layout](https://github.com/google-gemini/gemini-cli/blob/main/docs/npm.md)
- [Gemini CLI core package](https://geminicli.com/docs/core/)
- [Gemini CLI Policy Engine](https://geminicli.com/docs/reference/policy-engine/)
- [Gemini CLI subagents](https://geminicli.com/docs/core/subagents/)
- [Gemini CLI Agent Skills](https://geminicli.com/docs/cli/using-agent-skills/)

Local behavior was checked against `packages/agent-core/src/approval.ts`,
`packages/agent-core/src/collaboration-execution.ts`,
`packages/agent-core/src/skills.ts`, `packages/agent-core/src/extensions.ts`,
`packages/agent-core/src/loop.ts`, `apps/cli/src/index.ts`, and
`packages/tools/src/executor-run.ts` on the comparison date.
