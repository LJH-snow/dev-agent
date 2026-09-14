# v45 preview bounded-work benchmark contract

**日期：2026-09-14**

**状态：v45 benchmark、回归与决策完成；Task 2 未触发，未新增 runtime hard cap。**

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


## Execution result (2026-09-14)

通过 `pnpm benchmark:evidence` 连续运行两次。脚本先构建 agent-core，再以
`--expose-gc` 执行六个 synthetic fixtures；结果只写入被 `.gitignore` 忽略的
`.dev-agent/evidence-preview-benchmark.json`，不会进入 CLI/Desktop preview response。

下表使用两次独立运行的结果；`heapDelta` 是带 GC 前置的近似值，不是 peak memory，
`durationMs` 为四舍五入后的整数毫秒。bytes、counts 在两次运行中完全一致。

| Fixture | Validations | Change sets | Files | Serialized bytes | Duration run 1 / 2 | Heap delta run 1 / 2 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `empty` | 0 | 0 | 0 | 354 | 0 / 0 ms | 162,392 / 162,392 |
| `small` | 2 | 2 | 2 | 1,674 | 7 / 7 ms | 30,944 / 30,944 |
| `retention-sized` | 100 | 100 | 100 | 66,571 | 0 / 0 ms | 225,760 / 225,760 |
| `record-cap-sized` | 10,000 | 10,000 | 10,000 | 6,621,261 | 23 / 25 ms | 14,175,960 / 14,115,440 |
| `files-heavy` | 0 | 1 | 100,000 | 27,489,424 | 74 / 76 ms | 64,207,896 / 64,204,944 |
| `utf8-heavy` | 16 | 8 | 32 | 14,042 | 0 / 0 ms | 70,728 / 70,728 |

### Parity and boundary checks

- 六个 fixtures 的 `createEvidenceAuditPreview().serializedBytes` 均与同一输入通过
  `createEvidenceAuditExport()` 加 `serializeEvidenceAuditExport()` 得出的 UTF-8 bytes
  完全一致；输入 validations/change sets 反向排列后 preview 结果不变。
- benchmark regression tests 验证了固定 artifact/result allowlist、输入不变、稳定排序、
  malformed fixture selection 拒绝，以及 synthetic command/cwd/output/error/diff 等字段
  不进入 artifact。
- `record-cap-sized` 的完整 projection 为 6,621,261 bytes，低于 v41 的 10 MiB
  `maxBytes` cap。`files-heavy` 为 27,489,424 bytes；使用 v41 `maxBytes: 10,485,760`
  时由已有 `EVIDENCE_AUDIT_LIMIT_EXCEEDED` 明确拒绝，`kind=bytes`，`actual=27,489,424`，
  不返回 partial/truncated projection。
- 在本地两次受控运行中，最大测试 fixture（100,000 files）耗时 74--76 ms，近似
  heap delta 约 61.2 MiB；没有复现 availability failure、超时或序列化不一致。这个结论
  仅覆盖当前 synthetic matrix，不把一次本地测量当作通用 SLA 或 peak-memory 证明。

## v45 decision

**NO-GO：本轮不新增 preview hard cap、流式截断、cursor、partial response 或 schema v2。**

理由是当前已测到 agent-core record cap 和 100,000-file pressure，完整 canonical projection
仍在可重复、低延迟范围内；需要大小保护的 full export 已有显式 v41 rejection-only caps，
并且 preview 的职责正是先返回完整 `serializedBytes` 供调用方选择 export limit。添加第二套
preview-only hard ceiling 会重复限制、改变错误兼容面，并不能由本轮证据证明必要。

未来若真实 telemetry 或新的 fixture 复现多百万 files、异常长 metadata、持续高 heap pressure
或服务可用性问题，再单独启动 benchmark；在新证据出现前，oversized preview 保持完整
projection 语义，v41 export caps 保持现有边界。
