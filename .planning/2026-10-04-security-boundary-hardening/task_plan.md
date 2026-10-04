# Security boundary hardening

Date: 2026-10-04

## Scope

Triage the sealed Mimosa deep scan `scan-2026-10-04T08-40-18.059Z-c1111d24e45a` (22 occurrences, 198 packages scanned, 0 matched advisories, static-only evidence) without treating the scan as a runtime security proof.

## Boundaries

- Do not modify or reset unrelated Ink/editor/planning changes or the parallel Desktop autofix work.
- Keep metadata-only persistence and bounded input/output/frame behavior.
- Preserve explicit custom Rust runtime support as caller-trusted configuration; do not claim owner/hash/managed provenance for it.
- Keep terminal shell capability explicit, but do not allow an environment variable to select an arbitrary executable.
- Keep non-terminal executors parameterized and shell-free.

## Work slices

1. Desktop terminal shell executable resolver and HTTP capability authorization regressions.
2. MCP/AgentLoop approval-to-executor regression evidence.
3. Rust executable preflight and bounded health probe.
4. Finding dispositions, focused/full tests, and a new Mimosa scan.

## Verification gates

- Focused TypeScript builds/tests first.
- Related package tests and full CLI tests next.
- `git diff --check` and path-scoped status review.
- New Mimosa deep scan with scan ID, coverage, finding count, dependency summary, and seal.
- Only this slice's files may be staged if committing/pushing.
