# day-plan v33 进度账本

> 按 `/Users/Admin/Desktop/dev-agent/docs/day-plan-v33.md` 执行；每个 Task 完成后记录 focused test、提交和实际失败原因。

## 当前状态

- 当前阶段：Task 7，文档、全量回归与发布
- 已完成阶段：Task 0、Task 1、Task 2、Task 3、Task 4、Task 5、Task 6；v32 已完成并推送到 `origin/main`
- 工作区基线：`bd05586 docs: record v32 release verification`
- 最近一次 v32 验证：TypeScript 477/477、Rust 46/46、真实运行时集成 10/10 通过

## 阶段目标

- filesystem preview 只读返回真实统一 diff、SHA-256 before/after hash 和增删统计。
- `review-writes` 在 write/edit/patch/mkdir/apply 前生成稳定 change set，并在批准后才原子写盘。
- 多文件 change set 预检和应用全有或全无；hash conflict、拒绝、超时、断开均保持字节不变。
- CLI 展示 diff，`--json` 返回结构化 review；Desktop 通过 SSE 展示 diff、批准/拒绝并提供 guarded rollback。
- v32 的取消、进度、审批兼容性和 Rust 安全边界不回归。

## Task 日志

### Task 0：建立进度账本和工作区基线（已完成）

- 基线状态：`## main...origin/main`，工作区仅包含本计划与进度账本两个未跟踪文档。
- 基线提交：`bd05586 docs: record v32 release verification`（`HEAD` 与 `origin/main` 一致）。
- `pnpm --filter @dev-agent/tools test`：75/75 通过。
- `pnpm --filter @dev-agent/agent-core test`：72/72 通过。
- 失败原因：无。
- 提交：`docs: add v33 write review plan`。

## Task 记录

| Task | 状态 | 实际结果 | 提交 |
|------|------|----------|------|
| Task 0 | 已完成 | tools 75/75；agent-core 72/72；基线与远端一致 | `docs: add v33 write review plan` |
| Task 1 | 已完成 | 首次 focused test 按预期因公共导出不存在而失败；随后 tools 全套 80/80 通过 | `bccb6a4 feat(tools): add change-set diff and hash model` |
| Task 2 | 已完成 | preview/apply/rollback 红测与目录依赖边界红测后，tools 全套 90/90 通过 | `83e15db feat(filesystem): preview atomically apply and rollback changes` |
| Task 3 | 已完成 | 首次测试因 ApprovalPolicy 不含 prepare、ApprovalRequest 不含 review 而编译失败；随后 agent-core 全套 76/76 通过 | `8a325ec feat(agent): prepare reviewed tool changes before approval` |
| Task 4 | 已完成 | mode/policy 初次编译红测；MCP review-writes 初次因复用 deny-dangerous 而返回 workspace 越界理由；修正后 agent-core 79/79、CLI 99/99、Desktop 55/55 通过 | `aa646ab feat: add review-writes approval mode` |
| Task 5 | 已完成 | CLI E2E 首次因 JSON 缺少 `reviews` 失败；随后 CLI build 与全套 **101/101** 通过，JSON 只输出一个对象且记录 allow review | `d546dd8 feat(cli): show and record reviewed diffs` |
| Task 6 | 已完成 | Desktop rollback 方法、SSE review payload、endpoint 与 UI 初次红测后，Desktop 全套 **61/61** 通过；UI 脚本 `node --check` 通过 | `feat(desktop): review diffs and rollback change sets`（待提交） |

### Task 1：建立 change-set 数据模型、哈希和统一 diff（已完成）

- RED：`pnpm --filter @dev-agent/tools test -- --test-name-pattern="change set|change-set|UnifiedDiff|hashBytes"` 首次因 `dist/index.d.ts` 尚无 5 个新导出而失败，确认失败来自待实现功能。
- GREEN：`pnpm --filter @dev-agent/tools build` 后运行 `pnpm --filter @dev-agent/tools test`，tools **80/80** 通过（基线 75 + 新增 5）。
- 覆盖：新文件、修改、空文件、全量删除、无变化、UTF-8、稳定 SHA-256、UUID change-set id、多文件增删汇总。
- 实现：`packages/tools/src/change-set.ts` 使用 Node 内置 crypto、TextEncoder/TextDecoder 和按行 LCS；无运行时依赖、无工作区写入。
- 提交：`bccb6a4 feat(tools): add change-set diff and hash model`。

### Task 2：FilesystemTool preview/apply/rollback 和原子写入（已完成）

- RED（preview）：`pnpm --filter @dev-agent/tools test -- --test-name-pattern="preview|apply|rollback|atomic"` 首次按预期失败：filesystem 尚不认识新 action，且 `prepareChangeSet` 不存在。
- RED（边界）：新增“文件列在 mkdir 之前”测试后再次失败，确认 change set 需要先规划目录依赖。
- GREEN：`pnpm --filter @dev-agent/tools build` 后运行 `pnpm --filter @dev-agent/tools test`，tools **90/90** 通过（基线 75 + Task 1 的 5 + Task 2 的 10）。
- 覆盖：只读 preview、write/edit/patch/mkdir、缺失/重复 hunk、目录/文件冲突、单文件 apply、全量 preimage 预检、多文件冲突全不写、原子替换、existing/new file rollback、mkdir rollback、postimage 冲突、目录依赖无序。
- 实现：`FilesystemTool` 维护最多 64 个 change set；preview 只读记录 bytes/hash/diff，apply 统一预检后先建目录再同目录临时文件 rename，rollback 校验 postimage 后恢复或删除并清理本次创建的空目录。
- 额外修正：保持旧 read 的 working-directory 解析行为；将 edit/patch 的纯计算与写盘拆开；apply/rollback 错误包含 change-set id 和冲突路径。
- 提交：`83e15db feat(filesystem): preview atomically apply and rollback changes`。

### Task 3：AgentLoop review preparation 和批准后的 apply 输入（已完成）

- RED：`pnpm --filter @dev-agent/agent-core test -- --test-name-pattern="approval preparation|prepared change|preparation failure|without preparation"` 首次因 `ApprovalPolicy.prepare`、`ApprovalRequest.review` 尚不存在而失败，确认测试锁定了新生命周期。
- GREEN：`pnpm --filter @dev-agent/agent-core typecheck` 与 `pnpm --filter @dev-agent/agent-core test` 通过，agent-core **76/76**（基线 72 + 新增 4）。
- 覆盖：prepare 返回 review/apply input 后 allow 才执行 apply；deny 不执行原始 mutation；prepare 异常转 denial；未配置 prepare 保持旧 input 行为；`onApproval` 收到同一 review DTO。
- 实现：agent-core 增加 tool-agnostic change-set DTO 和 `ApprovalPreparation`；AgentLoop 在 `decide` 前执行 prepare，失败即拒绝，批准后只将 `executeInput` 交给工具。
- 提交：`8a325ec feat(agent): prepare reviewed tool changes before approval`。

### Task 4：增加 review-writes policy 和配置解析（已完成）

- RED：新增 mode、policy 和 Desktop review 测试后，首次因 `review-writes` 尚未进入类型与导出而编译失败；修复 policy 后又补上 MCP 回归测试，首次暴露 `--mcp-server` 仍复用 `deny-dangerous` 的语义缺口。
- GREEN：agent-core 全套 **79/79**、CLI 全套 **99/99**、Desktop 全套 **55/55** 通过；CLI 与 Desktop build、agent-core typecheck 通过。
- 覆盖：`review-writes` CLI/config/env 解析；write/edit/patch/mkdir/apply/rollback 分类；preview/read/list/stat、普通 shell/git 保持可用；交互 CLI 与 Desktop 只在批准后执行 apply；无交互 MCP 对 mutation 明确拒绝且不写盘；危险命令仍沿用原有规则。
- 实现：`reviewWritesPolicy` 复用 dangerous command/allowlist 判断；filesystem mutation 通过同一 `FilesystemTool` 生成 review 与 apply input；CLI 使用 unified diff prompt，Desktop `ApprovalPrompt` 携带 review；MCP 无 requester 时返回 interactive review denial。
- 提交：`aa646ab feat: add review-writes approval mode`。

### Task 5：CLI diff 展示和结构化 review 输出（已完成）

- RED：新增 CLI stub-provider E2E 后，首次因 JSON 结果没有 `reviews` 字段失败；修复前也验证了 `n` 输入不会写盘、stderr 中的 diff 来自真实 change set。
- GREEN：`pnpm --filter @dev-agent/cli build` 与 `pnpm --filter @dev-agent/cli test` 通过，CLI **101/101**。
- 覆盖：人类模式显示 change-set id、文件路径、增删统计和 unified diff；拒绝保持原文件字节不变；批准后执行 apply；`--json` stdout 保持单个 JSON 对象并追加结构化 `reviews` 数组。
- 实现：CLI 在 `AgentLoop.onApproval` 收集 review DTO、decision、文件增删统计和真实 diff；`runPrompt` 将累计 review 写入 JSON，交互模式跨 prompt 保持同一 session 的 review 记录。
- 提交：`d546dd8 feat(cli): show and record reviewed diffs`。

### Task 6：Desktop 审批 UI、回滚 endpoint 和 SSE 事件（已完成）

- RED：新增 ChatSession rollback、SSE review、rollback route、并发冲突和 UI 静态检查后，首次因 `rollbackChangeSet`、route 和 UI 入口尚不存在而失败；中途修正测试等待逻辑，并保留 ask 模式的 “Always allow”。
- GREEN：`pnpm --filter @dev-agent/desktop test` 通过，Desktop **61/61**；从 HTML `<script>` 抽出的浏览器脚本通过 `node --check`。
- 覆盖：approval-request 携带完整 review；批准后顺序为 approval → tool-result；rollback 成功返回 apply result；postimage 冲突映射 409 且不覆盖外部修改；运行中 rollback 返回 409；review UI 使用 `textContent`/`<pre>` 展示 diff，review request 隐藏 Always allow，批准后提供 Undo。
- 实现：`ChatSession.rollbackChangeSet` 委托同一 filesystem change-set store；Desktop server 增加 guarded rollback route、未知/冲突状态码和 review SSE payload；浏览器端维护 review card、Undo 状态和 session 绑定。
- 提交：待账本同步后提交 `feat(desktop): review diffs and rollback change sets`。

## 错误与卡点

| 时间 | Task | 问题 | 处理 |
|------|------|------|------|
| 2026-09-13 | Task 4 | MCP server 初版仍使用 `denyDangerousPolicy`，测试收到 workspace boundary denial 而不是 review-writes denial | 增加 `review-writes` 专用 policy wiring；MCP 保持无交互安全拒绝，CLI/Desktop 使用真实 review preparation |

## 后续路线

- v33 完成后执行 v34：根据 change set 计算最小验证集合，把 typecheck/test/真实运行时结果反馈给模型和 Desktop。
