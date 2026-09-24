# v66 开发进度：CLI / Desktop 终端历史与工作台可靠性

> 最后更新：2026-09-24（Asia/Shanghai）

## 当前状态

- 排程文档已建立：`docs/day-plan-v66.md`。
- canonical 持久化工作文件已建立在：`.planning/2026-09-24-ten-hour-dev-sprint/`。
- 当前分支 `codex/desktop-cli-workbench` 以 `737b5ed` 为本轮基线；本次 hardening 变更已通过门禁，待提交并推送。
- 本轮已修改 CLI/Desktop 源码、测试和计划文档；`.playwright-cli/`、`output/` 与重复计划目录仍为本地未跟踪产物。

## 证据账本

| 阶段 | 状态 | 证据 |
|---|---|---|
| 基线与排程 | 已完成 | canonical plan、分支/远程审计与边界记录 |
| CLI 滚动/历史 | focused 已完成 | CLI 630/630；PTY 手工验收仍待后续 |
| Desktop 命令历史 | focused 已完成 | Desktop 224/224，含命令 recall contract |
| Desktop 输出滚动 | focused 已完成 | manual follow-latest contract 已覆盖；浏览器手工验收仍待后续 |
| capability token | 已完成本轮范围 | 生产 launcher、`/api/` mutation guard、served HTML 注入、token tests |
| 会话恢复/维护审计 | 延后 | 不在本轮已提交范围内 |
| 全量门禁/推送 | 门禁已完成，推送待完成 | build/typecheck/release gate/diff check 已通过 |

## 操作规则

- 每次修改后先跑最小 focused test，再扩大验证范围。
- 若发现安全边界不清晰，保留 fail-closed 行为并记录 findings，不为了功能通过而放宽边界。
- 临时截图、下载和 Playwright 日志继续留在未跟踪目录，不加入 Git。

## 2026-09-24 12:56 — CLI scroll and Desktop terminal history/output progress

- CLI viewport audit confirmed the existing PageUp/PageDown/Home/End behavior,
  mouse parser, startup size normalization, and one-row render guard. Added a
  bounded `scrollBy()` path so mouse-wheel events move three wrapped rows rather
  than jumping an entire page; keyboard page navigation remains unchanged.
- CLI verification after the change: **630/630** tests passed, including Ink
  long-transcript navigation, mouse-wheel interaction, terminal scrollback
  preservation, and the new viewport regression.
- Desktop task terminal now has a session-local `TerminalCommandHistory` with a
  64-entry / 4096-character bound, duplicate suppression, draft restoration,
  and ↑/↓ recall for single-line commands. It intentionally does not use
  browser storage because commands can contain secrets.
- Desktop output now preserves a user's manual scroll position while new output
  arrives and exposes an explicit `Follow latest` control. Clear/reconnect,
  session changes, and new runs return to follow-latest mode.
- Desktop verification after these changes: **223/223** tests passed, including
  the new command-history regression and HTML/controller safety contracts.


## 2026-09-24 13:05 — Desktop capability boundary tranche

- 生产 `startDesktopEntry()` 路径现在启用 server-scoped capability token；token 只注入根 HTML 文档，浏览器通过统一 `fetch` seam 为同源 mutation 请求添加 header。
- `terminal` 与 `workspace` mutation 先行受保护；loopback、origin、read-only metadata 约束保持不变。默认 `createDesktopServer()` 仍保持未启用，避免测试/embedding host 在未选择边界时被隐式改变。
- token 使用常量时间比较，缺失/错误 token 返回稳定 403，不回显 token；served HTML 会替换占位符。
- 新增 capability-token focused regression：页面注入、缺失/错误 token 拒绝、正确 token 允许 terminal start；当前 focused tests 通过。
- 仍待完成：把 capability 边界扩展到其余 Desktop mutation 路由前，先统一测试请求 helper；补 terminal canonical cwd/lifecycle cleanup 和 full verification。


## 2026-09-24 13:22 — capability token and release-gate evidence

- 修复 task-workspace 测试在 capability guard 开启后缺少 mutation header 的问题；
  Desktop 全量测试最终为 **224/224**。
- CLI 全量测试为 **630/630**；Desktop build/typecheck、workspace build/typecheck、
  TypeScript release gate、CLI package smoke、preview/documentation/native contracts
  与 `git diff --check` 均通过。
- `startDesktopEntry()` 生产路径开启 server-scoped capability token；所有 `/api/`
  mutation 统一受保护，GET metadata 保持只读和 loopback 约束。
- 本轮未宣称 terminal canonical cwd/lifecycle、浏览器手工验收和 PTY 手工验收完成；
  它们保留在后续 sprint。
- 下一步：只 stage 预期源代码、测试和文档，排除本地 QA 产物，然后 commit/push。


## 2026-09-24 — Desktop terminal execution hardening

- terminal cwd 现在在 spawn 前使用 `lstat`/`realpath` canonicalize；缺失、文件和最终
  symlink 路径均拒绝，POSIX shell 额外用 `pwd -P` guard 防止校验后重定向。
- session 删除会先停止其 terminal processes；停止流程支持 process-group `SIGTERM`
  到 `SIGKILL` escalation；运行 terminal 时拒绝 session rename。
- command summary/system metadata 会脱敏 token、Bearer、私钥和 credential-shaped 值；
  stdin event 仅保留 `[input N bytes]`，不再保存原始输入。
- 最新 Desktop focused suite：**227/227**；Desktop build/typecheck 与 `git diff --check`
  通过。浏览器/PTY 手工验收以及 read-only capability panel、Git metadata 和
  authorization trace 仍未完成。
- `.playwright-cli/`、`output/` 与 `.planning/2026-09-24-ten-hour-development/`
  继续保持未跟踪，不纳入提交。
