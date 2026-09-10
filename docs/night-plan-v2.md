# dev-agent 夜间自动开发计划 v2

> 目标：在一夜之间（约 8 小时）对 `dev-agent` 项目进行高价值、可验证的工程推进。
> 执行者按阶段顺序推进，每个阶段完成后运行对应的验收检查，全部完成后再提交并推送。

当前基线（已验证）：

- 90 TypeScript 测试 + 26 Rust 测试全部通过
- MCP 健壮性（重连退避、通知去重、优雅关闭、结构化错误）已完成
- CLI 硬化（onTurn 回调、系统提示增强、--metadata/--compact、Ctrl-C）已完成
- 代码智能（排名改进、JsonFileCodeIndex、引用搜索）已完成
- Executor（durationMs、command、historyLimit）已完成
- Rust 运行时（Starlark 策略、macOS sandbox-exec）已激活

---

## 阶段 0：Agent Loop 流式输出增强（~1 小时）

**目标**：让 Agent Loop 支持 token 级流式输出和工具调用事件回调。

**任务**：

1. 在 `packages/agent-core/src/loop.ts` 的 `AgentLoopOptions` 中增加：
   - `onToken?: (token: string, context: AgentContext) => void` — 模型流式返回每个 token 时触发
   - `onToolCall?: (call: { name: string; input: unknown }, context: AgentContext) => void` — 工具调用时触发
   - `onToolResult?: (result: { name: string; output: string }, context: AgentContext) => void` — 工具返回时触发
2. 修改 `model.chat()` 调用，传入 `stream: true` 时的回调（ModelProvider 接口已支持 streamChat）。
3. 在 `packages/model/src/types.ts` 中确认 `streamChat` 方法签名包含 `onToken` 回调。
4. 新增 `packages/agent-core/tests/agent-loop-streaming.test.mjs`，验证回调被正确触发。

**验收**：
- `pnpm --filter @dev-agent/agent-core test` 通过
- 新增至少 2 个流式相关测试
- `pnpm --filter @dev-agent/agent-core typecheck` 通过

---

## 阶段 1：工具输出截断与超时控制（~1 小时）

**目标**：防止工具输出撑爆上下文，增加工具级超时。

**任务**：

1. 在 `packages/agent-core/src/tools.ts` 的 `runTool` 调用中增加：
   - `maxOutputChars` 配置（默认 50000），超过时截断并追加 `[truncated]`
   - `timeoutMs` 配置（默认 30000），超时后返回错误信息而非抛出
2. 在 `AgentLoopOptions` 中暴露 `toolDefaults?: { maxOutputChars?: number; timeoutMs?: number }`。
3. 新增 `packages/agent-core/tests/tool-truncation.test.mjs`。
4. 新增 `packages/agent-core/tests/tool-timeout.test.mjs`。

**验收**：
- 新增至少 3 个测试
- 全部 agent-core 测试通过
- 截断逻辑正确（保留尾部 20% 内容并标记）

---

## 阶段 2：CLI 配置文件与彩色输出（~1 小时）

**目标**：让 CLI 支持持久化配置和更好的终端体验。

**任务**：

1. 在 `apps/cli/src/` 中新增 `config.ts`：
   - 读取 `~/.dev-agent/config.json`（如果存在）
   - 支持的配置项：`defaultProvider`、`defaultModel`、`maxTurns`、`mcpServers`
   - 命令行参数优先于配置文件
2. 在 `apps/cli/src/index.ts` 中增加彩色输出（纯 ANSI 转义码，不引入外部依赖）：
   - `[turn N]` 用青色
   - 错误信息用红色
   - 工具调用用黄色
   - 用 `NO_COLOR` 环境变量检测禁用
3. 新增 `apps/cli/tests/config.test.mjs`。
4. 新增 2 个 CLI 测试验证配置文件加载和颜色开关。

**验收**：
- `pnpm --filter @dev-agent/cli test` 通过
- 新增至少 2 个 CLI 测试
- 手动运行 `node apps/cli/dist/index.js --help` 显示彩色输出

---

## 阶段 3：MCP 资源订阅与 Prompt 模板（~1 小时）

**目标**：深化 MCP 集成，支持资源变更通知和 prompt 参数补全。

**任务**：

1. 在 `packages/mcp/src/session.ts` 中增加：
   - `watchResource(uri: string, callback: () => void): () => void` — 订阅资源变更
   - 收到 `resources/updated` 通知时触发回调
2. 在 `packages/mcp/src/types.ts` 中增加 `McpPromptDefinition`，包含参数定义。
3. 在 CLI 的 `registerMcpTools` 中为 prompt 工具生成更丰富的描述（包含参数名）。
4. 新增 `packages/mcp/tests/mcp-resource-watch.test.mjs`。
5. 新增 `packages/mcp/tests/mcp-prompt-integration.test.mjs`。

**验收**：
- 新增至少 3 个 MCP 测试
- 全部 MCP 测试通过
- 资源订阅回调正确触发和取消

---

## 阶段 4：代码智能 — 多语言符号扫描（~1.5 小时）

**目标**：扩展代码索引能力到 Python 和 Rust。

**任务**：

1. 在 `packages/code-intelligence/src/` 中新增 `python-scanner.ts`：
   - 基于正则的轻量级 Python 扫描（def, class, import）
   - 输出统一的 `CodeSymbol` 格式
2. 在 `packages/code-intelligence/src/` 中新增 `rust-scanner.ts`：
   - 基于正则的轻量级 Rust 扫描（fn, struct, enum, impl, mod, use）
   - 输出统一的 `CodeSymbol` 格式
3. 修改 `packages/code-intelligence/src/scanner.ts` 的 `scanFile` 函数，根据文件扩展名分发到对应扫描器。
4. 新增 `packages/code-intelligence/tests/python-scanner.test.mjs`。
5. 新增 `packages/code-intelligence/tests/rust-scanner.test.mjs`。

**验收**：
- 新增至少 4 个测试（每种语言至少 2 个）
- 全部 code-intelligence 测试通过
- 对 dev-agent 自身项目扫描 Rust 文件能输出合理符号

---

## 阶段 5：Executor 配额与安全增强（~1 小时）

**目标**：增加执行器安全边界，防止恶意命令。

**任务**：

1. 在 `packages/executor/src/local-executor.ts` 中增加：
   - `maxOutputBytes` 限制（默认 1MB），超过时终止进程
   - `maxConcurrentExecutions` 限制（默认 5），防止 fork bomb
   - 执行计数统计
2. 在 `ExecutorResult` 中增加 `bytesTruncated?: boolean` 字段。
3. 新增 `packages/executor/tests/executor-quotas.test.mjs`。
4. 新增 2 个测试验证输出截断和并发限制。

**验收**：
- 新增至少 2 个 executor 测试
- 全部 executor 测试通过
- 并发限制正确拒绝超额请求

---

## 阶段 6：端到端集成测试（~45 分钟）

**目标**：验证完整 pipeline 从 CLI 输入到工具执行到内存持久化。

**任务**：

1. 在 `apps/cli/tests/` 中新增 `cli-integration.test.mjs`：
   - 使用 MockProvider 模拟 LLM 返回工具调用 + 最终回答
   - 验证完整交互：输入 → 工具执行 → 回答 → 内存保存
2. 在 `packages/agent-core/tests/` 中新增 `full-pipeline.test.mjs`：
   - 构造 MockProvider + MockExecutor + 真实 Memory
   - 运行 AgentLoop 验证状态转换
3. 确保所有测试不需要真实 LLM API。

**验收**：
- 新增至少 2 个集成测试
- 全部测试通过
- 内存文件正确持久化

---

## 阶段 7：文档、Roadmap 和提交（~45 分钟）

**目标**：整理所有变更，写好文档，提交并推送。

**任务**：

1. 更新根 `README.md` 的 Current Status 和 Roadmap。
2. 更新 `docs/README.md`，加入新完成的模块说明。
3. 更新 `docs/CHANGELOG.md` 记录 v2 变更。
4. 新建 `docs/architecture.md`，描述 Agent Loop 架构、工具执行流程、MCP 集成方式。
5. 最终运行全部检查：
   - `node scripts/check.mjs`
   - `pnpm -r typecheck`
   - `pnpm -r test`
   - `node scripts/test-with-sandbox.mjs`
   - `cargo test`
6. 提交所有变更到 git，推送到 `https://github.com/LJH-snow/dev-agent`。

**验收**：
- 所有测试通过
- 所有文档与代码一致
- 变更已推送到 GitHub

---

## 执行约束

- 不引入新的外部框架或依赖（除非阶段明确需要）。
- 保持现有代码风格和模式。
- 每个阶段结束后必须运行对应的验收检查，不通过则修复后再继续。
- `sandbox-exec` 相关测试需要提升权限，使用 `sandbox_permissions: "require_escalated"`。
- `apps/desktop` 保持占位符状态，不实现桌面端。
- Starlark 作为 Rust 沙箱的 policy 语言保持不变。
- ANSI 彩色输出使用纯转义码，不引入 chalk 等依赖。

## 优先级

阶段 0 > 阶段 1 > 阶段 5 > 阶段 4 > 阶段 3 > 阶段 2 > 阶段 6 > 阶段 7

先增强核心 Agent Loop（流式、截断、配额），再做代码智能和 MCP 深化，最后做 CLI 体验和集成测试，收尾文档和提交。

## 预计产出

- 新增约 20+ 个测试
- Agent Loop 支持流式 token 输出和工具事件回调
- 工具输出截断和超时保护
- CLI 配置文件和彩色输出
- MCP 资源订阅
- Python/Rust 符号扫描器
- Executor 输出和并发配额
- 2 个端到端集成测试
- 完整文档更新
