# dev-agent 开发计划 v6（2026-09-11 12:54 → 19:00）

> 目标：补上项目目前完全缺失的一层——**命令审批**。现在模型让执行什么就执行什么，
> 沙箱只决定"怎么跑"（隔离、配额、网络），不决定"该不该跑"。本计划加一条可配置的
> 审批策略线：先做核心策略与 CLI，再做到桌面端，最后收掉摘要持久化、MCP resources
> 与运行时并发这几个遗留项。

当前基线（v5 完成时已验证）：

- TypeScript 270 个测试 + Rust 43 个测试全部通过
- 真实 Rust 二进制集成用例 9 个通过
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿
- 工作区干净，`main` 与 origin 同步

时间窗：约 6 小时 6 分钟。执行协议见文末。

---

## 阶段 0：上下文摘要跨 run 复用与长度上限（~1.5 小时）

**问题**：v5 的摘要在 `AgentLoop` 实例上，桌面端每次 `session.run` 都会重建 loop，
于是每个新回合都要重新生成一次摘要；摘要也没有长度上限，长会话下会越滚越长。

**任务**：

1. `AgentMemory` 增加可选能力：`getSummary?()` / `setSummary?()`，返回
   `{ lastEntryId, entriesCovered, text }`。
2. `FileMemory` 把它写进 memory 文件的 `summary` 字段（版本仍为 1，字段可选，
   旧文件可读）；`InMemoryMemory` 同样支持（进程内）。
3. 失效规则：加载缓存摘要时，如果 `lastEntryId` 与当前 memory 的第
   `entriesCovered` 条对不上（例如 `--compact` 截断过历史），丢弃缓存重新生成。
4. `contextBudget.summaryMaxChars`（默认 2000）：摘要超过上限时保留最近部分并以
   `…` 标记截断；生成摘要的提示词里也带上这个上限。
5. 运行开始时从 memory 载入摘要，摘要更新后写回。

**验收**：

- agent-core 新增 >= 4 个用例：跨 run 复用（第二次 run 不再调用摘要）、
  compact 后缓存失效、超长摘要被截断、非法/缺失缓存的回退
- `FileMemory` 一条持久化用例（重启进程后摘要仍在，用文件内容断言）
- `pnpm test` 全绿；未配置预算时行为不变

---

## 阶段 1：命令审批策略核心（~2 小时）

**任务**：

1. agent-core：`AgentLoopOptions.approval?: ApprovalPolicy`，接口为
   `decide(request: ApprovalRequest): Promise<"allow" | "deny"> | "allow" | "deny"`；
   `ApprovalRequest` 含 `{ toolName, input, reason? }`。
2. 内置策略（放在 agent-core，便于 CLI 与桌面端复用）：
   - `allowAllPolicy()`：默认，行为与现在一致
   - `denyDangerousPolicy({ patterns? })`：内置危险模式表（`rm -rf`、`sudo`、
     `mkfs`、`dd if=`、`shutdown`/`reboot`、`git push --force`、`curl … | sh`、
     `chmod -R 777`、fork bomb 等），并支持追加自定义正则
3. 循环行为：每个工具调用前询问策略；`deny` 时不执行命令，而是把
   `[denied by policy] <reason>` 作为该工具的 tool 结果写回记忆，让模型自己改道，
   **不中断整轮对话**。
4. `onApproval?: (request, decision, context)` 回调，供 CLI/桌面端展示。
5. 只对能落到命令的工具做模式匹配（shell / git / search），其余工具一律 allow。

**验收**：

- agent-core 新增 >= 6 个用例：无策略时不触发；危险命令被拒且模型收到 tool 结果；
  安全命令放行；自定义 pattern 生效；`reason` 出现在 tool 结果里；审批抛错时按
  拒绝处理而不是崩溃
- `pnpm test` 全绿

---

## 阶段 2：CLI 审批交互（~1.5 小时）

**任务**：

1. `--approval allow|deny-dangerous|ask`（默认 `allow`，保持现状）；配置文件
   `approvalMode`；环境变量 `DEV_AGENT_APPROVAL` 优先。
2. `ask` 模式：命中的危险命令用 readline 询问 `y/N`；非 TTY、读取失败或回答不是 y
   一律按拒绝处理（保守默认）。
3. CLI 输出：被拒时打印 `[denied] <工具名> <原因>`；`--no-stream` 与流式模式都要有。
4. `--approval` 在 `--once` 与交互模式下都生效。

**验收**：

- CLI 新增 >= 3 个用例：`deny-dangerous` 端到端（stub provider 发出 `rm -rf /`
  工具调用 → 该命令没有执行、请求里出现 denied 的 tool 结果、进程正常结束）；
  `ask` 输入 `n` 拒绝；`ask` 输入 `y` 放行
- 配置解析优先级（env > 文件 > 默认）用例
- `pnpm test` 全绿

---

## 阶段 3：桌面端审批（~1.5 小时）

**任务**：

1. `DEV_AGENT_APPROVAL` 支持 `deny-dangerous`（本阶段不做交互式按钮）。
2. `ChatSession` 接入策略，SSE 新增 `approval` 事件：`{ tool, decision, reason }`；
   被拒时同样把 tool 结果写回记忆。
3. UI：在工具消息旁显示 `denied` 徽标（沿用现有 `.msg.tool` 样式，不引入新视觉语言）。
4. `apps/desktop/README.md` 写清边界：交互式审批尚未实现，需要人工确认请用 CLI。

**验收**：

- desktop 新增 >= 2 个用例：`deny-dangerous` 时危险命令被拒且 SSE 出现 `approval`
  事件；安全命令不受影响
- `pnpm test` 全绿

---

## 阶段 4：MCP server 的 resources 与 prompts（~1.5 小时）

**任务**：

1. `createMcpServer` 增加 `resources/list` + `resources/read`，暴露两个只读资源：
   - `dev-agent://session`：session id、工作目录、累计 usage、记忆条数
   - `dev-agent://workspace`：工作目录路径与顶层条目清单
2. 增加 `prompts/list` + `prompts/get`，内置两个模板（`review-changes`、
   `explain-codebase`），返回 text 消息；未知 uri/name 返回 -32602。
3. capabilities 相应声明 `resources` 与 `prompts`。

**验收**：

- mcp 新增 >= 5 个用例：capabilities 声明、resources/list、resources/read 内容、
  prompts/list、prompts/get、未知 uri/name 报错
- CLI 端到端用例扩展：宿主脚本能读到 `dev-agent://session`
- `pnpm test` 全绿

---

## 阶段 5：文档、全量回归与提交（~1 小时）

1. 更新根 `README.md`（Current Status / Roadmap）
2. 更新 `docs/architecture.md`（审批策略、摘要持久化、MCP resources/prompts）
3. 更新 `docs/CHANGELOG.md`
4. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
5. 提交并推送

---

## Backlog（阶段 0-5 都在 19:00 前完成时，按顺序继续）

1. **Rust 运行时并发上限**（~1 小时）：给执行器二进制加在飞请求上限，
   超出返回 `CONCURRENCY_LIMIT`，不再只靠 TS 侧计数。
2. **CLI `--json` 输出**（~1 小时）：`--json` 让 `--once`、`--tools`、`--metadata`、
   `--session-list` 输出机器可读 JSON，便于脚本化。
3. **桌面端多会话**（~2 小时）：`GET /api/sessions` + 会话选择，避免一个桌面实例
   只能用一个会话。

---

## 执行协议

每一轮开始时：

1. 读本文件与 `docs/day-plan-v6-progress.md`，恢复上下文；
2. `git status` 确认工作区；有未提交改动先按性质提交；
3. 取下一个未完成阶段，端到端做完（实现 + 测试 + 该阶段验收命令）；
4. 把结果追加到进度账本：做了什么、跑了哪些命令、结果、下一步；
5. 阶段通过验收后按仓库约定提交并推送，再进入下一阶段。

约束与节奏：

- 单轮连续工作控制在 45 分钟左右；接近时长就先落盘进度、结束本轮。
- 用户不在场时不要提问：不确定的取舍按"保守、可回退、不引入新依赖"决定并记录。
- 未开启新选项时，所有既有行为必须保持不变。
- 同一个工作项连续三次尝试仍无法推进：写进账本的"错误与卡点"，跳过它继续下一个
  独立阶段。
- **到 19:00 停止**：即使还有阶段未完成，也要把当前状态写进账本并给出总结。
  如果阶段 0-5 与 backlog 都已完成，直接总结收尾，不要自行扩大范围。

## 优先级

阶段 0 > 阶段 1 > 阶段 2 > 阶段 3 > 阶段 4 > 阶段 5 > Backlog

先补摘要持久化（小且独立），再做本计划的核心——审批策略与 CLI，然后是桌面端与
MCP 扩展，最后统一收尾。
