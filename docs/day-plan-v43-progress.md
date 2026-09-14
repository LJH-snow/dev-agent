# v43 开发进度：audit export canonical preflight 与只读 preview

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v43.md` 为准。本文件记录 v43 的 runtime 实现进度；preview 不改变 v1，不授权 pagination、schema v2、before-image 或跨进程 Undo。

## 当前状态

v42 的 pagination/schema v2 评审结论为 **CONDITIONAL**，before-image 七项闸门为
**NO-GO**。v43 当前进入 agent-core preview contract 的 TDD 阶段；目标是让操作者先
看到完整 projection 的 metadata 规模，再选择 v41 的 rejection-only limits。

## v42 基线

- [x] v1 export 仍为完整 snapshot 或明确限额错误。
- [x] cursor、partial、schema v2、before-image 和跨进程 Undo 没有 runtime 实现。
- [x] v42 文档/结构门禁通过，结论记录在 `docs/evidence-review-conclusion-v42.md`。

## 进行中

### Task 1：Agent-core canonical serializer 与 preview

- [ ] RED 测试：preview allowlist、UTF-8 bytes、计数、排序和不变性。
- [ ] 实现 canonical serializer 和独立 preview schema。
- [ ] agent-core 聚焦回归。

### Task 2：CLI/Desktop preview surface

- [ ] CLI `--preview-evidence`。
- [ ] Desktop `GET /api/sessions/<id>/evidence/preview`。
- [ ] 宿主聚焦回归和使用文档。

### Task 3：全量验证与发布

- [ ] 完整 TypeScript/Rust/integration gate。
- [ ] report smoke、结构/diff check、敏感字段和 side-effect review。
- [ ] CHANGELOG、发布提交和 v44 后续计划。

## 设计原则

- preview schema 与 v1 export schema 分离；成功 v1 字段保持不变。
- `serializedBytes` 来自完整 canonical UTF-8 JSON；preview 不静默截断，也不携带 partial/cursor。
- preview 只读 memory projection，不加载 provider、不进入 chat queue、不读写 workspace。
- 任何将 preview/cursor/evidence 传入执行、restore、validation 或 rollback 的路径都必须拒绝。
