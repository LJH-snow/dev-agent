# Findings — Agent Definition Registry

- Existing `SkillRegistry` and `ExtensionRegistry` provide the correct bounded
  discovery pattern: project-over-user precedence, deterministic ordering, and
  optional malformed files ignored.
- Existing `resolveSpecialistRoles` already intersects role tools with the
  caller-owned `collaboration.toolAllowlist`; discovered Markdown definitions
  must enter before that function and cannot bypass it.
- Existing `CollaborationRole` accepts trusted instructions, model, tools, and
  budget bindings. The new registry should convert only to config-shaped role
  data at the CLI edge and must not change Agent Core authorization semantics.
- Current CLI command handling has separate rich/plain paths for Skills and
  Extensions; the new read-only Agent command should follow those paths.

- `pnpm` sets `INIT_CWD`, which the CLI intentionally prefers to process cwd. Integration fixtures must set `--cwd` explicitly for temporary projects; otherwise direct `node --test` can pass while `pnpm test` uses the monorepo as the project.
- Omitted tool allowlist and an explicitly empty allowlist have different security semantics. Omission inherits only the caller ceiling; `[]` denies all specialist tools.
- Concurrent CLI model-routing work has temporarily introduced separate TypeScript errors. Do not alter those unrelated files or represent a focused test as a passing full suite.
- Source/compiled-asset races matter in a shared workspace: full CLI suites compiled before a concurrent Ink change gave false regressions. The final release-gate CLI run passed 688/688 after code and tests stabilized.
- The repository-wide TypeScript gate remains red at Desktop's in-progress PR review prompt test (317/318), which is separate from the Agent Definition Registry. Its failure should be resolved by its owning work before claiming the complete release gate.

- Previously, syntactically valid but unsupported `provider` values or unregistered `toolAllowlist` entries in an optional Markdown definition could fail the entire `:team plan` flow. Capability-filtered discovery now skips only that optional definition and lets a valid user-level definition of the same id remain available.
- Project Agent metadata is shared, model-facing input rather than trusted
  provider authorization. A project-level provider override can therefore
  cross the local/cloud boundary without user intent unless it is constrained
  at role resolution; the active session provider is the correct comparison
  point, while explicit JSON roles remain the caller-owned escape hatch.
