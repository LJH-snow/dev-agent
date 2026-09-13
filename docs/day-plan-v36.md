# Day plan v36：跨进程变更集证据与安全重跑

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让一次已经通过本地审批并成功应用的 change set 在应用重启后仍能被识别，并在重新验证前重新确认工作目录、路径、文件类型和 postimage；整个恢复过程不执行历史 JSON 中的命令，也不自动修改或回滚用户文件。

**Architecture:** 在 agent-core memory 中增加一个最小、可结构化验证的 applied change-set evidence contract；FileMemory 和 InMemoryMemory 只保存变更集身份、会话绑定、工作目录、文件元数据和哈希，不保存可执行命令或原始文件字节。FilesystemTool 在新进程启动时显式恢复轻量记录，先验证 session/workdir/path/postimage，再把它放入仅可用于只读 validation guard 的内存索引；恢复记录不能执行 Undo。AgentLoop 只在本地 apply 成功后 best-effort 写入 evidence，CLI/Desktop 在显式 rerun 前加载并恢复 evidence。

**Tech Stack:** TypeScript, Node.js `fs/promises`, agent-core `AgentMemory`, `FileMemory`, `FilesystemTool`, CLI/Desktop session lifecycle, Node test runner。

**Spec:** 本文件；v35 收口和已知限制见 `docs/day-plan-v35-progress.md`。

## Global Constraints

- 只记录经过本地 review 并成功 apply 的 change set；denied、prepared、failed、rolled-back 或未知状态不能成为可重跑的 applied evidence。
- persisted evidence 不是可信执行输入；任何从 memory 读出的记录都必须重新通过 session、working directory、相对路径、文件类型、存在性和 postimage hash 校验。
- 不从 persisted evidence 恢复 shell、executable、args、cwd、diff、patch、文件内容或 rollback before-image；validation 命令仍只能由当前代码内 planner 生成。
- 恢复失败必须是显式的 blocked/错误结果；不得修改、回滚、覆盖或“修复”用户文件，也不得为了恢复而创建目录或文件。
- rerun 只允许使用 postimage guard；跨进程恢复的 change set 不支持 Undo，必须返回明确原因，避免伪造 before-image。
- 旧的 `version: 1` session memory 文件（没有新字段时）必须继续可读；evidence 不进入普通 ChatMessage，也不发送给模型。
- 不改变现有 v35 的 cancellation、session isolation、MCP denial、approval review、validation policy 和 no-auto-rollback 边界。
- 新增行为遵循 TDD：每个 production 行为先有预期失败测试，再写最小实现，再运行聚焦测试和完整回归。

---

## 文件与边界

- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/memory.ts` — 定义跨包可用的最小 evidence contract，并让两种 memory 实现持久化/读取/清理。
- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/loop.ts` — 仅在 review-backed apply 成功后记录 evidence；记录失败不得改变 apply 结果。
- Modify: `/Users/Admin/Desktop/dev-agent/packages/tools/src/filesystem.ts` — 校验并恢复轻量 applied evidence；区分本进程可 Undo 记录与跨进程只读 guard 记录。
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/index.ts` — CLI session 创建和显式 `:validate` 入口恢复 evidence，并报告 blocked 原因。
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/src/chat-session.ts` — Desktop session 生命周期恢复 evidence，支持重启后的显式 validation rerun。
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/src/server.ts` — 如需调整 HTTP 错误映射，只返回结构化、安全的恢复/冲突状态。
- Test: `/Users/Admin/Desktop/dev-agent/packages/agent-core/tests/memory.test.ts`、`validation-lifecycle.test.ts` — evidence schema、旧文件兼容、apply 成功记录和 best-effort 失败。
- Test: `/Users/Admin/Desktop/dev-agent/packages/tools/tests/filesystem-changeset.test.ts` — restore guard、身份绑定、postimage 冲突、路径边界、禁止跨进程 rollback。
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/validation.test.ts`、`/Users/Admin/Desktop/dev-agent/apps/desktop/tests/chat-session.test.ts` — CLI/Desktop restart-like lifecycle。
- Modify: `/Users/Admin/Desktop/dev-agent/README.md`、`apps/cli/README.md`、`apps/desktop/README.md`、`packages/tools/README.md`、`docs/CHANGELOG.md`、`docs/day-plan-v36-progress.md` — 对外说明和验证记录。

## Task 0：定义 evidence contract 与 memory 持久化

**Produces:** `AppliedChangeSetRecord`、`recordChangeSet()`、`changeSets()`，并保持 v35 memory 行为兼容。

- [x] **Step 1: 写失败测试。**
  - `InMemoryMemory` 可以记录并按顺序读取 applied evidence。
  - `FileMemory` 写入后重新实例化仍可读，`clear()` 会移除 evidence。
  - 旧的 `version: 1` JSON 没有 `changeSets` 字段时仍可读取。
  - 非法 evidence（空 id、绝对路径、无效 state、文件字段缺失）在读取时被拒绝，且未知顶层字段仍不影响兼容性。
- [x] **Step 2: 运行聚焦测试确认 RED。**
- [x] **Step 3: 写最小实现。**
  - 只定义文件级元数据和哈希；不依赖 `@dev-agent/tools`，避免 agent-core 反向依赖。
  - `recordChangeSet` 采用 change-set id 幂等替换，避免重复事件无限增长。
  - `persist()` 在 append、summary、usage、validation、change-set 写入时保留所有既有结构化字段。
- [x] **Step 4: 运行聚焦测试确认 GREEN。**
- [x] **Step 5: 提交。**

## Task 1：FilesystemTool 恢复 postimage guard

**Produces:** `restoreAppliedChangeSet()` / `restoreAppliedChangeSets()`；恢复记录只能被 `withAppliedChangeSet()` 使用，不能被 `rollbackChangeSet()` 使用。

- [x] **Step 1: 写失败测试。**
  - 用一个新 `FilesystemTool` 实例和持久化记录恢复已应用 change set，postimage 匹配时 `withAppliedChangeSet()` 能执行只读回调。
  - session id 或 resolved working directory 不匹配时恢复失败。
  - 记录中包含绝对路径、路径穿越、重复路径、非法 kind/state 或伪造 hash 时恢复失败。
  - 文件被用户改动、删除、替换成目录，或目录被替换成文件时，恢复/guard 被阻断；任何失败都不写文件。
  - 恢复的 change set 调用 rollback 明确失败；本进程原有完整记录的 rollback 行为不变。
  - 批量恢复只保留合法且 postimage 仍匹配的记录，并返回每条记录的结构化结果/原因，不吞掉 session 隔离错误。
- [x] **Step 2: 运行聚焦测试确认 RED。**
- [x] **Step 3: 写最小实现。**
  - 恢复前 canonicalize 当前工作目录，检查 record 的 session/workdir 绑定。
  - 只接受相对、规范化后仍位于工作目录内的路径；不跟随历史 evidence 中的命令或 diff。
  - 为恢复记录构造只含 review/postimage 的内存记录；guard 使用独立 postimage 检查，不调用要求 before-image 的 rollback preflight。
  - 将恢复记录标记为 `restored`，rollback 返回明确的 “before-image unavailable” 错误。
  - 批量恢复遵守现有数量上限，不让恢复的 applied 记录淘汰本进程正在使用的记录。
- [x] **Step 4: 运行聚焦测试确认 GREEN。**
- [x] **Step 5: 提交。**

## Task 2：AgentLoop 记录成功 apply，接通 CLI/Desktop 生命周期

**Produces:** restart-like 场景中，成功 apply 后关闭并重新创建 session，再显式 rerun 时仍能走 trusted validation；记录失败不影响用户文件和 apply 成功状态。

- [x] **Step 1: 写失败测试。**
  - AgentLoop 在 review-backed apply 成功后记录一条 evidence；普通 write、denied apply、失败 apply 不记录。
  - FileMemory 写入 evidence 后，用同一 memory 文件创建新 CLI/Desktop session，显式 rerun 可以恢复并执行 validation。
  - 新 session 使用不同 session id 或不同工作目录时不能借用旧 evidence。
  - evidence 写入失败时 apply 仍成功，且不触发 rollback 或伪造 validation failure。
  - Desktop/CLI rerun 在恢复冲突时返回 blocked evidence 或稳定的结构化错误，不执行检查前的文件修复。
- [x] **Step 2: 运行聚焦测试确认 RED。**
- [x] **Step 3: 写最小实现。**
  - AgentLoop 从本地 review 和成功 apply identity 构造 `AppliedChangeSetRecord`，只调用 `memory.recordChangeSet?.()`。
  - CLI/ChatSession 在显式 rerun 前确保从 memory 加载并恢复 records；恢复动作可重复调用且幂等。
  - Desktop 继续保持 UI/HTTP 的现有 validation event 形状，只补充 restart/blocked 状态。
- [x] **Step 4: 运行聚焦测试确认 GREEN。**
- [x] **Step 5: 提交。**

## Task 3：详情、筛选和兼容性收口

**Produces:** 用户可以按 change set / attempt / status 查看证据，但 evidence 仍不会进入模型上下文；对外接口清楚区分历史记录、可重跑记录和被阻断记录。

- [ ] **Step 1: 写失败测试。**
  - CLI JSON、Desktop history/export 能返回 change-set evidence 摘要和恢复状态。
  - validation attempt 与 change-set identity 保持一对多关系，筛选不会混用 session。
  - 旧 history、旧 memory、没有 evidence 的 session 输出保持兼容。
- [ ] **Step 2: 运行聚焦测试确认 RED。**
- [ ] **Step 3: 写最小实现。**
  - 只公开元数据、哈希、状态和阻断原因；不公开命令执行入口，也不把 evidence 拼进模型消息。
  - 若现有接口不足，优先扩展结构化字段而非改变既有事件名称。
- [ ] **Step 4: 运行聚焦测试确认 GREEN。**
- [ ] **Step 5: 提交。**

## Task 4：全量回归、文档和发布

**Produces:** v36 可审计、可回滚（代码层面的提交回滚，不是自动 Undo）并可交付。

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

- [ ] **Step 3: 人工 review。** 确认历史 JSON 不成为执行输入、session/workdir/path/hash guard、恢复记录禁止 rollback、失败不自动修复/回滚、旧 memory migration、MCP 与 v35 policy 边界均保持不变。
- [ ] **Step 4: Commit and push。**

## Acceptance Checklist

- [ ] 成功 apply 的 change set 会留下最小、结构化、session-bound 的 evidence；denied/failed/prepared 不会成为可重跑 evidence。
- [ ] 重启后可恢复合法 applied evidence，并在 rerun 前重新检查工作目录、相对路径、文件类型、存在性和 postimage hash。
- [ ] 任何恢复冲突均不写文件、不回滚、不执行历史命令或 diff，并以 blocked/明确错误返回。
- [ ] 跨进程恢复记录不能 Undo；同进程完整 before-image rollback 行为保持不变。
- [ ] CLI 和 Desktop 的显式 rerun 在重启后可工作，session/workdir 隔离有效。
- [ ] evidence 不进入模型上下文；旧 v35 session、validation、approval、policy、cancel、MCP 和 Rust 回归均通过。

## v36 完成后的后续路线

1. **v37 自动化回归守护**：把跨进程 restore、postimage conflict、session isolation、no-auto-rollback 和 cancellation 固定为持续回归矩阵。
2. **v37 evidence retention**：为历史 evidence 增加有限保留、压缩和显式删除，但删除不能影响当前 applied guard 的安全性。
3. **后续再评估跨进程 Undo**：只有在设计并加密/完整性保护 before-image、容量和用户确认流程后，才考虑跨进程 Undo；v36 不实现。
