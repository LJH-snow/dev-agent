# Day plan v37：证据生命周期与持续回归守护

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 v36 跨进程 evidence 安全边界之上，控制验证历史和已应用变更集证据的生命周期，并把 restore、postimage 冲突、session 隔离、取消和 no-auto-rollback 固定成持续回归矩阵。任何自动保留或清理动作都不能悄悄移除仍可用于 validation guard 的 applied change set。

**Architecture:** `AgentMemory` 增加显式的 evidence retention/cleanup contract；验证 attempt 可以按上限保留，只有已明确进入 `rolled-back` 或被显式释放的 change-set evidence 才有资格被自动清理。当前仍为 `applied` 的记录永远受保护，清理只处理 memory 元数据，不触碰工作区文件。Desktop Undo 成功后同步 durable state，CLI/Desktop 提供结构化的 evidence cleanup 入口；所有入口都不接受命令、shell、diff、文件内容或 before-image 作为输入。

**Tech Stack:** TypeScript, Node.js `fs/promises`, `AgentMemory`, `FileMemory`, `FilesystemTool`, CLI/Desktop session lifecycle, Node test runner。

**Spec:** 本文件；v36 的跨进程恢复边界见 `docs/day-plan-v36.md` 和 `docs/day-plan-v36-progress.md`。

## Global Constraints

- retention 是安全上限，不是强制删除：仍为 `applied` 的 change-set guard 不得被隐式丢弃。
- 自动清理只允许删除已明确 `rolled-back` 的 change-set evidence，以及不再需要的旧 validation attempts；删除前后不得执行、回滚、覆盖或修复用户文件。
- cleanup 必须幂等、可审计，返回删除数量和保留原因；未知 id、session 不匹配、活动中的 guard 和非法参数都必须显式拒绝或返回安全的 no-op。
- evidence 仍是非 executable 元数据；不保存、不接受、不重建 shell、executable、args、cwd、diff、patch、文件内容或 before-image。
- v36 的 restore guard、postimage conflict、session/workdir/path/type/existence 校验、no-auto-rollback、cancellation、MCP denial 和 Rust sandbox 边界保持不变。
- 旧 `version: 1` memory（没有 retention 字段）必须继续可读；默认值只能由当前代码提供，不能要求迁移旧文件。
- 新增行为遵循 TDD：先写预期失败测试并确认 RED，再写最小实现，先跑聚焦回归，再跑完整验证。

## 文件与边界

- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/memory.ts` — 定义 retention 配置、清理结果和安全的 evidence 状态更新接口；两种 memory 实现保持兼容。
- Boundary: 不新增顶层运行时入口；所有调用保持在现有 AgentLoop/CLI/Desktop 生命周期内。
- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/loop.ts` — 如需在 validation 记录后触发 retention，只做 best-effort 元数据清理，不改变 apply/validation 结果。
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/src/chat-session.ts` — Undo 成功后同步 durable `rolled-back` 状态，并提供显式 evidence cleanup 能力。
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/src/server.ts` — 增加结构化 cleanup API 和安全错误映射；不把 cleanup 变成文件操作。
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/index.ts` — 增加显式、可选的 evidence cleanup 命令或交互入口，并保持 `--json` 单对象输出。
- Test: `/Users/Admin/Desktop/dev-agent/packages/agent-core/tests/memory.test.ts`、`validation-lifecycle.test.ts` — retention 上限、状态更新、旧 memory 兼容、失败不影响主流程。
- Test: `/Users/Admin/Desktop/dev-agent/packages/tools/tests/filesystem-changeset.test.ts` — applied guard 保护、rolled-back 记录恢复拒绝、清理不触碰文件。
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/validation.test.ts`、`/Users/Admin/Desktop/dev-agent/apps/desktop/tests/chat-session.test.ts`、`multi-session.test.ts` — 新进程、Undo 后状态、cleanup session 隔离和 JSON/API 兼容。
- Modify: `/Users/Admin/Desktop/dev-agent/README.md`、`apps/cli/README.md`、`apps/desktop/README.md`、`packages/tools/README.md`、`docs/CHANGELOG.md`、`docs/day-plan-v37-progress.md` — 对外说明、限制和验证记录。

## Task 0：建立持续回归矩阵

**Produces:** 一组明确的 table-driven regression tests，覆盖 v36 最容易被后续 retention 改坏的安全不变量。

- [x] **Step 1: 写回归矩阵测试。**
  - restore 的 `applied` guard 在 retention/cleanup 前后仍可 validation；postimage 改变、session/workdir 不匹配仍 blocked。
  - cancellation、validation failure 和 no-auto-rollback 仍不改变用户文件。
  - 已 rolled-back 的 evidence 不会被重新恢复为 applied guard。
- [x] **Step 2: 评估 RED。** 本任务只增加对 v36 已有安全语义的回归覆盖，不引入临时破坏来制造 production RED。
- [x] **Step 3: 写最小测试整理或测试辅助。** 不修改运行时语义；优先用矩阵减少重复 fixture。
- [x] **Step 4: 运行聚焦测试确认 GREEN。**
- [x] **Step 5: 提交。**

## Task 1：Memory retention contract

**Produces:** 有界 validation history、受保护的 applied change-set evidence，以及幂等的元数据清理 API。

- [x] **Step 1: 写失败测试。**
  - `recordValidation()` 超过上限时只淘汰最旧的 validation attempt，不删除关联的 applied change-set evidence。
  - `pruneEvidence()` 只能淘汰 rolled-back/non-active records；所有 applied records 保留并返回 protected 数量。
  - InMemory/FileMemory 的结果和排序一致；旧 memory 文件没有 retention 字段时继续读取。
  - 并发 append/record/prune 通过同一串行写入链，不丢 entries、validations 或 changeSets。
- [x] **Step 2: 运行聚焦测试确认 RED。** 当前 memory 类型缺少 retention 配置和 `pruneEvidence()` 时，聚焦测试按预期在类型编译阶段失败。
- [x] **Step 3: 写最小实现。**
  - retention 默认值由代码定义，配置字段只接受正整数上限。
  - 清理只改 memory JSON，不读取或写入 working directory。
  - 清理失败 best-effort 时不能把成功的 apply/validation 变成失败。
- [x] **Step 4: 运行聚焦测试确认 GREEN。**
- [x] **Step 5: 提交。**

## Task 2：Undo 状态和显式 cleanup 生命周期

**Produces:** rollback 后的 durable state 与安全的显式 evidence 删除/压缩入口。

- [x] **Step 1: 写失败测试。**
  - Desktop Undo 成功后把对应记录标为 `rolled-back`；冲突、busy、失败或取消不改变 durable state。
  - cleanup 不接受其它 session 的 evidence；删除后工作区和其它 session 完全不变。
  - 清理后旧 validation attempts 不能重新激活一个 applied guard。
- [x] **Step 2: 运行聚焦测试确认 RED。** 首轮 Desktop 回归为 69/71，按预期暴露 durable state 未同步和 cleanup 路由 404。
- [x] **Step 3: 写最小实现。**
  - rollback 只有在受保护的 filesystem rollback 成功后才 best-effort 标记 `rolled-back`；同步失败不会伪造成功，也不会撤销已完成的安全回滚。
  - Desktop 增加 `POST /api/changesets/cleanup`，只调用 session memory 的 metadata-only cleanup，并返回删除数、保护数和剩余数。
  - 不引入跨进程 Undo；rolled-back 只代表文件已经由受保护 rollback 完成，不代表可以恢复 before-image。
- [x] **Step 4: 运行聚焦测试确认 GREEN。** Desktop 聚焦回归 **71/71** 通过。
- [x] **Step 5: 提交。** `a271df8`。

## Task 3：CLI/Desktop 可见性、API 和文档

**Produces:** 用户能知道 evidence 被保留、保护或清理，且旧调用方不需要迁移。

- [ ] **Step 1: 写失败测试。**
  - CLI `--json`、交互式命令和 Desktop history/export/API 返回 retention 摘要。
  - Desktop cleanup 的错误映射区分未知 session、非法参数、protected applied guard 和实际删除结果。
  - messages 仍不混入 evidence；历史输出不出现命令、diff、文件字节或 before-image。
- [ ] **Step 2: 运行聚焦测试确认 RED。**
- [ ] **Step 3: 写最小实现。** 保持现有字段和状态兼容，新增字段只使用结构化元数据。
- [ ] **Step 4: 运行聚焦测试确认 GREEN。**
- [ ] **Step 5: 提交。**

## Task 4：全量回归、文档和发布

**Produces:** v37 的 evidence lifecycle 可审计、可持续回归，并可安全交付。

- [ ] **Step 1: 更新 README、CLI/Desktop/tools 文档和 CHANGELOG。**
- [ ] **Step 2: 运行完整验证。**

```bash
node scripts/check.mjs
pnpm build
pnpm typecheck
pnpm test
pnpm --filter @dev-agent/executor test:integration
cd runtime/rust
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cd ../..
git diff --check
```

- [ ] **Step 3: 人工 review。** 确认 applied guard 未被隐式清理、cleanup 没有文件副作用、Undo 状态只在成功后落盘、历史 JSON 仍不是执行输入、v36 的 restore/cancel/no-auto-rollback/MCP/Rust 边界均保持不变。
- [ ] **Step 4: Commit and push。**

## Acceptance Checklist

- [ ] validation history 有明确上限或显式 cleanup，清理结果可审计且幂等。
- [ ] 仍为 `applied` 的 change-set evidence 永不被隐式淘汰；被保护的数量和原因可见。
- [ ] 只有受保护 rollback 成功后才可把 evidence 标为 `rolled-back`；冲突/失败/取消不改变状态。
- [ ] cleanup 不执行命令、不读写工作区、不恢复 before-image，不影响其它 session。
- [ ] CLI 和 Desktop 的历史/JSON/API 兼容，evidence 不进入模型上下文。
- [ ] v36 全部回归矩阵与 TypeScript、Executor、Rust、结构检查均通过。

## v37 完成后的后续路线

1. **v38 before-image 设计评审**：只有在完整性保护、容量上限、用户确认和恢复失败策略都明确后，才讨论跨进程 Undo。
2. **可选审计导出**：面向调试/合规的 metadata-only evidence export，默认不暴露文件内容和可执行输入。
3. **长期回归守护**：把 restore/retention/cleanup/cancellation 作为每次发布前的固定矩阵。
