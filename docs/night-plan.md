# dev-agent 夜间自动开发计划

> 目标：在一夜之间（约 8 小时）对 `dev-agent` 项目进行高价值、可验证的工程推进。
> 执行者按阶段顺序推进，每个阶段完成后运行对应的验收检查，全部完成后再提交并推送。

当前基线（已验证）：

- 结构检查 `node scripts/check.mjs`：通过
- TypeScript 类型检查 `pnpm -r typecheck`：全部 package 通过
- 单元测试：model(4) / code-intelligence(11) / mcp / agent-core / tools 全部通过
- 真实 Rust 二进制沙箱集成测试：提升权限后 7/7 通过（`sandbox-exec` 需要提升权限）
- Rust `cargo test`：26 通过

---

## 阶段 0：测试基础设施修复（~30 分钟）

**问题**：`packages/executor` 的 `real-rust-integration.test.mjs` 需要 `sandbox-exec`，在普通沙箱内 `pnpm -r test` 会失败。

**任务**：

1. 修改 `packages/executor/package.json` 的 `test` 脚本，拆分为：
   - `test`：运行不含真实二进制集成测试的常规测试
   - `test:integration`：运行真实二进制集成测试（需要提升权限）
   - `test:all`：先运行常规测试，再尝试运行集成测试
2. 让 `pnpm -r test` 在不需要提升权限的情况下也能全部通过。
3. 添加一个 `scripts/test-with-sandbox.mjs` 包装脚本，用提升权限运行完整测试（含集成测试）。

**验收**：

- `pnpm -r test` 全部通过（不依赖提升权限）
- `node scripts/test-with-sandbox.mjs` 在提升权限下运行全部测试通过
- 新增至少 2 个测试覆盖 `LocalExecutor` 的边界场景（空命令、不存在的命令）

---

## 阶段 1：MCP 健壮性增强（~1.5 小时）

**目标**：让 MCP 客户端/会话在生产环境中更稳定。

**任务**：

1. **重连退避**：在 `packages/mcp/src/session.ts` 的 `reconnect()` 中加入指数退避（最多重试 3 次，间隔 1s/2s/4s）。
2. **重连测试**：在 `packages/mcp/tests/` 中新增 `mcp-reconnect.test.mjs`，模拟服务器断开后重连并验证工具重新注册。
3. **通知去重**：`McpStdioClient` 中对 `tools/list_changed` 通知增加防抖（500ms 内多次触发只重新加载一次）。
4. **优雅关闭**：确保 `close()` 在服务器已经退出时不会抛错。
5. **错误传播**：`callTool` 返回结构化错误时，TS 侧抛出包含服务器错误码的异常。

**验收**：

- 新增至少 4 个 MCP 测试
- 全部 MCP 测试通过
- `pnpm --filter @dev-agent/mcp typecheck` 通过

---

## 阶段 2：CLI 硬化和流式输出（~1.5 小时）

**目标**：让 `apps/cli` 更接近可用状态。

**任务**：

1. **流式输出**：修改 `AgentLoop.run` 支持可选的 `onTurn` 回调，CLI 收到回调时实时打印 `[turn N]` 进度。
2. **会话持久化增强**：`FileMemory` 已有基础实现，增加：
   - `--compact` 命令：将旧条目压缩为摘要，保留最近 N 轮
   - 会话元数据（创建时间、最后活跃时间）保存在 JSON 顶部
3. **系统提示增强**：在系统提示中注入当前 OS、Node 版本、可用工具列表数量。
4. **Ctrl-C 处理**：正确中断正在运行的 agent 循环，保存已生成的部分会话。
5. **E2E 测试**：新增 `apps/cli/tests/cli-e2e.test.mjs`（使用 mock provider 验证完整交互流程）。

**验收**：

- `pnpm --filter @dev-agent/cli test` 通过
- 新增至少 3 个 CLI 测试
- 手动运行 `node apps/cli/dist/index.js --once "hello"` 不报错（无 provider 时优雅退出）

---

## 阶段 3：代码智能增强（~1.5 小时）

**目标**：让代码索引和搜索更有用。

**任务**：

1. **跨文件符号排名改进**：在 `InMemoryCodeIndex.scoreSymbol` 中增加：
   - 文件路径深度惩罚（越深分数越低）
   - 测试文件降权（`*.test.ts` / `*.spec.ts` 分数 ×0.5）
   - 精确大小写匹配加分
2. **持久化索引**：新增 `JsonFileCodeIndex`，将索引保存到 `.dev-agent/index.json`，支持增量更新。
3. **索引 CLI 命令**：在 `apps/cli` 中新增 `--index <path>` 命令，扫描目录并输出索引统计。
4. **引用搜索性能**：`TypeScriptReferenceIndex` 对大文件（>1000 行）增加缓存，避免重复解析。

**验收**：

- 新增至少 4 个 code-intelligence 测试
- `pnpm --filter @dev-agent/code-intelligence test` 通过
- 对 dev-agent 自身项目运行索引命令，输出合理结果

---

## 阶段 4：Executor 和 Rust 运行时增强（~1.5 小时）

**目标**：增强执行器能力，为 Linux 沙箱做准备。

**任务**：

1. **执行结果增强**：`ExecutorResult` 增加 `durationMs` 和 `command` 字段，方便 CLI 展示。
2. **执行历史**：`LocalExecutor` 增加可选的 `history` 选项，记录最近 N 次执行。
3. **Linux 沙箱占位**：在 `runtime/rust/src/restricted_executor.rs` 中完善非 macOS 分支，返回更详细的错误信息（区分 bubblewrap 不可用 vs 平台不支持）。
4. **Rust 测试扩展**：为 `RestrictedExecutor` 增加非 macOS 平台的编译期测试。

**验收**：

- `pnpm --filter @dev-agent/executor test` 通过
- Rust 测试保持全部通过
- 新增至少 2 个 executor 测试

---

## 阶段 5：文档、Roadmap 和提交（~30 分钟）

**目标**：整理所有变更，写好文档，提交并推送。

**任务**：

1. 更新根 `README.md` 的 Current Status 和 Roadmap，反映今夜完成的工作。
2. 更新 `docs/README.md`，加入架构概述和模块职责说明。
3. 更新 `runtime/rust/README.md`，说明 Linux 后端的状态。
4. 在 `docs/CHANGELOG.md` 记录本次变更。
5. 最终运行 `node scripts/check.mjs`、`pnpm -r typecheck`、`pnpm -r test`、`node scripts/test-with-sandbox.mjs`、`cargo test`。
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
- 不随意修改 `pnpm-workspace.yaml` 的 package 结构。

## 优先级

阶段 0 > 阶段 1 > 阶段 4 > 阶段 2 > 阶段 3 > 阶段 5

先修复测试基础设施（否则后续阶段无法可靠验证），再做 MCP 和 Executor（核心能力），最后做 CLI 和代码智能（体验增强），收尾文档和提交。
