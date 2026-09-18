# CLI npm 分发与跨目录使用

本文记录 `@agent_cli/cli` 从 workspace 开发态到可安装 CLI 的边界。当前仓库已经具备本地打包、clean-install 和外部目录 smoke test；**截至 2026-09-17，`@agent_cli/cli@0.1.6` 已发布到 npm，`latest` 指向该版本，并且与 `v0.1.6` GitHub Release 中的 CLI tarball 一致**。当前工作区已进入 `@agent_cli/cli@0.1.7` candidate，包含未发布的 doctor metadata 收紧、runtime release 选择/隔离 smoke 和 Desktop managed runtime status。后续新版本仍需维护者单独授权。

## 已发布版本记录（2026-09-16）

- `npm whoami` 返回 `libai168`，npm Web 2FA 授权已完成。
- 当前账号是 npm `agent_cli` organization 的 owner；面向用户的包名固定为 `@agent_cli/cli`，不会改动既有的 `@agent-cli/agent-cli`。
- `@agent_cli/cli@0.1.4` 已成功发布，dist-tag 为 `latest`；可用 `npm view @agent_cli/cli@0.1.4 version` 复核，且从 registry clean install 后 `dev-agent --version` 为 `0.1.4`。
- `@agent_cli/cli@0.1.5` 已发布，包含 v0.3.0–v0.4.0 的 provider/model、预算、索引、MCP 和 Desktop 状态实现。
- `0.1.1` 是中间版本：包已进入 registry，但运行时版本横幅仍显示 `0.1.0`；`0.1.2` 修复了从包自身的 `package.json` 读取版本，`0.1.3` 加入项目级状态隔离，`0.1.4` 修复了指定 `--session` 时新建/更新 memory metadata 仍记录为 `default` 的问题。
- 本次只发布 npm 包；没有创建 Git tag 或 GitHub Release。后续正式 GitHub release 仍需单独走授权的 tag-only workflow。

## 最新发布检查（2026-09-17）

- `@agent_cli/cli@0.1.6` 已完成 npm 发布；registry 可复核
  `npm view @agent_cli/cli@0.1.6 version`，`latest` 指向该版本。
- 发布使用 `v0.1.6` GitHub Release 的 `agent_cli-cli-0.1.6.tgz`，下载后 SHA-256 为
  `e44d8356001317662876d3dcafc5cac0875135bc048a185ecec1a606c475c706`，与 release asset
  digest 一致。没有从当前工作区重新打包，避免 npm 包与已发布的 tag 内容漂移。
- `main` 已推送到 GitHub；本轮没有创建新的 Git tag 或 GitHub Release。

## 0.1.6 发布候选检查（2026-09-17）

- CLI package 已升级到 `0.1.6`，并补齐 `license`、`repository`、`homepage`、`bugs` 和 Node `>=20`
  metadata；repository URL 固定为本仓库 GitHub 地址。
- `pnpm release:preflight` 新增 metadata contract：缺少或填错 license/repository/homepage/bugs 的候选版本
  会被拒绝，不会进入 publish 阶段。
- `typescript` 经过审计后继续保留为普通 runtime dependency：发布 bundle 会加载其 Node CommonJS 适配层，
  当前没有可靠的 lazy-load 边界，改成 peer/optional 会让 clean install 失败。
- 仓库根目录 `.npmrc` 已删除；npm token 只保留在用户级 `~/.npmrc`，仓库的 ignore 规则继续生效。

## v0.1.6 GitHub Release 记录（2026-09-17）

- `main` 已推送，tag `v0.1.6` 创建在发布治理提交 `d361381` 上并触发 release workflow。
- workflow 已成功构建 macOS ARM64/x64 和 Linux x86_64/ARM64 runtime archive，以及 `agent_cli-cli-0.1.6.tgz`。
- release 包含 4 个 runtime archive、4 个 `.sha256` sidecar、固定的
  `dev-agent-runtime-manifest.json` 和 CLI tarball；publish job 已验证下载 artifact 和 tag。
- 正式 release 地址为
  <https://github.com/LJH-snow/dev-agent/releases/tag/v0.1.6>。
- 后续 npm 发布使用上述 release tarball；npm registry `latest` 现在指向
  `@agent_cli/cli@0.1.6`。当前工作区 `@agent_cli/cli@0.1.7` doctor metadata 收紧、
  runtime release 选择/隔离 smoke 与 Desktop managed runtime status 仍是未发布候选。

## 给使用者的安装方式（已发布）

```bash
npm install -g @agent_cli/cli
cd /path/to/your-project
dev-agent --version
dev-agent --tools
dev-agent --cwd /path/to/your-project --index . --json
dev-agent --session your-project --once "列出当前目录的文件"
dev-agent --cwd /path/to/your-project --project-state --tools
```

全局安装后的 `dev-agent` 不依赖当前仓库、workspace symlink 或开发机上的绝对路径。CLI 的基础 JavaScript bundle 可以使用 `LocalExecutor` 运行；没有模型请求的 `--version`、`--tools` 和 `--index` 不要求 API key。

`pnpm cli` 仍然是本仓库的 workspace 开发脚本。它适合在 checkout 内调试，不是其他项目调用全局 CLI 的安装方式。

## 工作目录选择规则

CLI 会在初始化 provider、MCP、session/context 和 built-in tools 前确定一个绝对工作目录。优先级固定为：

```text
--cwd <path>
  > DEV_AGENT_WORKING_DIRECTORY
  > INIT_CWD
  > process.cwd()
```

`--cwd` 和 `DEV_AGENT_WORKING_DIRECTORY` 的相对路径都相对于启动时选定的当前目录解析；最终目录必须存在且必须是目录。目标目录不可访问、不存在或是普通文件时，CLI 在执行操作前返回错误；搭配 `--json` 时 stdout 仍是一个 JSON error document。

例如，从一个 launcher 目录操作另一个项目：

```bash
cd /tmp
DEV_AGENT_WORKING_DIRECTORY=/path/to/your-project \
  dev-agent --index . --json

# 显式 flag 覆盖环境变量
cd /tmp
dev-agent --cwd /path/to/your-project --index . --json
```

## 配置与 session 隔离

默认兼容行为保持不变：

- config 默认读取 `~/.dev-agent/config.json`；
- session 默认写入 `~/.dev-agent/sessions/default.json`；
- `--session <id>` 选择同一个用户级 session 目录中的独立文件；
- `DEV_AGENT_SESSION_DIR` 可把整个 session 目录指向项目专用位置；
- `DEV_AGENT_MEMORY_FILE` 设置后，使用单个 JSON memory 文件并优先于 session 目录。

项目可以显式选择自己的 config 文件：

```bash
dev-agent --cwd /path/to/project --config .dev-agent/config.json
# 或
DEV_AGENT_CONFIG_FILE=.dev-agent/config.json \
  dev-agent --cwd /path/to/project
```

如果希望一次性为外部项目启用成套的项目级状态，可以在已发布的
`@agent_cli/cli@0.1.6` 中显式使用 `--project-state`：

```bash
dev-agent --cwd /path/to/project --project-state --session project --tools
```

在该模式下，没有显式 config 路径时使用
`<final-cwd>/.dev-agent/config.json`，没有 `DEV_AGENT_SESSION_DIR` 时使用
`<final-cwd>/.dev-agent/sessions`；`DEV_AGENT_MEMORY_FILE` 仍然优先于 session
目录。完整优先级为：

```text
config:  --config > DEV_AGENT_CONFIG_FILE > --project-state 项目默认 > 用户默认
session: DEV_AGENT_SESSION_DIR > --project-state 项目默认 > 用户默认
memory:  DEV_AGENT_MEMORY_FILE > 选定的 session 目录
```

`--project-state` 已随已发布的 `@agent_cli/cli@0.1.6` 提供；它是显式 opt-in，不会自动迁移、重命名或覆盖已有的
`~/.dev-agent/sessions/default.json`。不带该 flag 时，兼容默认仍是
`~/.dev-agent/config.json` 和 `~/.dev-agent/sessions`。

## Provider 与外部工具前置条件

根据选用的 provider 设置相应环境变量：

- Ollama：默认 provider，可用 `OLLAMA_BASE_URL` 覆盖地址；
- OpenAI：`OPENAI_API_KEY` 或 `DEV_AGENT_OPENAI_API_KEY`；
- Anthropic：`ANTHROPIC_API_KEY` 或 `DEV_AGENT_ANTHROPIC_API_KEY`；
- Gemini：`GEMINI_API_KEY` 或 `DEV_AGENT_GEMINI_API_KEY`。

`rg`（ripgrep）用于 search 工具；目标项目需要有相应的文件读取权限。Git 工具只有在目标目录是 Git workspace 时才有完整的 Git 能力。`protoc` 主要是从源码构建 Rust runtime 的开发前置条件，不是基础 npm CLI 每次运行的前置条件。

## 可选 Rust sandbox runtime

JavaScript npm 包和 Rust sandbox 是两个独立的发布物：

- 不提供 Rust binary 时，CLI 仍可运行，并使用 `LocalExecutor`；`dev-agent --doctor` 会把 Rust runtime 报告为未配置的 warning；
- 需要 sandbox 时，额外提供匹配平台的 `dev-agent-executor`：

  ```bash
  dev-agent --check-rust /path/to/dev-agent-executor
  dev-agent --rust-executor /path/to/dev-agent-executor --once "检查当前项目"
  # 也可以设置 DEV_AGENT_RUST_BINARY
  ```

- 当前 release workflow 为已验证的 macOS Apple silicon/Intel 和 Linux x86_64/arm64 target 生成 archive 与 SHA-256 checksum；
- npm 安装不会通过 `postinstall` 静默下载或执行未经校验的 Rust binary；
- Windows sandbox 不在本包当前承诺范围内。

## 后续版本的维护者发布前清单

以下命令只验证本地候选包，不执行远程发布：

```bash
pnpm release:preflight
pnpm check
pnpm build
pnpm typecheck
pnpm test
pnpm package:smoke
pnpm verify
```

`pnpm release:preflight` 会检查候选版本与 `docs/release-state.json` 是否一致、候选版本是否高于
registry 已发布版本、license/repository/homepage/bugs metadata、npm 登录状态、registry 版本匹配，
以及 `npm pack --dry-run` 是否只包含
发行 allowlist。它只输出稳定的 metadata-only JSON，不会执行 `npm publish`。预检通过后，只有明确
传入 `pnpm release:publish -- --publish` 才会执行发布，并在发布后复核候选版本；不带 `--publish`
时只返回 confirmation-required 结果。

检查 package 内容与元数据：

```bash
pnpm --filter @agent_cli/cli run build
pnpm --filter @agent_cli/cli run build:package
pnpm --filter @agent_cli/cli pack --pack-destination /tmp/agent-cli-pack
```

后续版本正式发布前由维护者单独确认：

1. `npm whoami` 返回预期账号；这只能证明本机 npm credentials 可用，不能替代 scope 所有权检查；
2. `agent_cli` organization 和 `@agent_cli/cli` 包权限仍然有效；不要误用既有的 `@agent-cli/agent-cli`；
3. 版本号、CHANGELOG、README、`package.json` 和候选 tarball 一致；
4. `npm pack --dry-run` 文件清单只包含发行入口、source map、README、LICENSE 和必要的 runtime dependency metadata，不包含 secrets、测试产物、workspace 引用或开发机绝对路径；
5. 维护者明确批准远程发布动作，并在发布后复核 registry 中的精确版本。

本次 `@agent_cli/cli@0.1.4` 已于 2026-09-16 按上述边界完成发布；发布后已全局重新安装，并用
`--session smoke --metadata --json` 验证 `smoke.json` 的 `sessionId` 为 `smoke` 而不是 `default`。
该记录不等同于创建 Git tag 或 GitHub Release。
