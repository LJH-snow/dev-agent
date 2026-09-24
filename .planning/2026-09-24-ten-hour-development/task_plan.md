# 10 小时开发任务计划：CLI / Desktop 终端与项目工作台

> 建立日期：2026-09-24（Asia/Shanghai）
> 目标：在不破坏现有 AgentLoop、审批、沙箱、MCP、会话隔离与证据脱敏边界的前提下，继续把 dev-agent 做成可维护、可验证的 CLI/Desktop 工作台。
> 状态：执行中；本文件是本轮的执行计划，验证结论以 `progress.md` 和测试输出为准。

## 目标与交付标准

1. CLI 退出后保留终端 scrollback；在长 transcript 中支持 PageUp/PageDown、Home/End 和鼠标滚轮，并且 follow-output 行为可预测。
2. Desktop 任务终端支持当前页面/会话内的有界命令历史、上下键召回、草稿恢复，以及手动上滚时不被新输出强制拉回底部。
3. Desktop 会话切换、reload、rename/delete、终端重连和清理不使用陈旧 session id，不静默丢失状态。
4. 可选 Anthropic/Claude Agent SDK adapter 继续保持可选，不绕过默认 AgentLoop、工具注册表、审批和沙箱边界。
5. 完成 focused tests、build/typecheck、PTY/浏览器验收和 GitHub 推送；不提交 `.playwright-cli/`、`output/` 等临时产物。

## 10 小时排程

| 时间 | 时长 | 阶段 | 交付物 / 验收 |
|---|---:|---|---|
| 12:45–13:15 | 0.5h | 基线与拆解 | 记录分支、远程、脏文件和测试基线，建立本计划、进度和 findings。 |
| 13:15–14:45 | 1.5h | CLI viewport / scrollback | viewport 模型、滚轮、PageUp/PageDown、Home/End 与退出 scrollback 的回归测试。 |
| 14:45–16:15 | 1.5h | Desktop 命令历史 | 页面内有界去重历史、↑/↓ 导航、草稿恢复、session 切换清空；不落盘原始命令。 |
| 16:15–17:15 | 1.0h | Desktop 输出滚动 | 手动上滚保持位置，新输出只更新内容；提供明确 Follow latest 控件。 |
| 17:15–18:45 | 1.5h | 会话 / 终端恢复 | reload、rename/delete、重连和清理的 stale-id、进程组和 bounded-output 回归。 |
| 18:45–19:45 | 1.0h | Anthropic adapter 维护 | 审计取消、错误分类、资源清理和包边界，只修复可复现问题。 |
| 19:45–20:45 | 1.0h | 安全与可访问性 | 审查 token、loopback、textContent、敏感信息、键盘操作和状态文案。 |
| 20:45–21:45 | 1.0h | 运行时验收 | CLI PTY、Desktop 浏览器/临时 fixture、focused tests。 |
| 21:45–22:30 | 0.75h | 全量门禁与文档 | build/typecheck、全量测试、diff check，更新进度与发布说明。 |
| 22:30–22:45 | 0.25h | 提交与 GitHub | 只提交审查后的源代码、测试和本轮计划文档，推送当前分支。 |

## 阶段状态

- [x] Phase 0：基线、计划和安全边界。
- [x] Phase 1：CLI viewport / scrollback hardening。
- [x] Phase 2：Desktop 有界命令历史。
- [x] Phase 3：Desktop 手动输出滚动与 Follow latest。
- [x] Phase 4：会话恢复、终端清理和 Changes Center 维护。
- [x] Phase 5：可选 Anthropic adapter 边界审计（adapter 保持可选）。
- [ ] Phase 6：最终 PTY/浏览器证据、完整门禁、提交和推送后的审计。

## 不可违反的边界

- 默认 AgentLoop/provider 路径保持不变；Claude Agent SDK 只能作为显式可选 adapter。
- 缺失/错误的 approval、capability token、loopback/origin 校验必须 fail closed。
- 不新增 unrestricted shell、任意网络、凭据读取、GitHub 远程 mutation 或插件越权。
- 命令历史只保留在当前页面内，输出和输入均有界，不写入 session 文件或浏览器持久化存储。
- 终端输出继续使用安全文本渲染；导出、历史、trace 和 metadata 不包含 prompt、路径、URL、凭据或 raw error。
- 不执行 `git reset`、`git clean`、`git checkout` 或 broad restore/stash；保留已有未跟踪验收产物。
