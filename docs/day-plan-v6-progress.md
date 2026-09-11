# day-plan v6 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v6.md`；结束前追加日志。
> 时间窗：2026-09-11 12:54 → 19:00。

## 当前状态

- 当前阶段：阶段 5（文档、全量回归与提交）未开始
- 已完成阶段：阶段 0、阶段 1、阶段 2、阶段 3、阶段 4
- 最近一次运行：运行 5（2026-09-11 15:15-15:45）
- 工作区：阶段 4 的改动已提交并推送

## 日志

### 运行 5 — 2026-09-11 15:15-15:45

- 阶段/工作项：阶段 4（MCP server 的 resources 与 prompts）全部完成
- 做了什么：
  - `createMcpServer` 增加 `resources` / `prompts` 注入点与四个方法：
    `resources/list`、`resources/read`、`prompts/list`、`prompts/get`；
    initialize 的 capabilities 相应声明 resources 与 prompts；
    未知 uri/name 返回 -32602
  - CLI `--mcp-server` 暴露两个只读资源：
    - `dev-agent://session`：session id、工作目录、记忆条数、创建/最近活跃时间
    - `dev-agent://workspace`：工作目录路径与顶层条目清单（dir/file 前缀）
  - 两个提示词模板：`review-changes`（审查未提交改动）与 `explain-codebase`
    （支持可选 `focus` 参数）
  - 文档：`packages/mcp/README.md`、`apps/cli/README.md`
- 验证命令与结果：
  - `packages/mcp`：32 passed（新增 6 个：capabilities 声明、resources/list、
    resources/read、未知资源报错、prompts/list、prompts/get 带参数与未知提示词报错）
  - `apps/cli`：宿主脚本端到端扩展为 tools + resources + prompts 全链路，
    读取 `dev-agent://session` 与渲染 `explain-codebase(focus=the executor)` 均通过
  - `pnpm build`、`pnpm typecheck`、`pnpm test`：全绿（TypeScript 297 个测试）
- 提交：见阶段 4 的 feat 提交
- 下一步：阶段 5 — 文档、全量回归与提交（收尾）

### 运行 4 — 2026-09-11 14:45-15:15

- 阶段/工作项：阶段 3（桌面端审批）全部完成
- 做了什么：
  - `ChatSessionOptions.approvalMode`（`allow` / `deny-dangerous` / `ask`），
    未传时读 `DEV_AGENT_APPROVAL`，默认 `allow`
  - 边界处理：Web UI 还没有审批交互，`ask` 按 `deny-dangerous` 处理并写进文档，
    避免"配了 ask 却静默执行"的误解
  - SSE 新增 `approval` 事件：`{ tool, decision, reason }`；被拒时 agent-core
    已把 `[denied by policy]` 写回 tool 结果，模型可以改道
  - UI：新增 `.msg.denied` 样式与 `approval` 事件分支，被拒时在会话里显示
    `[denied] <工具>: <原因>`
  - 文档：`apps/desktop/README.md` 增加 `DEV_AGENT_APPROVAL` 与 `approval` 事件说明
- 验证命令与结果：
  - `apps/desktop`：24 passed（新增 2 个：`deny-dangerous` 拦截 `chmod 777`、
    SSE 出现 `approval` 且文件权限未变、模型看到拒绝；默认模式下同一条命令照常执行）
  - `pnpm build`、`pnpm typecheck`、`pnpm test`：全绿（TypeScript 291 个测试）
- 提交：见阶段 3 的 feat 提交
- 下一步：阶段 4 — MCP server 的 resources 与 prompts

### 运行 3 — 2026-09-11 14:05-14:45

- 阶段/工作项：阶段 2（CLI 审批交互）全部完成
- 做了什么：
  - 配置：`ApprovalMode = allow | deny-dangerous | ask`、`parseApprovalMode()`、
    `resolveApprovalMode()`（env `DEV_AGENT_APPROVAL` > 配置文件 `approvalMode` > allow，
    非法值一律回落 allow）
  - CLI 新增 `--approval <mode>`：flag > env > 文件；非法值直接报错退出
  - `allow` 不安装策略（零开销，行为与之前完全一致）；`deny-dangerous` 直接用内置策略；
    `ask` 先用内置策略判定，命中后询问 `y/N` —— 交互模式下复用同一个 readline
    接口，非交互（如 `--once`）从 stdin 读一行；回答不是 y、EOF 或读取失败都按拒绝
  - 被拒时打印 `[denied] <工具名> <原因>`，并把 `[denied by policy]` 写回 tool 结果
  - 文档：`apps/cli/README.md` 增加 `--approval`、`DEV_AGENT_APPROVAL`、`approvalMode`
- 验证命令与结果：
  - `apps/cli`：47 passed（新增 5 个：模式解析优先级 2 个 + 端到端 3 个——
    `deny-dangerous` 拦截 `chmod 777` 且模型看到拒绝、`ask` 回答 n 不执行、
    `ask` 回答 y 真的执行）
  - `pnpm test`：全绿（TypeScript 289 个测试）
- 踩坑记录：`--once` 模式下审批读取 stdin 后若父进程不关闭 stdin，CLI 进程不退出，
  测试会挂住；修法是读取端在拿到一行后 `pause()`，测试端写完输入即 `end()`。
  同时去掉了 `process.stdin.readable` 的前置判断，避免 EOF 后缓冲数据被忽略。
- 提交：见阶段 2 的 feat 提交
- 下一步：阶段 3 — 桌面端审批（`DEV_AGENT_APPROVAL` + `approval` SSE 事件 + UI 徽标）

### 运行 2 — 2026-09-11 13:35-14:05

- 阶段/工作项：阶段 1（命令审批策略核心）全部完成
- 做了什么：
  - 新增 `packages/agent-core/src/approval.ts`：`ApprovalPolicy` /
    `ApprovalRequest { toolName, input, sessionId, workingDirectory }` /
    `ApprovalOutcome { decision, reason? }`
  - 内置策略：`allowAllPolicy()`（默认、保持现状）与 `denyDangerousPolicy()`
    - 内置危险模式表：递归删除、sudo、mkfs、dd of=、关机/重启、`git push --force`、
      `curl|wget | sh`、`chmod 777`、fork bomb、`git reset --hard`/`git clean -f`、
      特权容器；支持追加自定义正则（并处理 /g 状态的 lastIndex）
    - 额外规则：filesystem 的 write/mkdir 目标落在工作目录之外时拒绝
  - `AgentLoop`：新增 `approval` 与 `onApproval`；每个工具调用前询问策略，
    拒绝时不执行命令，而是把 `[denied by policy] <原因>` 写回 tool 结果让模型改道，
    整轮对话继续；策略抛错按拒绝处理；未配置策略时不触发任何回调
- 验证命令与结果：
  - `packages/agent-core`：46 passed（新增 8 个：危险命令被拒且模型看到原因、
    安全命令放行、allowAll 保持旧行为、自定义 pattern、策略抛错按拒绝、
    工作目录外写入被拒/目录内放行、模式表正反例、未配策略不触发回调）
  - `pnpm build`、`pnpm typecheck`、`pnpm test`：全绿（TypeScript 284 个测试）
- 提交：见阶段 1 的 feat 提交
- 下一步：阶段 2 — CLI 审批交互（`--approval allow|deny-dangerous|ask`）

### 运行 1 — 2026-09-11 12:54-13:35

- 阶段/工作项：阶段 0（摘要跨 run 复用与长度上限）全部完成
- 做了什么：
  - `AgentMemory` 增加可选 `getSummary?()` / `setSummary?()`；新增 `ContextSummary`
    `{ lastEntryId, entriesCovered, text }`
  - `InMemoryMemory` 在进程内保留摘要；`FileMemory` 写进 memory 文件的 `summary`
    字段（版本仍为 1、字段可选，旧文件可读），`clear()` 一并清掉摘要，
    `compact()` 保留摘要
  - 锚点重定位：加载缓存时按 `lastEntryId` 在当前条目里找位置；找到就把覆盖数
    重算成 `index + 1`，找不到（历史被 compact 掉）就保留摘要文本、覆盖数归零，
    只对之后新裁掉的条目继续增量总结
  - `contextBudget.summaryMaxChars`（默认 2000）：提示词里带上限，超长摘要保留
    最新部分并以 `…` 标记；非法值回落到默认
  - CLI：`DEV_AGENT_SUMMARY_MAX_CHARS` / `summaryMaxChars`；桌面端同名环境变量 +
    `ChatSessionOptions.summaryMaxChars`
  - 文档：agent-core / cli / desktop 三个 README 同步
- 验证命令与结果：
  - `packages/agent-core`：38 passed（新增 5 个：跨 run 复用且只总结新增部分、
    compact 后重锚、超长截断、非法上限回落、摘要写进 memory 文件并可被新实例读回）
  - `apps/cli`：42 passed（新增 `resolveSummaryMaxChars` 优先级/非法值用例）
  - `node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`：全绿
    （TypeScript 274 个测试）
- 提交：见阶段 0 的 feat 提交
- 下一步：阶段 1 — 命令审批策略核心（agent-core 审批钩子 + 内置危险命令策略）

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | -    |
