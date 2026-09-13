# v33 代码修改 Diff 审阅、批准与回滚实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Agent 修改工作区前生成真实、可验证的 change set，让用户审阅 diff 后批准或拒绝，并支持原子应用、哈希校验和最近一次变更回滚。

**Architecture:** `@dev-agent/tools` 负责只读 preview、统一 diff、SHA-256 preimage/postimage、原子 apply 和 guarded rollback；`@dev-agent/agent-core` 只增加通用 approval preparation/review 数据，不依赖 tools 包。CLI 与 Desktop 各自把 `review-writes` 模式接到同一套 preparation contract：审批前只生成 change set，批准后只执行带 change-set id 的 apply 输入。所有 apply 在写盘前重新校验全部 preimage，任何 hunk、哈希或审批状态不匹配都不得写入文件。

**Tech Stack:** Node.js 26 built-ins (`node:fs/promises`, `node:crypto`, `node:path`), TypeScript 5.9, Node test runner, pnpm workspace, existing AgentLoop approval policy, CLI stdin, Desktop HTTP/SSE UI。

**Spec:** `/Users/Admin/Desktop/dev-agent/docs/day-plan-v32.md#v33：代码修改-diff-审阅、批准与回滚`

## Global Constraints

- 不增加运行时依赖；diff、哈希、临时文件和回滚只使用 Node 内置 API。
- `allow`、`deny-dangerous`、现有 `ask` 的行为保持兼容；只有显式选择 `review-writes` 才强制保护普通 filesystem 写入。
- `preview` 绝不修改工作区；`apply` 只接受仍匹配 preview 时记录的全部 preimage；`rollback` 只接受仍匹配 apply 后全部 postimage 的 change set。
- 多文件 change set 采用全有或全无语义：任何预检失败、审批拒绝、哈希冲突或写入失败都不能留下部分修改。
- 拒绝、超时、客户端断开和并发冲突必须保持文件字节不变；错误信息必须包含 change-set id 或冲突文件路径。
- 先为每个 Task 写失败测试并运行，再写最小实现；每个 Task 通过 focused test 后单独提交。
- 不重排根 README 已有的历史 Roadmap 编号；v33 只追加完成项和下一步说明。

---

### Task 0: 建立 v33 进度账本和工作区基线

**Files:**
- Create: `/Users/Admin/Desktop/dev-agent/docs/day-plan-v33-progress.md`
- Modify: `/Users/Admin/Desktop/dev-agent/docs/day-plan-v33.md`

**Interfaces:**
- 账本记录每个 Task 的提交、测试、失败原因和实际测试数量。
- 代码变更前记录 `git status --short --branch`，确保 v32 已从 `origin/main` 同步。

- [x] **Step 1: 写账本和基线。** 在进度账本记录 v33 目标、当前 commit `bd05586`、工作区基线、阶段顺序和错误记录表。
- [x] **Step 2: 运行基线命令。** 运行 `git status --short --branch`、`git log -1 --oneline --decorate`、`pnpm --filter @dev-agent/tools test` 和 `pnpm --filter @dev-agent/agent-core test`，把实际结果写入账本。
- [x] **Step 3: Commit the plan.**

```bash
git add docs/day-plan-v33.md docs/day-plan-v33-progress.md
git commit -m "docs: add v33 write review plan"
```

### Task 1: 建立 change-set 数据模型、哈希和统一 diff

**Files:**
- Create: `/Users/Admin/Desktop/dev-agent/packages/tools/src/change-set.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/packages/tools/src/index.ts`
- Test: `/Users/Admin/Desktop/dev-agent/packages/tools/tests/change-set.test.ts`

**Interfaces:**
- `ChangeSetFileReview`：`path`, `kind` (`file`/`directory`), `beforeHash?`, `afterHash`, `diff`, `additions`, `deletions`, `beforeExists`, `afterExists`。
- `ChangeSetReview`：`changeSetId`, `files`, `additions`, `deletions`, `createdAt`。
- `createChangeSetId(): string` 使用 `randomUUID()`。
- `hashBytes(value: Uint8Array): string` 使用 SHA-256 hex digest。
- `buildUnifiedDiff(path, before, after): { diff: string; additions: number; deletions: number }`；输出 `--- a/<path>`, `+++ b/<path>`, `@@` 和带 `+`/`-`/` ` 前缀的行。

- [x] **Step 1: 写失败测试。** 覆盖新文件、修改文件、空文件、删除全部文本、无变化、UTF-8 内容、SHA-256 稳定值和多文件聚合统计；断言 preview 结果包含路径、哈希、diff 和增删数量。
- [x] **Step 2: 运行 focused test 确认失败。**

```bash
pnpm --filter @dev-agent/tools test -- --test-name-pattern="change set"
```

Expected: FAIL，因为 change-set 模块和导出尚不存在。

- [x] **Step 3: 实现最小模型。** 在 `change-set.ts` 中只放纯类型、id/hash、按行 LCS diff 和汇总函数；不读写工作区，不引入第三方 diff 包。统一 diff 对最后没有换行的文件保持稳定，不把空字符串误计为一行。
- [x] **Step 4: 运行 focused test 确认通过。**

```bash
pnpm --filter @dev-agent/tools test
```

Expected: 新增 change-set 测试和现有 tools 测试全部通过。

- [x] **Step 5: Commit。**

```bash
git add packages/tools/src/change-set.ts packages/tools/src/index.ts packages/tools/tests/change-set.test.ts
git commit -m "feat(tools): add change-set diff and hash model"
```

### Task 2: 为 FilesystemTool 增加 preview/apply/rollback 和原子写入

**Files:**
- Modify: `/Users/Admin/Desktop/dev-agent/packages/tools/src/filesystem.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/packages/tools/src/index.ts`
- Test: `/Users/Admin/Desktop/dev-agent/packages/tools/tests/filesystem-preview.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/packages/tools/tests/filesystem-changeset.test.ts`

**Interfaces:**
- 扩展 filesystem action：`preview`、`apply`、`rollback`；旧的 `read/write/edit/patch/list/stat/mkdir` 输入和返回保持兼容。
- `FilesystemTool.prepareChangeSet(input, context): Promise<{ review: ChangeSetReview; executeInput: { action: "apply"; changeSetId: string } }>`：给 approval preparation 使用。
- `FilesystemTool.rollbackChangeSet(changeSetId): Promise<ChangeSetApplyResult>`：给 Desktop rollback endpoint 使用。
- `preview` 输入使用 `{ action: "preview", changes: Array<{ path, action: "write"|"edit"|"patch"|"mkdir", content?, oldText?, newText?, hunks? }> }`；单个 `write/edit/patch/mkdir` 也能由 `prepareChangeSet` 包装成一个 change。
- `apply` / `rollback` 输入使用 `{ action: "apply"|"rollback", changeSetId: string }`；返回 `{ ok, changeSetId, files, additions, deletions }`。

- [x] **Step 1: 写 preview 失败测试。** 断言 `preview` 对 write/edit/patch/mkdir 返回实际 diff 和 before/after hash，磁盘内容和 mode 完全不变；缺失/重复 hunk、目录替换文件和未知 change-set 输入均给出明确错误。
- [x] **Step 2: 运行 preview focused test 确认失败。**

```bash
pnpm --filter @dev-agent/tools test -- --test-name-pattern="preview"
```

Expected: FAIL，因为 filesystem 尚不认识 `preview` action。

- [x] **Step 3: 写 apply/rollback 失败测试。** 覆盖：单文件批准后 apply、修改文件后 apply 被 hash conflict 拒绝、两个文件中第二个 preimage 冲突时第一个也不变、批准后 rollback 恢复原始字节、新建文件 rollback 删除文件、目录 rollback 删除本次创建的空目录、postimage 冲突阻止 rollback。
- [x] **Step 4: 运行 apply/rollback focused test 确认失败。**

```bash
pnpm --filter @dev-agent/tools test -- --test-name-pattern="apply|rollback|atomic"
```

Expected: FAIL，因为 apply/rollback action 尚不存在。

- [x] **Step 5: 实现 preview。** 复用现有 `editFile`/`patchFile` 的唯一匹配和顺序规则，但把“读取 source → 计算 updated”抽成纯计算层；preview 读取所有目标的 bytes，记录 `beforeHash`，生成 after bytes、统一 diff 和 change-set id，结果写入进程内有上限的 change-set store（最多保留 64 个，淘汰最旧且未引用的记录）。preview 完成前不调用任何写 API。
- [x] **Step 6: 实现原子 apply。** apply 先一次性读取并校验所有 preimage hash、文件类型、change-set id 和未过期记录，再在目标文件同目录创建临时文件、写入 after bytes、关闭并 rename；目录操作在所有文件预检后执行。记录已应用 change set 的 preimage/postimage，发生 rename 或 mkdir 失败时按已完成路径逆序恢复并清理临时文件。
- [x] **Step 7: 实现 guarded rollback。** rollback 先校验所有当前 postimage hash，再用同样的临时文件+rename 恢复旧 bytes，删除原本不存在的文件，按逆序移除本次创建的空目录；任何冲突只返回错误，不触碰其他文件。
- [x] **Step 8: 暴露工具 schema 和公共类型。** 在 `parameters` 中增加 `preview/apply/rollback`, `changes`, `changeSetId` 描述；在 `packages/tools/src/index.ts` 导出 change-set 类型，旧 action schema 不改变。
- [x] **Step 9: 运行 tools 全套测试。**

```bash
pnpm --filter @dev-agent/tools test
```

Expected: 新增 preview/apply/rollback 测试和原有 75 个基线测试全部通过。

- [x] **Step 10: Commit。**

```bash
git add packages/tools/src/filesystem.ts packages/tools/src/index.ts packages/tools/tests/filesystem-preview.test.ts packages/tools/tests/filesystem-changeset.test.ts
git commit -m "feat(filesystem): preview atomically apply and rollback changes"
```

### Task 3: 让 AgentLoop 携带 review preparation 和批准后的 apply 输入

**Files:**
- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/approval.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/loop.ts`
- Test: `/Users/Admin/Desktop/dev-agent/packages/agent-core/tests/approval-review-writes.test.ts`

**Interfaces:**
- `ChangeSetFileReview` 和 `ChangeSetReview` 在 agent-core 中定义为与 tools 结构兼容的只读 DTO，避免反向依赖。
- `ApprovalRequest.review?: ChangeSetReview`。
- `ApprovalPreparation`：`{ review?: ChangeSetReview; executeInput?: unknown }`。
- `ApprovalPolicy.prepare?(request): Promise<ApprovalPreparation | undefined>`。
- `AgentLoopOptions.prepareApproval?` 不新增第二条 preparation 路径；AgentLoop 只调用 `approval.prepare`，保证策略和审批请求是同一个对象。

- [x] **Step 1: 写失败测试。** 用一个 fake `ApprovalPolicy`：`prepare` 返回 review 和 `{ action: "apply", changeSetId }`，approval allow 时 fake tool 只能收到 apply 输入；deny、prepare error 和未配置 prepare 时都不能执行 apply；`onApproval` 必须收到同一个 review。
- [x] **Step 2: 运行 focused test 确认失败。**

```bash
pnpm --filter @dev-agent/agent-core test -- --test-name-pattern="review preparation"
```

Expected: FAIL，因为 ApprovalRequest 没有 review、policy 没有 prepare、loop 仍直接执行原始 input。

- [x] **Step 3: 实现 DTO 和 preparation 生命周期。** AgentLoop 在 `checkApproval` 前调用 `approval.prepare`；成功后把 review 合并进 request；拒绝时不执行 `executeInput`；批准时只运行 preparation 的 `executeInput`。preparation 异常转成 deny reason，避免未经 review 的原始写入继续执行；allow 模式没有 policy，保持零 preparation 开销。
- [x] **Step 4: 运行 AgentLoop 全套测试。**

```bash
pnpm --filter @dev-agent/agent-core test
```

Expected: 新增 review preparation 测试和原有 72 个测试全部通过。

- [x] **Step 5: Commit。**

```bash
git add packages/agent-core/src/approval.ts packages/agent-core/src/loop.ts packages/agent-core/tests/approval-review-writes.test.ts
git commit -m "feat(agent): prepare reviewed tool changes before approval"
```

### Task 4: 增加 review-writes policy 和配置解析

**Files:**
- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/approval.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/config.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/index.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/src/chat-session.ts`
- Test: `/Users/Admin/Desktop/dev-agent/packages/agent-core/tests/approval-review-writes.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/cli-args.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/mcp-server.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/desktop/tests/approval-review-writes.test.ts`

**Interfaces:**
- `ApprovalMode` 与 `DesktopApprovalMode` 增加 `review-writes`。
- `isFilesystemMutation(request): boolean` 覆盖 `write/edit/patch/mkdir/apply/rollback`，但不覆盖只读 `preview`。
- `reviewWritesPolicy({ prepare, requestApproval, patterns, allowlist })`：普通 filesystem mutation 必须先返回 review；无 requester 时安全 deny；危险 shell/git 仍按现有 dangerous policy 处理。
- `ApprovalRequester` 扩展为接收 `{ tool, reason, input, key?, review? }`，现有 ask 调用保持兼容。

- [x] **Step 1: 写 mode 和 policy 失败测试。** 断言 `--approval review-writes` 与 config `approvalMode: review-writes` 能解析；safe filesystem write 也要求审批；read/list/stat、普通 shell 和普通 git 不被无故拦截；deny-dangerous/ask/allow 输出与既有测试一致。
- [x] **Step 2: 运行 focused tests 确认失败。**

```bash
pnpm --filter @dev-agent/agent-core test -- --test-name-pattern="review-writes"
pnpm --filter @dev-agent/cli test -- --test-name-pattern="approval mode"
pnpm --filter @dev-agent/desktop test -- --test-name-pattern="review-writes"
```

Expected: FAIL，因为新 mode 和 policy 尚不存在。

- [x] **Step 3: 实现通用 policy。** 复用 `denyDangerousPolicy` 的 command/allowlist 判断；review request 无论是否匹配危险规则都走 requester。没有 requester 时，对 review write 和危险调用都返回 deny，并说明无法进行交互式审阅。`prepare` 只对 filesystem mutation 生成 change set；manual `apply` 也必须重新获得 review。
- [x] **Step 4: 接入 CLI。** 在创建 approval 前注册 default tools，拿到 `FilesystemTool`，让 review policy 的 prepare 调用 `prepareChangeSet(input, { sessionId, workingDirectory })`；交互提示将真实 unified diff 写到 stderr/stdout 的人类区域后再询问 `Apply this change? [y/N]`。`--json` 只把 review/decision/status 写进最终 JSON，diff 不污染 JSON stdout。
- [x] **Step 5: 接入 Desktop ChatSession。** 在 `ChatSession` 中保存 filesystem tool 引用，review policy 的 prepare 使用同一 session 的 change-set store；`ApprovalPrompt` 携带 review；审批超时、断开和拒绝都不调用 apply。`DEV_AGENT_APPROVAL=review-writes` 和 config `approvalMode` 都生效。
- [x] **Step 6: 运行 focused tests。**

```bash
pnpm --filter @dev-agent/agent-core test
pnpm --filter @dev-agent/cli test
pnpm --filter @dev-agent/desktop test
```

Expected: 全部通过，旧 approval 行为保持兼容。

- [x] **Step 7: Commit。**

```bash
git add packages/agent-core/src/approval.ts apps/cli/src/config.ts apps/cli/src/index.ts apps/desktop/src/chat-session.ts packages/agent-core/tests/approval-review-writes.test.ts apps/cli/tests/cli-args.test.ts apps/desktop/tests/approval-review-writes.test.ts
git commit -m "feat: add review-writes approval mode"
```

### Task 5: CLI diff 展示和结构化 review 输出

**Files:**
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/index.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/config.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/review-writes.test.ts`

**Interfaces:**
- 人类模式的 review 输出包含 change-set id、文件名、增删统计和真实 unified diff。
- `--json` 的最终对象增加 `reviews: Array<{ changeSetId, decision, files, additions, deletions }>`；没有 review 时输出空数组或省略字段，但不得混入纯文本。
- 拒绝/超时 review 的结果写回 model 的 tool result，文件不变；批准后 model 收到 apply 的真实结果。

- [x] **Step 1: 写 CLI E2E 失败测试。** 用现有 stub provider 让模型调用 `filesystem write/edit/patch`；输入 `n` 断言 stderr 含 diff 且文件 hash 不变，输入 `y` 断言 apply 结果和前后 hash；`--json` 断言 stdout 是单个 JSON 值并包含 review 状态。
- [x] **Step 2: 运行 focused test 确认失败。**

```bash
pnpm --filter @dev-agent/cli test -- --test-name-pattern="review-writes"
```

Expected: FAIL，因为 CLI 尚未渲染 review 或收集 reviews。

- [x] **Step 3: 实现渲染和结果收集。** 将 diff 输出限制为 change set 中的实际文件内容，不从原始 input 猜 diff；对拒绝/超时写出明确状态，对批准显示 apply 结果。`--json` 收集 `onApproval` 的 review DTO，最终只在 JSON 对象中输出结构化 review 数组。
- [x] **Step 4: 运行 CLI 全套测试。**

```bash
pnpm --filter @dev-agent/cli test
```

Expected: 新增 review-writes 测试和原有 97 个测试全部通过。

- [x] **Step 5: Commit。**

```bash
git add apps/cli/src/index.ts apps/cli/src/config.ts apps/cli/tests/review-writes.test.ts
git commit -m "feat(cli): show and record reviewed diffs"
```

### Task 6: Desktop 审批 UI、回滚 endpoint 和 SSE 事件

**Files:**
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/src/chat-session.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/src/server.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/public/index.html`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/tests/approval-review-writes.test.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/tests/server.test.ts`

**Interfaces:**
- `approval-request` SSE data 增加 `review`：`{ changeSetId, files: [{ path, diff, additions, deletions, beforeHash, afterHash }], additions, deletions }`。
- `approval` SSE data 保持 `{ tool, decision, reason }` 兼容，并在 review request 时附带 `changeSetId` 和 review summary。
- 新增 `POST /api/changesets/rollback`，body `{ sessionId, changeSetId }`；成功返回 apply result，运行中返回 409，未知/冲突 change set 返回 404/409。
- `DesktopChatSession.rollbackChangeSet?(changeSetId): Promise<unknown>` 为可选接口，fake sessions 不受影响。

- [x] **Step 1: 写 Desktop 失败测试。** 使用 deterministic provider 触发 safe filesystem write：SSE 必须按 `approval-request(review)` → 用户 deny/allow → `approval` → `tool-result` 顺序；deny 和 approval timeout 后 hash 不变；allow 后 apply 写入并返回 changeSetId；rollback endpoint 恢复原始 bytes，postimage 被外部修改时返回冲突且不覆盖。
- [x] **Step 2: 运行 focused test 确认失败。**

```bash
pnpm --filter @dev-agent/desktop test -- --test-name-pattern="review-writes|rollback"
```

Expected: FAIL，因为 review payload、rollback route 和 UI 尚不存在。

- [x] **Step 3: 实现 SSE payload 和 endpoint。** `waitForApproval` 把 review 放入 approval-request；审批结果在 approval frame 保持旧字段并补 changeSetId；rollback route 按 session 查找 changeSet，拒绝并发 run，再调用 `rollbackChangeSet`。
- [x] **Step 4: 实现浏览器 diff UI。** 用 `textContent` 和 `<pre>` 渲染真实 diff，按文件显示增删统计；review request 显示 Allow/Deny，不为每个 change set 提供“Always allow”；批准后显示 Undo 按钮，调用 rollback endpoint 并展示成功/冲突状态。未知 SSE event 继续忽略。
- [x] **Step 5: 运行 Desktop 全套测试。**

```bash
pnpm --filter @dev-agent/desktop test
```

Expected: 新增 review/rollback 测试和现有 Desktop 回归测试全部通过。

- [x] **Step 6: Commit。**

```bash
git add apps/desktop/src/chat-session.ts apps/desktop/src/server.ts apps/desktop/public/index.html apps/desktop/tests/approval-review-writes.test.ts apps/desktop/tests/server.test.ts
git commit -m "feat(desktop): review diffs and rollback change sets"
```

### Task 7: 文档、全量回归与发布

**Files:**
- Modify: `/Users/Admin/Desktop/dev-agent/packages/tools/README.md`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/README.md`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/README.md`
- Modify: `/Users/Admin/Desktop/dev-agent/README.md`
- Modify: `/Users/Admin/Desktop/dev-agent/docs/CHANGELOG.md`
- Modify: `/Users/Admin/Desktop/dev-agent/docs/day-plan-v33-progress.md`
- Modify: `/Users/Admin/Desktop/dev-agent/docs/day-plan-v33.md`

- [x] **Step 1: 文档化 contract。** 记录 preview 输入、changeSetId、unified diff、SHA-256 conflict、review-writes、CLI `--json` reviews、Desktop SSE review payload 和 rollback endpoint。
- [x] **Step 2: 运行完整验证。**

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

实际结果（2026-09-13）：structure check 通过（13 个目录、34 个预期文件）；`pnpm build`、`pnpm typecheck` 通过；TypeScript **512/512**、真实 Rust-binary integration **10/10**、Rust unit/doc **46/46** 通过；浏览器脚本 `node --check` 和 `git diff --check` 通过。

- [x] **Step 3: 统计测试并人工 review。** 实际 focused suite 为 tools 90/90、agent-core 79/79、CLI 101/101、Desktop 61/61；检查了 apply/rollback 的 preimage/postimage 冲突、原子失败清理、change-set store 上限、approval request 清理和 session 并发冲突。
- [x] **Step 4: Commit and push。**

```bash
git add packages/tools packages/agent-core apps/cli apps/desktop README.md docs/CHANGELOG.md docs/day-plan-v33-progress.md docs/day-plan-v33.md
git commit -m "docs: record v33 review workflow"
git push origin main
```

## Acceptance Checklist

- [x] `filesystem preview` 对 write/edit/patch/mkdir 返回真实 diff、before/after hash 和增删统计，且不写盘。
- [x] `review-writes` 在所有 filesystem mutation apply 前显示实际 diff；deny/timeout/disconnect 不改变文件字节。
- [x] apply 只使用稳定 change-set id 并重新校验所有 preimage；多文件冲突不会留下部分修改。
- [x] rollback 重新校验 postimage，恢复原字节/删除新文件/清理新目录；外部修改不会被覆盖。
- [x] CLI 普通模式显示 diff，`--json` 保持单一可解析 JSON 并包含结构化 review 状态。
- [x] Desktop approval-request 携带 review diff，Allow/Deny 可用，Undo endpoint 能成功回滚和报告冲突。
- [x] v32 的 `allow`、`deny-dangerous`、`ask`、MCP cancellation/progress 测试和所有 Rust checks 仍通过。

## Execution Protocol

- 先完成 Task 0，再按 Task 1 → 2 → 3 → 4 → 5 → 6 → 7；每个 Task 通过 focused tests 后单独提交。
- 任何接口扩展先更新本计划和 progress ledger，再写实现；不要为了省事让 CLI/Desktop 各自发明不兼容的 review payload。
- 每次用户取消、审批拒绝、哈希冲突或写入失败后，优先读取工作区 bytes/hash 验证没有副作用，再继续下一步。
- 完成 Task 7 之前不宣称 v33 完成；完成后把实际 commit、push 和测试结果写入账本。
