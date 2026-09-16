# CLI 现代终端界面 v1

**建立日期：2026-09-14**

**文档状态：已实现（v1）**

## 目标

把 CLI 的真实终端交互从单纯的行文本升级为接近 Gemini CLI / Claude Code 的终端工作台，同时不改变脚本调用、模型请求、工具执行、审批、验证和 session memory 语义。

## 交互边界

- 只有 stdin/stdout 都是 TTY、且没有 `--json`、`--once`、`--mcp-server` 时启用丰富界面。
- 管道、CI、自动化和机器可读模式继续使用稳定的纯文本/JSON 输出。
- 不依赖外部终端框架；第一版使用 ANSI + Node readline，降低安装和跨平台风险。

## v1 体验

- 欢迎屏：项目名、当前目录、session、provider、model、streaming 状态。
- 常用命令提示：`:help`、`:clear`、`:model`、`:quit`，保留现有 `:validate` 和 `:cleanup`。
- 视觉分区：用户输入、assistant 回答、tool/progress、验证结果分别可辨识。
- 轻量 Markdown：标题、列表、引用、代码围栏和代码行有清晰的终端样式；未知文本原样保留。
- 响应状态：首 token、总耗时和当前 turn 不与回答文本粘连。
- `NO_COLOR` 时仍然输出可读的纯文本。

## 非目标

- v1 不替换 readline 为完整 raw-mode 编辑器，不实现鼠标事件或全屏 alternate-screen 应用。
- v1 不修改 provider 协议、工具 schema、审批策略、MCP stdio 协议或 JSON 输出结构。

## 已交付实现

- `apps/cli/src/tui-mode.ts` 负责 TTY/脚本模式边界，避免 rich UI 进入 pipe、CI、
  `--json`、`--once` 和 `--mcp-server`。
- `apps/cli/src/tui-renderer.ts` 提供欢迎屏、运行状态、用户消息、命令提示和轻量 Markdown
  渲染；窄终端会换行/截断，不依赖第三方终端框架。
- `apps/cli/src/tui-stream.ts` 通过局部 ANSI 重绘让流式回答保持可见；代码围栏、标题、列表、
  引用在回答增长时持续刷新，结束后保留稳定的最终内容。
- `index.ts` 仅在 rich TTY 路径接入这些渲染器；原有 readline、审批、tool callback、
  validation、session memory、JSON 和 line-mode 输出仍走原路径。
- `:help`、`:clear`、`:model`、`:quit` 已加入；`:validate`、`:cleanup`、`exit`、`quit`
  保持兼容。stdin EOF 也会让交互循环正常退出。

## 验收结果

- 在真实 TTY 中 `pnpm cli` 显示欢迎屏、provider/model/streaming/session/工作目录状态，
  使用 `›` 输入提示，并可看到 Markdown/代码块的流式重绘。
- CLI 专项测试：**134/134 passed**，覆盖 renderer、TTY boundary、live stream renderer、
  非 TTY interactive、EOF、JSON 和既有审批/验证/MCP 语义。
- `pnpm verify:typescript`：workspace build/typecheck/tests、preview contract、release gate、
  release workflow、documentation contract 全部通过。
- 使用本地 OpenAI-compatible SSE stub 做了 PTY smoke：欢迎屏、流式标题/正文/代码块、`:model`、
  `:help` 和 `:quit` 均通过；`NO_COLOR=1` 仍保持可读文本。
- `--json`、`--once`、`--mcp-server` 和非 TTY 输出不生成 TUI 控制序列。
