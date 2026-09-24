# Progress — 10 小时开发任务

## 2026-09-24 — 计划建立与当前状态

- 建立本轮独立执行文档，目标覆盖 CLI scrollback、Desktop 终端历史、输出滚动、会话恢复、可选 Anthropic adapter 和发布门禁。
- 当前分支：`codex/desktop-cli-workbench`。
- 当前 HEAD：`19a2a61 fix: stabilize rich cli markdown layout`；远程分支已同步。
- 现有 `.playwright-cli/`、`output/` 是本地验收产物，保留但不纳入提交。

## 已完成的开发阶段

- **CLI viewport / scrollback：** `InkViewportModel` 支持 PageUp/PageDown、Home/End、鼠标滚轮和 follow-output；Markdown 实际渲染行数用于 viewport 高度，fenced code 后的 follow-up 段落不会被截断。相关 Ink/Markdown 回归已并入提交 `19a2a61`。
- **Desktop 命令历史：** `TerminalCommandHistory` 在当前页面内有界保存 64 条去重命令，单条最多 4096 字符，支持 ↑/↓ 与草稿恢复；没有使用 `localStorage` 或 `sessionStorage` 保存原始命令。
- **Desktop 输出滚动：** 手动滚动离开 follow mode 后，新输出不会强制改变视口；Follow latest、清除视图和重连都保持明确状态。
- **会话与执行边界：** 已有 terminal cwd canonicalization、loopback/capability token、进程组清理、输出上限、session rename/delete fallback、Changes Center bounded diff 等保护。

## 当前验证证据

- Desktop 全量测试：**236/236 通过**（2026-09-24 本轮重新执行）。
- Desktop build/typecheck：测试前后均由 Desktop test 脚本执行 TypeScript build；单独 typecheck 仍待最终门禁。
- CLI build/typecheck：已通过；CLI 全量测试此前为 **630/632**，其中 approval overflow 测试单独重跑通过，package smoke 的失败原因为 npm 网络 `ETIMEDOUT`，不是代码断言。
- `git diff --check`：上一提交验证通过；本轮计划文档更新后需再次执行。

## 下一步（本轮继续）

1. 审查并运行 Desktop/CLI 的单独 typecheck、build 与 diff check。
2. 运行 CLI focused viewport/markdown/approval 测试；必要时重跑 package smoke 以区分网络故障和代码故障。
3. 完成可复现的 PTY/浏览器验收记录；不把临时截图、日志和 fixture 加入 Git。
4. 只提交本轮计划文档及必要的验证记录，推送后核对 HEAD 与 origin 一致。

## 2026-09-24 17:30 — conversation streaming auto-follow fix

- Reproduced a real Desktop UI issue in an isolated local browser: the middle
  conversation panel used `scroll-behavior: smooth` while streaming code assigned
  `scrollTop` on every token. The viewport lagged behind newly appended output and
  could leave the latest text below the visible area.
- Added `setMessagesScrollTop()` in `apps/desktop/public/index.html`, using
  `scrollTo({ behavior: "auto" })` for live follow and a safe fallback. Manual
  upward scrolling still shows `New output below` and is never forced to the
  bottom.
- Focused contract was included in a full Desktop run: **236/236 passed**.
- Browser verification on a fresh server at 1280×900 showed the follow target was
  reached immediately after synthetic streamed output was appended; the old
  smooth-scroll behavior was the reproduced failure.

## 2026-09-24 17:35 — delivery audit

- 提交 `491d03d fix: keep desktop conversation follow-up visible` 已推送，`HEAD` 与 `origin/codex/desktop-cli-workbench` 一致。
- 仅 `.playwright-cli/` 与 `output/` 仍未跟踪；它们是已有本地验收产物，未加入提交。
- Phase 6 的代码、文档、测试、build/typecheck、diff check 和浏览器证据均已完成。
