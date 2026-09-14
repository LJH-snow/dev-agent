# v44 开发进度：preview 输入契约与 bounded-work 安全评审

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v44.md` 为准。本文件追踪 v44 的 preview
> hardening review；除非有可重复 proof gap，不扩大 runtime 行为。

## 当前状态

v43 已交付独立 `EvidenceAuditPreview`。v44 已完成 baseline/threat-model 和
input decision matrix，确认 CLI operation precedence 是需要 TDD 加固的 proof gap；
Desktop query 收紧与 bounded-work cap 暂保持 conditional。

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

- [ ] 检查 core/CLI/Desktop parity。
- [ ] 仅为已决定的边界写 RED tests。
- [x] 初步决策已形成：CLI operation isolation 为 GO；Desktop query tightening 与 bounded-work cap 为 CONDITIONAL。

### Task 2：最小兼容性加固（条件执行）

- [ ] 仅在 proof gap 明确时实现。
- [ ] 否则保持 design-only 并记录理由。

### Task 3：验证与发布

- [ ] 全量门禁和边界 review。
- [ ] CHANGELOG、发布提交和 v45 计划。

## 设计原则

- preview 不是完整 evidence、执行输入、validation 输入、restore 凭证或 Undo 授权。
- 不静默截断；任何保护必须显式、可测试、metadata-only。
- v42 pagination/schema v2 为 CONDITIONAL；before-image/cross-process Undo 为 NO-GO。
