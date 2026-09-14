# v45 preview bounded-work benchmark contract

**日期：2026-09-14**

**状态：Task 0 完成，Task 1 进入 benchmark/regression TDD。**

## Purpose

本 benchmark 只量化 agent-core metadata-only preview 的完整 projection 和 canonical
UTF-8 serialization 工作量。它不是 production API，不接触真实 workspace、provider、
MCP、chat queue 或 session files，也不把 timing/heap 结果放进 preview response。

## Fixed output allowlist

Artifact 只允许：

- `schemaVersion`：benchmark artifact schema version；
- `generatedAt`：本次 benchmark 的固定或生成时间；
- `results`：每个 fixture 的 metadata-only result。

每个 result 只允许：

- fixture id；
- validation/change-set/file counts；
- complete preview 的 canonical `serializedBytes`；
- wall-clock `durationMs`；
- `heapUsedBefore`、`heapUsedAfter`、`heapDelta`（仅在 Node runtime 可测时作为近似，
  不宣称 peak memory）。

不得输出 command、args、cwd、path、output/error、diff、patch、file bytes、before-image、
provider values、environment values、cursor、partial 或 recovery metadata。

## Fixture matrix

| Fixture | Purpose | Shape |
| --- | --- | --- |
| `empty` | empty legacy snapshot baseline | 0 validations, 0 change sets, 0 files |
| `small` | ordinary request | 2 validations, 2 change sets, 2 files |
| `retention-sized` | default retention scale | 100 validations, 100 change sets, 100 files |
| `record-cap-sized` | agent-core record cap scale | 10,000 validations, 10,000 change sets, 10,000 files |
| `files-heavy` | file-count pressure | 1 change set, 100,000 files |
| `utf8-heavy` | multi-byte byte accounting | non-ASCII ids/paths/metadata, repeated records |

Fixtures use synthetic metadata only. They must be created in memory and use a fixed
`generatedAt` during parity checks, so reordering inputs does not alter canonical bytes.

## Measurement rules

1. Build a fixture without reading or writing a workspace.
2. Optionally call `globalThis.gc()` only when the benchmark is started with `--expose-gc`;
   never require GC for correctness.
3. Record `performance.now()` around `createEvidenceAuditPreview()` only.
4. Record `process.memoryUsage().heapUsed` before and after; report delta as an approximation,
   never as peak.
5. Check result counts and `serializedBytes` are safe non-negative integers.
6. Repeat the same fixture in a separate invocation when comparing changes; do not compare a
   single noisy timing as a regression verdict.
7. Keep the benchmark output ignored under `.dev-agent/`; remove it after ad-hoc smoke if a
   clean working tree is required.

## Decision thresholds

v45 does not assume a hard cap. A bounded-work rejection becomes eligible only if repeated
runs show a concrete availability/safety problem that is not already covered by v41's
rejection-only export caps. Any future guard must reject explicitly, preserve full projection
semantics, and never return a partial or truncated preview.

- If current retention and v41 caps are adequate: **NO-GO** for a new preview hard cap.
- If a concrete risk is reproducible but needs more compatibility evidence: **CONDITIONAL**.
- If a metadata-only explicit rejection is proven safe and needed: **GO** for a separate TDD
  implementation step.
