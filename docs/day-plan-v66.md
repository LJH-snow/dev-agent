# v66：10 小时开发任务——CLI / Desktop 终端历史与工作台可靠性

> 建立时间：2026-09-24 12:45（Asia/Shanghai）
> 预计工作窗口：10 小时（12:45–22:45）
> 状态：进行中
> canonical execution ledger：`.planning/2026-09-24-ten-hour-dev-sprint/`；本文件是面向项目维护的 10 小时排程总览。

## 目标

在不削弱现有审批、沙箱、MCP、会话隔离、证据脱敏和发布边界的前提下，继续完成
`dev-agent` 项目的一轮可验证开发：一方面解决终端历史/滚动体验，另一方面为 Desktop
执行面补上服务器级 capability token 和生命周期边界，并把已经完成的 Anthropic SDK、
CLI 和 Desktop 工作台能力整理到可持续维护的状态。

本计划是开发排程文档，不会把未验证的功能宣称为已完成；每个阶段都必须有代码、测试
或运行时证据。所有新增状态都保持有界，默认不持久化可能包含秘密的原始终端输入或输出。

## 当前基线

- 当前分支：`codex/desktop-cli-workbench`
- 本轮推送前基线：`737b5ed feat: harden terminal history and desktop capabilities`
- 已推送 terminal hardening commit：`95c1d91 feat: harden desktop terminal lifecycle`
- 已推送 read-only project capability commit：`a52680f feat: expose read-only project capabilities`
- 已推送 metadata-only observability commit：`7d2331a feat: add metadata-only capability observability`
- 已推送 browser acceptance lifecycle fix：`e148abb fix: deduplicate desktop lifecycle trace events`
- 远程分支已同步：`origin/codex/desktop-cli-workbench`
- 已有验证：Desktop 222/222、CLI 629/629、Claude Agent SDK adapter 13/13、文档 60/60、
  native Desktop 2/2、TypeScript build/typecheck、CLI package smoke。
- 本轮新增 evidence：CLI 630/630、agent-core 212/212、Desktop 232/232；workspace
  build/typecheck、TypeScript release gate、CLI package smoke、
  preview/documentation/native contracts 和 `git diff --check` 均已通过；terminal
  hardening focused Desktop suite 为 **227/227**，read-only capability slice 后为
  **230/230**，metadata-only observability 后最终为 **232/232**。Desktop
  build/typecheck 也已通过。
- 当前仅有本地未跟踪验收产物：`.playwright-cli/`、`output/`；不纳入本轮提交，除非明确需要。

## 10 小时排程

| 时间段 | 时长 | 阶段 | 可交付物与验收 |
|---|---:|---|---|
| 12:45–13:15 | 0.5h | 基线与拆解 | 更新本计划、建立 findings/progress，确认干净的 tracked 状态和现有测试基线 |
| 13:15–14:45 | 1.5h | CLI 滚动/历史体验 | 检查 Ink viewport、鼠标滚轮、PageUp/PageDown、Home/End、退出时 scrollback；补 RED-to-GREEN 测试 |
| 14:45–16:15 | 1.5h | Desktop 终端命令历史 | 为 task terminal 增加会话内有界命令历史、键盘上下导航和可访问状态；不落盘秘密 |
| 16:15–17:15 | 1.0h | Desktop 输出滚动语义 | 保证用户手动上滚时新输出不强制跳到底部，提供回到底部的明确操作和测试 |
| 17:15–18:45 | 1.5h | Desktop capability 边界 | 为生产启动路径注入 server-scoped token，保护 terminal/workspace mutation，补 missing/wrong/valid tests |
| 18:45–19:45 | 1.0h | CLI/桌面会话恢复 | 检查 reload、任务切换、终端重连和 history view 的边界；修复可复现的状态竞态 |
| 19:45–20:45 | 1.0h | Anthropic 适配器维护 | 复核可选 SDK adapter 的取消、清理、错误分类和包边界；只做证据驱动的修复 |
| 20:45–21:15 | 0.5h | 可访问性与安全审计 | 审计新增按钮/状态/文本插入、敏感输出脱敏、loopback 和权限边界 |
| 21:15–22:00 | 0.75h | 测试与运行时验收 | 运行 focused tests、真实 PTY、Desktop 浏览器验收；记录截图/日志路径但不提交临时产物 |
| 22:00–22:30 | 0.5h | 全量门禁与文档 | typecheck、build、workspace tests、release gate、diff check，更新 CHANGELOG/计划进度 |
| 22:30–22:45 | 0.25h | 提交与 GitHub 同步 | 复核 diff，提交代码和文档，推送当前分支；不执行 release、npm publish 或 GitHub Release |

## 执行边界

### 必须保持

- CLI 默认 AgentLoop/provider 路径不变；Claude Agent SDK 继续是可选适配器。
- 不新增 unrestricted shell、任意网络、凭据读取、远程 mutation 或 MCP 资源越权。
- 终端输入历史只保留在当前页面/进程内，并设置条目数、字符数和去重边界；不写入 session 文件。
- 输出继续使用 `textContent`/安全文本渲染；导出继续有大小上限并脱敏。
- 任何 cursor gap、session 切换、reload、终端退出都必须有确定状态，不静默丢失历史。
- 不使用 `git reset`、`git clean`、`git checkout` 或 broad restore/stash。

### 明确不做

- 不把本地 loopback preview 扩展为公网访问。
- 不实现 Windows restricted execution；当前 `unsupported` / `NO-GO` 决策保持不变。
- 不重新设计 provider、审批协议、MCP schema、session schema 或发布版本策略。
- 不把 `.playwright-cli/`、`output/` 等本地临时产物加入提交。

## 本轮追加：metadata-only observability（2026-09-24）

- AgentRunTrace 现在只展示可信工具 registry 的 capability class、授权结果，
  以及 terminal/preview 的有界 lifecycle；不会记录 prompt、tool input/output、
  URL、路径、凭据或 raw error。
- plan mode 的拒绝会产生 `authorizationResult: deny`，terminal callback 与 preview
  lifecycle route 都保持 host-owned、enum-only、fail-closed。
- 已移除未被 UI 使用的重复 Desktop capability trace registry，避免双重 schema。
- 自动化证据：agent-core **212/212**、Desktop **232/232**、build/typecheck、
  `git diff --check`；浏览器/PTY 手工验收仍保留为未完成项。

## 隔离浏览器验收补充（2026-09-24）

- 使用临时 Git fixture（不使用真实项目工作区）启动已构建 Desktop，确认
  Repository/Remote/GitHub/CI cards 的只读状态。
- 通过浏览器执行 terminal command，并通过 loopback HTTP preview 加载/清理 iframe；
  Runtime trace 显示单一 `Terminal: started/completed` 与 `Preview: started/loaded`，
  没有 prompt、tool payload、路径、URL 或 secret。
- 发现并修复 UI 与 server 重复记录 terminal lifecycle、以及 stale iframe error
  造成的 false preview failure；修复后 targeted Desktop **39/39** 通过。
- CLI 外部真实 PTY 手工验收仍保留为后续项；QA 进程已停止，产物不提交。

## 阶段门槛

每个阶段完成后更新：

- `.planning/2026-09-24-ten-hour-dev-sprint/progress.md`
- `.planning/2026-09-24-ten-hour-dev-sprint/findings.md`
- 本文件的 checklist/status

最终完成条件：所有已实现范围有测试和运行时证据，full verification 通过，代码和计划
文档已提交并推送；如果 10 小时窗口结束仍有未完成项，保留准确的进度和下一步，不把
未完成内容标成完成。

## 当前状态

- [x] 已创建 10 小时排程文档。
- [x] 已确认当前分支与远程提交基线。
- [x] CLI 滚动/历史体验阶段（focused tests 已通过，待 PTY 验收）。
- [x] Desktop 终端命令历史阶段（focused tests 已通过，待浏览器验收）。
- [x] 输出滚动阶段（focused tests 已通过）；会话恢复和维护审计待继续。
- [x] capability token 第一阶段（terminal/workspace mutation，focused tests 已通过）。
- [x] capability token 本轮范围：生产 launcher、所有 `/api/` mutation、served HTML
  注入、浏览器 fetch seam 与 missing/wrong/valid/loopback 回归覆盖。
- [x] terminal canonical cwd/lifecycle、进程组清理和 command/input metadata 脱敏已完成；
  focused Desktop **227/227**。
- [x] read-only capability-panel、Git branch/dirty/remote metadata、显式 opt-in
  GitHub/CI 状态与 malformed-metadata 回归已完成；Desktop **230/230**。
- [x] 已在隔离临时 Git 仓库中完成 Desktop 浏览器验收：能力面板、真实 terminal
  命令、loopback preview 和单一 lifecycle trace 均通过；CLI 外部真实 PTY 仍待后续。
- [x] focused/runtime verification 已通过；前一阶段的 full release-gate 证据保留有效。
- [x] 已提交并推送本轮变更；最新 metadata-only observability commit 为 `7d2331a`。
