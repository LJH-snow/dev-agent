# Day plan v35：验证证据持久化与显式重跑

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Each task is tracked with checkbox steps and must pass its own test gate before the next task starts.

**Goal:** 把 v34 的一次性 validation 结果变成可追踪、可验证、可显式重跑的 session 能力，同时保持 apply、validation 和 Undo 的安全边界分离。

**Architecture:** 在现有 `AgentMemory` 文件格式上增加可选的结构化 validation records，旧的 `version: 1` session 文件仍可读取。AgentLoop 在成功 reviewed apply 后先发出 validation 事件，再把同一个完整 DTO 记录到 memory；后续 CLI/Desktop 只通过 change-set guard 和可信 planner 读取或重跑，不接受模型提供的命令字符串。

**Tech Stack:** TypeScript、Node.js `node:test`、现有 `FileMemory`/`InMemoryMemory`、AgentLoop、CLI/HTTP Desktop、现有结构化 Executor 和 Rust sandbox。

**Spec:** `docs/day-plan-v34-progress.md` 的“v35 候选：验证证据持久化与显式重跑”章节。

## Global Constraints

- 只记录真实 `approved apply` 产生的 validation；deny、冲突、rollback 和没有同一 `changeSetId` 的结果不得伪造 validation evidence。
- 允许旧的 session memory 文件缺少 validation 字段；未知字段继续可读，已有 entry、summary、usage 行为不能改变。
- 不接受模型提供的可执行文件、shell 字符串、任意参数或 diff 文本；重跑只能由可信 planner 重新生成结构化 command。
- validation failure、timeout、cancel 和 blocked 永远不自动 rollback；postimage/快照冲突优先返回 `blocked`。
- 每个任务先写失败测试并观察到正确失败，再写最小实现；每个任务单独提交。
- 所有持久化、并发、取消和导出逻辑都必须保持 session 隔离，不允许一个 session 的 validation 事件泄漏到另一个 session。

---

## Task 0：定义 validation record contract 并建立兼容基线（已完成）

**Files:**
- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/validation.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/memory.ts`
- Test: `/Users/Admin/Desktop/dev-agent/packages/agent-core/tests/memory.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/packages/agent-core/tests/validation-lifecycle.test.ts`

**Interfaces:**

```ts
export interface ValidationRecord extends ValidationResult {
  readonly recordedAt: string;
}

export interface AgentMemory {
  // existing methods remain unchanged
  recordValidation?(result: ValidationResult): Promise<void>;
  validations?(): Promise<readonly ValidationRecord[]>;
}
```

- [x] **Step 1: 写失败测试。** 为 `InMemoryMemory` 和 `FileMemory` 增加 validation record 写入、跨实例读取、clear 清理和旧 JSON 缺少 `validations` 字段仍可读取的测试；在 lifecycle 测试中断言 approved apply 之后 memory 有一条带 `recordedAt` 的完整结果。
- [x] **Step 2: 运行 focused test 确认失败。**

```bash
pnpm --filter @dev-agent/agent-core typecheck
pnpm --filter @dev-agent/agent-core test
```

Expected: 编译或测试失败，因为 `ValidationRecord`、`recordValidation` 和 `validations` 尚未存在。

- [x] **Step 3: 写最小实现。** 为 in-memory/file memory 添加可选 validation records；保持 memory 文件 `version: 1`，将 `validations` 作为可选数组校验和持久化，并确保 append、compact、summary、usage 写入都会保留已有 records。
- [x] **Step 4: 接入 AgentLoop 持久化。** validation callback 发送后调用 `context.memory.recordValidation?.(validation)`；记录失败不得把已经成功的 apply 伪装成失败，也不得触发 rollback。
- [x] **Step 5: 运行 focused test 确认通过。**
- [x] **Step 6: Commit。**

**Task 0 verification record (2026-09-13):**

- RED：新增 memory/lifecycle tests 首次运行时因 `ValidationRecord`、`recordValidation` 和 `validations` 不存在而编译失败。
- GREEN：agent-core build 与全套测试通过，**90/90**；覆盖 in-memory/file memory evidence、跨实例持久化、append/usage/summary 保留、clear 清理、旧 session 缺少 `validations` 字段兼容，以及 approved apply 自动记录完整 validation DTO。
- 设计：session 文件继续使用 `version: 1`，`validations` 是可选结构化数组，不进入模型 ChatMessage 上下文；AgentLoop 发出 validation 后 best-effort 写入 evidence，失败不触发 rollback。

## Task 1：把 validation records 接入 session 查询与导出

**Files:**
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/src/server.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/public/index.html`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/index.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/README.md`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/README.md`
- Test: `/Users/Admin/Desktop/dev-agent/apps/desktop/tests/multi-session.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/desktop/tests/validation.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/validation.test.ts`

- [x] **Step 1: 写失败测试。** 让 Desktop session history/export 和 CLI `--json` 在存在 validation records 时返回结构化数组；旧 session 没有 records 时仍返回空数组或保持兼容的缺省值，且 records 不出现在发给模型的普通 ChatMessage 列表中。
- [x] **Step 2: 运行 focused test 确认失败。**
- [x] **Step 3: 实现只读查询和导出。** 复用 `AgentMemory.validations()`，不重新解析 tool 文本；导出保留 `validationId`、`changeSetId`、`recordedAt`、check 状态、bounded output 和 reason。
- [x] **Step 4: 运行 Desktop/CLI focused tests 和 typecheck。**
- [x] **Step 5: Commit。**

**Task 1 verification record (2026-09-13):**

- RED：Desktop history response initially had no `validations`, export omitted the evidence section, CLI second-run JSON returned an empty array, and the browser history loader ignored persisted validations.
- GREEN：agent-core build/tests **90/90**、Desktop build/tests **65/65**、CLI build/tests **106/106** all pass；Desktop inline script `node --check` remains passing.
- 行为：Desktop `/api/sessions/<id>/messages` returns `messages` plus structured `validations`; Markdown export includes a JSON evidence section；CLI `--json` reads persisted validation records；session switching renders saved validation cards without entering model context。

## Task 2：提供受 guard 保护的显式 validation rerun

**Files:**
- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/validation.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/index.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/src/server.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/src/chat-session.ts`
- Test: `/Users/Admin/Desktop/dev-agent/packages/agent-core/tests/validation-lifecycle.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/validation.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/desktop/tests/validation.test.ts`

- [ ] **Step 1: 写失败测试。** 覆盖按 `changeSetId` 找不到、已 rollback、postimage 不匹配、工作区快照变化、并发 session 和取消时的 rerun；成功 rerun 必须生成新的 `createValidationAttemptId`，但仍关联原 change set。
- [ ] **Step 2: 运行 focused test 确认失败。**
- [ ] **Step 3: 实现显式入口。** CLI 提供明确的 rerun 操作，Desktop 提供对应 HTTP/SSE 流程；入口只接收 change-set id，通过现有 change-set store/guard 确认状态，再调用可信 planner/runner。
- [ ] **Step 4: 验证失败、冲突和取消语义。** apply 已完成但 rerun 失败仍保留文件 bytes；不得用 rerun 覆盖、修复或回滚用户文件。
- [ ] **Step 5: 运行 focused tests 和 typecheck。**
- [ ] **Step 6: Commit。**

## Task 3：增加受限 validation policy

**Files:**
- Modify: `/Users/Admin/Desktop/dev-agent/packages/tools/src/validation-plan.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/config.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/index.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/src/chat-session.ts`
- Test: `/Users/Admin/Desktop/dev-agent/packages/tools/tests/validation-plan.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/config.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/validation.test.ts`

- [ ] **Step 1: 写失败测试。** 覆盖 `default`、`fast`、`strict` 三个预定义 policy 的 check 集合、timeout 上限、未知 policy 拒绝、超出上限拒绝，以及配置中命令/参数注入被拒绝。
- [ ] **Step 2: 运行 focused test 确认失败。**
- [ ] **Step 3: 实现 policy 映射。** policy 只能选择代码内预定义的 check id 和合法 timeout；planner 继续从真实 changed paths 派生命令，不读取配置中的 executable、shell 或 args。
- [ ] **Step 4: 运行 planner、CLI 和 Desktop focused tests。**
- [ ] **Step 5: Commit。**

## Task 4：全量回归、文档和发布

**Files:**
- Modify: `/Users/Admin/Desktop/dev-agent/README.md`
- Modify: `/Users/Admin/Desktop/dev-agent/docs/CHANGELOG.md`
- Modify: `/Users/Admin/Desktop/dev-agent/docs/day-plan-v35-progress.md`
- Modify: `/Users/Admin/Desktop/dev-agent/docs/day-plan-v35.md`

- [ ] **Step 1: 更新 CLI/Desktop/tools 文档和 session export 示例。**
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

- [ ] **Step 3: 人工 review。** 检查旧 session migration、records 不进入模型上下文、rerun guard、session 隔离、no-auto-rollback、MCP 无交互安全和 Rust 进程清理。
- [ ] **Step 4: Commit and push。**

## Acceptance Checklist

- [ ] 旧 `version: 1` session 文件在没有 `validations` 字段时可以正常读取。
- [ ] approved apply 产生的 validation DTO 能在 memory、CLI JSON、Desktop history/export 中保持一致。
- [ ] 一次 change set 可关联多次 validation attempt，attempt id 可区分且 change-set id 不变。
- [ ] rerun 只能由显式用户入口触发，且经过 change-set/postimage/snapshot guard。
- [ ] policy 只能选择预定义检查，不能注入 executable、shell、args、diff 或任意路径。
- [ ] failure、timeout、cancel、blocked 不自动 rollback，不遗留后台进程，且 session 事件不串线。
- [ ] v34 全部测试、Rust checks、MCP denial、review diff 和 Undo guard 无回归。
