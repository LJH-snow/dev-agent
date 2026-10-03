# dev-agent

[English](README.md) · **简体中文**

面向开发者的本地 AI 编程代理，使用 TypeScript、Node.js 和 Rust 构建。它提供 CLI、Desktop 工作台、受控工具执行、MCP 集成、会话恢复、验证证据和受限沙箱。

## 项目特点

- **CLI**：支持交互式终端、Rich/Ink 界面、机器可读 JSON、会话恢复、审批、计划、验证和后台任务。
- **Desktop 工作台**：提供运行历史、通知、任务工作区、Changes Center、终端、Preview、MCP 状态和验证中心。
- **安全执行**：危险工具经过审批；文件、命令、输出、历史和导出均有边界；未知能力默认拒绝。
- **MCP**：支持 action、resource、prompt、进度、取消、重连、能力撤销和 server-scoped capability。
- **Rust 沙箱**：macOS 使用 `sandbox-exec`，Linux 使用 `bwrap`，支持网络、文件、超时、并发和输出容量限制。
- **模型提供商**：支持 OpenAI、Anthropic、Gemini 和 Ollama，并提供 provider/model metadata、profiles、aliases、fallback 和预算控制。

## 快速开始

要求 Node.js >= 22（见 `.nvmrc`，当前为 26）和 pnpm 12.3.4。

```bash
pnpm install
pnpm check
pnpm build
pnpm typecheck
pnpm test
pnpm package:smoke
pnpm cli --version
```

Rust runtime 的构建脚本需要 `protoc`。Debian/Ubuntu 可运行：

```bash
sudo apt-get install protobuf-compiler
```

代码搜索测试需要 `rg`（ripgrep）。

## 运行 CLI

```bash
pnpm cli
pnpm cli --once '检查当前项目'
pnpm cli --tools --json
pnpm cli --doctor
```

常用能力包括：

- `--approval allow|ask|deny-dangerous|review-writes` 控制危险操作审批；
- `--resume`、`--session-list` 和 `:sessions` 管理会话；
- `--json`、`--metadata` 和 `--no-stream` 用于脚本与自动化；
- `:validate`、`:trace`、`:jobs`、`:mcp`、`:team` 等交互命令；
- `--index` 和 `code-search` 提供有界的多语言代码索引。

## Desktop 工作台

Desktop 是本地 Web 工作台，运行在本机并通过 loopback 访问。它包含运行状态、历史记录、任务工作区、验证与变更证据、终端和 Preview。Preview 只接受 loopback HTTP(S) 与明确端口；不会把 prompt、命令、工具输入/输出、凭据或原始错误写入历史和导出。

更多模块说明见：

- [Desktop README](apps/desktop/README.md)
- [CLI README](apps/cli/README.md)
- [文档索引](docs/README.md)
- [架构说明](docs/architecture.md)

## CI 与验证

`.github/workflows/ci.yml` 在 Pull Request 和推送到 `main` 时运行。CI 保留平台专项 job，并额外提供一个完整 gate：

- **Full verify**：Ubuntu job 安装 Rust、`bubblewrap`、PTY 工具、protobuf 和 ripgrep，配置 Linux user namespace，构建 runtime/executor，然后运行 `pnpm verify`；它设置 `DEV_AGENT_REQUIRE_LIVE_SANDBOX=1`，缺少真实沙箱能力时会失败。
- **TypeScript**：运行结构检查、构建、类型检查、workspace tests、CLI package smoke、preview、release/CI/documentation contracts。
- **Rust**：运行 `cargo fmt --check`、clippy 和 Rust unit/doc tests。
- **Linux/macOS integration**：分别验证 Linux `bwrap` 和 macOS `sandbox-exec` 的真实受限执行路径。

本地完整验证：

```bash
pnpm verify
```

它按固定顺序运行 TypeScript、Rust 和 real-Rust integration gate，并在第一条失败处停止。

## 安全边界

- 外部内容、Git 状态、MCP metadata 和浏览器数据都视为不可信输入。
- 默认不持久化 prompt、原始工具 payload、命令、环境变量、凭据、绝对路径或原始错误。
- 文件读写、搜索、diff、历史、证据和导出均使用固定大小、字符数、文件数或时间上限。
- 取消、超时、审批拒绝、沙箱拒绝、错误 origin、错误 token 和能力撤销均 fail-closed。
- worker-scoped MCP 只能使用经过审阅的工具名称、任务工作区根目录和独立 session。

## 文档与路线图

完整的设计决策、验证证据和阶段记录位于 [`docs/`](docs/)。推荐从以下文档开始：

- [文档索引](docs/README.md)
- [架构参考](docs/architecture.md)
- [变更日志](docs/CHANGELOG.md)
- [下一阶段路线图](docs/next-roadmap-plans-v62-plus.md)
- [CLI npm 分发指南](docs/release-cli-npm.md)

根 README 的英文版本包含完整的历史路线图和更详细的功能清单；本文件提供对应的简体中文入口。

## 贡献与发布

提交改动前请运行相关 focused tests 和 `pnpm verify`。仓库不会自动发布 npm 或创建 GitHub Release；发布、提交和推送都需要维护者明确授权。

## 许可证

本项目使用 MIT License，详见 [LICENSE](LICENSE)。
