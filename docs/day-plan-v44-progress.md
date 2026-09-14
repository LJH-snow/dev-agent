# v44 开发进度：preview 输入契约与 bounded-work 安全评审

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v44.md` 为准。本文件追踪 v44 的 preview
> hardening review；除非有可重复 proof gap，不扩大 runtime 行为。

## 当前状态

v43 已交付独立 `EvidenceAuditPreview`。v44 已完成 baseline/threat-model、input
decision matrix、CLI operation isolation hardening 和全量发布验证；Desktop query
收紧与 bounded-work cap 暂保持 conditional，v45 将继续用 benchmark 评估。

## v43 baseline

- [x] core canonical serializer 与 v1 byte budget 共用 UTF-8 JSON bytes。
- [x] CLI `--preview-evidence` 与 Desktop preview endpoint 只读 session memory。
- [x] preview 固定 metadata allowlist；v1 export、pagination、schema v2、
  before-image、cross-process Undo 边界保持不变。

## 进行中

### Task 0：v43 基线与威胁模型

- [x] 固化 contract 与信任边界，见 `docs/evidence-preview-hardening-review-v44.md`。
- [x] 建立输入 decision matrix，见 `docs/evidence-preview-input-matrix-v44.md`。

### Task 1：安全评审与可重复证据

- [x] 检查 core/CLI/Desktop parity，并记录 CLI precedence proof gap。
- [x] 仅为已决定的边界写 RED tests；旧实现先在 CLI competing-operation test 失败。补充
  CLI/Desktop malformed-memory generic-error regression。
- [x] 决策已形成：CLI operation isolation 为 GO；Desktop query tightening 与 bounded-work cap 为 CONDITIONAL。

### Task 2：最小兼容性加固（条件执行）

- [x] 在明确 proof gap 上实现 CLI preview-exclusive validation，拒绝 provider/MCP/
  workspace/session operation 组合。
- [x] Desktop query tightening 与 bounded-work cap 保持 design-only，并记录理由。
- [x] 聚焦回归：CLI 118/118、Desktop 74/74；v1 export 与 core 118/118 保持通过。

### Task 3：验证与发布

- [x] 全量门禁和边界 review：TypeScript workspace 612/612，release-gate contract
  9/9，Rust unit/doc 46/46，real-Rust integration 10/10；report/structure/diff
  check 通过。
- [x] CHANGELOG、发布提交和 v45 计划。

## v44 结论

- [x] CLI preview 在 provider/MCP/workspace/session operation 之前做显式 exclusive
  validation；competing-operation regression 通过。
- [x] 损坏 memory 的 CLI/Desktop preview 错误保持 generic metadata-only。
- [x] Desktop unknown/duplicate/empty query 与 oversized projection 不做未经证明的
  tightening；均记录为 CONDITIONAL/design-only。

## 设计原则

- preview 不是完整 evidence、执行输入、validation 输入、restore 凭证或 Undo 授权。
- 不静默截断；任何保护必须显式、可测试、metadata-only。
- v42 pagination/schema v2 为 CONDITIONAL；before-image/cross-process Undo 为 NO-GO。
