# v45 开发进度：preview bounded-work benchmark 与明确拒绝契约

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v45.md` 为准。v45 已量化 preview 工作量并完成
> rejection decision；没有证据，不改变 runtime。

## 当前状态

v44 已修复 CLI preview operation precedence proof gap。v45 已完成 benchmark/regression
TDD、六个 synthetic fixtures、full-export parity、sensitive-field regression 和全量
发布验证；没有新增 preview hard cap runtime 改动，下一步进入 v46 parity/query 计划。

## v44 baseline

- [x] preview fixed metadata allowlist 与 core canonical UTF-8 serializer。
- [x] CLI competing operations 在入口显式拒绝；CLI 118/118。
- [x] CLI/Desktop malformed-memory preview error generic；Desktop 74/74。
- [x] v1 export、pagination、schema v2、before-image、cross-process Undo boundaries
  未改变。

## 已完成

### Task 0：冻结基线与 benchmark contract

- [x] 固化 baseline 与 fixture matrix，见 `docs/evidence-preview-benchmark-v45.md`。
- [x] 定义不接触 workspace/provider 的 measurements，并区分 heap delta 与 peak。

### Task 1：执行 benchmark 与安全分析

- [x] benchmark/regression tests 先 RED，随后 GREEN；覆盖 allowlist、完整 bytes、稳定
  排序、输入不变、malformed selection 和 no-sensitive-output。
- [x] 六个受控 fixtures 连续运行两次；preview/full-export bytes 全部一致。
- [x] 最大 fixture（100,000 files）为 27,489,424 bytes、74--76 ms、约 61.2 MiB
  heap delta；未复现 concrete availability gap。
- [x] decision：**NO-GO** 新增 preview hard cap；v41 full-export caps 保持现有边界。

### Task 2：bounded-work rejection（条件执行）

- [x] 未触发；没有实现 speculative hard cap、partial、truncation 或 cursor。
- [x] v1 export、CLI/Desktop preview success/error schema 不变。

### Task 3：验证与发布

- [x] `pnpm verify`：TypeScript workspace 612/612、release-gate contract 9/9、Rust
  unit/doc 46/46、real-Rust integration 10/10。
- [x] 独立 TypeScript/Rust gate、metadata-only report smoke、structure check 和
  `git diff --check` 通过；report 顶层 allowlist 为
  `schemaVersion/generatedAt/modes/status/steps`，TypeScript mode 5 steps 全部通过。
- [x] CHANGELOG、README、benchmark/review docs 已更新；v46 计划与进度文档已建立。
- [ ] v45 commit/push（最终 diff review 后执行）。

## Benchmark evidence

- 结果与完整数据表见 `docs/evidence-preview-benchmark-v45.md`。
- 可复现命令：`pnpm test:benchmark`、`pnpm benchmark:evidence`。
- benchmark artifact 仅写入被忽略的 `.dev-agent/evidence-preview-benchmark.json`，不进入
  runtime response 或 session memory。

## 设计原则

- `serializedBytes` 必须是完整 canonical projection 的 UTF-8 bytes。
- 不静默截断，不生成 cursor/partial，不授予任何执行或恢复权限。
- v45 NO-GO 只针对新增 preview hard cap，不改变 v41 explicit export caps。
- v42 pagination/schema v2 为 CONDITIONAL；before-image/cross-process Undo 为 NO-GO。
