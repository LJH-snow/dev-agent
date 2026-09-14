# v46 开发进度：preview 跨宿主 parity 与 Desktop query 语义收敛

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v46.md` 为准。v46 承接 v45 的 NO-GO 结论，优先补
> cross-surface regression evidence，不因理论风险扩展 preview runtime。

## 当前状态

v45 benchmark、parity、sensitive-field regression 与 full verification 已完成；v46
已完成 Task 0/Task 1 与 query compatibility review。当前 decision 为 **Preserve /
tests-only**，准备进行 v46 最终门禁与发布。

## v45 baseline

- [x] 六个 synthetic fixtures 连续运行两次；preview bytes 与 full v1 canonical serializer
  完全一致。
- [x] 最大 100,000-file fixture 为 27,489,424 bytes、74--76 ms、约 61.2 MiB heap delta；
  没有复现 concrete availability gap。
- [x] 新增 preview hard cap 为 **NO-GO**；v41 explicit export caps 保持现有边界。

## 已完成

### Task 0：冻结 v45 基线与 parity fixture

- [x] 固化 v45 benchmark 数据、preview routes 和当前 query semantics。
- [x] 使用临时 shared session fixture 覆盖 standard filters、UTF-8 ids/paths 和错误边界。
- [x] 写 success/error/unknown/duplicate/empty/unknown-query decision matrix，见
  `docs/evidence-preview-parity-v46.md`。

### Task 1：跨宿主 preview parity regression

- [x] core/CLI/Desktop 对同一 fixture 的 counts、file count、bytes parity：4 组请求全通过。
- [x] generic error、sensitive-field 和 no-side-effect regression：3/3 tests 通过。
- [x] 测试 harness 只复用 core/FileMemory，不在宿主层复制 serializer 或计算 bytes。

### Task 2：Desktop query semantics decision

- [x] 与 `/messages` history endpoint 对比兼容性；empty/duplicate/unknown/encoded 语义一致。
- [x] decision：**Preserve / tests-only**；没有真实 proof gap，不修改 parser。

### Task 3：验证与发布

- [x] `pnpm test:preview-parity`：3/3 passed。
- [x] `pnpm verify`：TypeScript workspace 612/612、release-gate 9/9、Rust unit/doc 46/46、
  real-Rust integration 10/10；独立 TypeScript/Rust gate、report smoke、structure 和
  `git diff --check` 通过。
- [x] README、CHANGELOG、progress 和 parity decision doc 已更新；v47 计划已建立。
- [ ] v46 commit/push（最终 diff review 后执行）。

## Evidence

- 跨宿主测试：`pnpm test:preview-parity`，当前 **3/3 passed**。
- 详细 allowlist、query matrix 和 side-effect checks：`docs/evidence-preview-parity-v46.md`。

## 设计原则

- preview 是完整 canonical projection 的 metadata-only sizing surface，不是 evidence export
  的 partial/cursor 版本。
- 不改变 v1 export、v41 rejection-only limits、provider/workspace/chat queue 或 recovery
  boundaries。
- 所有 runtime 改动先 RED 后 GREEN；测试能证明 preserve 时，不为“更严格”而更改兼容语义。
