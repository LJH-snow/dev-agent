# Findings — 10 小时开发任务

## 基线

- 项目根目录：`/Users/Admin/Desktop/dev-agent`。
- 分支：`codex/desktop-cli-workbench`。
- 最新代码提交：`19a2a61`，远程同 commit。
- 未跟踪目录：`.playwright-cli/`、`output/` 以及本执行计划目录；临时验收目录不可混入代码提交。

## 关键实现观察

- CLI transcript 是 bounded dynamic viewport；启动和退出路径不清屏，因此终端 emulator 的 scrollback 可以继续查看历史输出。Ink 内部 viewport 负责长 transcript 的导航，终端外部 scrollback 由宿主终端负责。
- CLI prompt `:history` 是持久化会话历史视图，与终端 emulator scrollback 和 composer 的命令历史不同，不能混为一个数据源。
- Desktop task terminal 的命令历史是内存态 `TerminalCommandHistory`；它限制条数和字符数、去重并恢复草稿，不向 session 文件、localStorage 或 sessionStorage 写入命令文本。
- Desktop 输出 follow 状态是 UI presentation state，不改变服务器 cursor；手动上滚、重连、清除和 Follow latest 各自有明确行为。
- Desktop server 的 terminal/workspace/session mutation 已有 server-scoped capability token、loopback/origin 限制和 bounded request/output；metadata/trace 仍必须避免 prompt、命令、路径、URL、凭据和 raw error。

## 验收风险

- CLI 全量测试曾出现一次 approval overflow 时序超时，但单独重跑通过；需要在最终文档中区分 flaky evidence 与确定性失败。
- CLI package smoke 依赖 npm 安装本地 tarball 的网络/registry 读取，曾因 `ETIMEDOUT` 失败；重试前不应修改依赖或放宽安全边界。
- PTY 和浏览器验收只能使用临时 HOME/Git fixture/loopback server，不得让真实项目 worktree 或远程 GitHub 发生 mutation。

## Anthropic adapter audit

- Adapter package remains isolated under `packages/claude-agent-sdk` and uses only the supplied project tool registry through `mcp__dev_agent__*`; native SDK tools are disabled.
- `settingSources: []` and `strictMcpConfig: true` preserve the fail-closed package boundary.
- Permission decisions are bounded, one-use, fingerprint-bound, and cleared at host lifecycle boundaries; the real MCP handler repeats policy checks when preflight is absent.
- Fresh verification: adapter **13/13**, model provider **94/94**.
