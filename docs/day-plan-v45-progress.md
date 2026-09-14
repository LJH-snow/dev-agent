# v45 开发进度：preview bounded-work benchmark 与明确拒绝契约

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v45.md` 为准。v45 先量化 preview 工作量，再决定
> 是否需要显式 bounded-work rejection；没有证据不改变 runtime。

## 当前状态

v44 已修复 CLI preview operation precedence proof gap，并保持 Desktop query tightening
与 oversized projection 为 CONDITIONAL。v45 当前进入 baseline/benchmark contract。

## v44 baseline

- [x] preview fixed metadata allowlist 与 core canonical UTF-8 serializer。
- [x] CLI competing operations 在入口显式拒绝；CLI 118/118。
- [x] CLI/Desktop malformed-memory preview error generic；Desktop 74/74。
- [x] v1 export、pagination、schema v2、before-image、cross-process Undo boundaries
  未改变。

## 进行中

### Task 0：冻结基线与 benchmark contract

- [ ] 固化 baseline 与 fixture matrix。
- [ ] 定义不接触 workspace/provider 的 measurements。

### Task 1：执行 benchmark 与安全分析

- [ ] benchmark/regression tests。
- [ ] 受控 fixture matrix 与 decision。

### Task 2：bounded-work rejection（条件执行）

- [ ] 仅在数据证明 concrete gap 时 TDD 实现。
- [ ] 否则记录 NO-GO，不添加 hard cap。

### Task 3：验证与发布

- [ ] 全量门禁、文档和 v46 计划。

## 设计原则

- `serializedBytes` 必须是完整 canonical projection 的 UTF-8 bytes。
- 不静默截断，不生成 cursor/partial，不授予任何执行或恢复权限。
- v42 pagination/schema v2 为 CONDITIONAL；before-image/cross-process Undo 为 NO-GO。
