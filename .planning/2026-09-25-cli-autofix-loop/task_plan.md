# CLI 自动验证与自修复闭环

## 目标
在现有 trusted validation 和交互式 CLI 基础上，增加 `:autofix [次数]`：读取最近一次 failed/blocked 验证，生成脱敏失败摘要，驱动 Agent 只修复对应问题，并在每轮后复用受信任验证。最多 3 轮，支持取消、失败和无可修复结果的明确状态。

## 阶段
- [x] 设计并实现纯函数解析、摘要和闭环协调器
- [x] 接入 readline 与 Ink 两条交互路径及帮助提示
- [x] 补 focused unit/integration tests
- [x] 更新 CLI 文档和规划记录
- [x] 构建、CLI focused tests、全量回归

## 约束
- 保留工作区已有未提交 Settings/Desktop 改动；不 reset/clean。
- 不记录原始工具输出、密钥、完整 prompt 或绝对路径。
- 远程 GitHub 工作流暂不在本阶段实现。

## 本次执行基线（2026-09-29）

- 当前分支与 `origin/codex/desktop-cli-workbench` 同步；产品源代码没有未提交改动，只有规划记录和本地工具产物需要保留。
- 沿用现有 `ValidationAdapter`、session evidence、`:validate`、`runPrompt` 和 Ink `runInkPrompt` 边界，不复制一套验证或 AgentLoop。
- `:autofix` 必须只使用最近一次 failed/blocked 的可信验证摘要；每轮 Agent 修改后重新验证，最多 3 轮，并在取消、验证失败、无可修复结果时终止且给出明确状态。

## 当前执行切片

- [x] 盘点 validation 结果、change-set guard、readline/Ink 命令分发和取消生命周期。现有实现已覆盖两条交互路径；待补的是安全边界与回归证据。
- [x] 实现共享的脱敏摘要与最多三轮协调器。
- [x] 接入 readline、Ink、帮助提示和文档。
- [x] 添加 focused unit/integration 回归并运行 CLI proportional verification。

## 完成验证（2026-09-29）

- CLI 构建与测试 TypeScript 编译通过。
- node --test --test-concurrency=1 tests-dist/auto-fix-command.test.js：11/11 通过。
- pnpm --filter @agent_cli/cli run test：767/767 通过。
- git diff --check：通过。

## Errors Encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Planning skill catalog alias was not a literal filesystem path | 1 | Resolved the skill root to `/Users/Admin/Library/Application Support/CindyGlobal/codex-home/skills/xdt-agents/`. |
| First patch orchestration used invalid JavaScript syntax | 1 | Reissued the same scoped patch through the valid `apply_patch` wrapper. |
| Focused test compile rejected `onValidation: (next) => validations.push(next)` | 1 | Change the callback to an explicit `void` block so it matches the existing callback contract. |
