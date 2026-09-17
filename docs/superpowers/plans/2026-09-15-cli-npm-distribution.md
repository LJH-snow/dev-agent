# CLI npm 分发与跨目录使用补齐实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前仅适合仓库内开发调用的 CLI 整理为可从任意项目目录运行、可在干净环境安装、并可发布到 npm 的单一 CLI 包。

**Architecture:** 推荐只发布一个面向用户的 `@agent_cli/cli` 包，把当前 workspace 内的 `@dev-agent/*` 运行时代码 bundle 到 CLI 发行物中，内部包继续保持私有。CLI 增加显式工作目录入口，避免依赖 pnpm 的 `INIT_CWD`；Rust executor 先作为可选的独立运行时处理，不把未定义的跨平台下载策略塞进 npm 安装流程。

**Tech Stack:** TypeScript、Node.js >= 20、pnpm 12.3.4、npm package/bin、esbuild（或经过评审后选择的等价 bundler）、Node 内置 test runner、现有 Rust executor。

**Spec:** `docs/superpowers/plans/2026-09-15-cli-npm-distribution.md`（本文件自包含目标、范围、接口和验收标准）

## Global Constraints

- npm 登录状态不是本计划的阻塞项；正式发布前仍必须单独确认 `npm whoami`、scope 所有权、版本号和发布授权。
- 首选只发布一个 CLI bundle；除非维护者明确选择多包发布，否则 `@dev-agent/agent-core`、`@dev-agent/tools` 等内部包继续保持私有。
- `--json`、`--mcp-server`、pipe/CI 和现有非 TTY 输出契约不得被打包或 `--cwd` 改动破坏。
- `--cwd` 的优先级必须高于 `DEV_AGENT_WORKING_DIRECTORY`、`INIT_CWD` 和 `process.cwd()`；所有选定目录都必须经过存在性和目录类型校验。
- 生产包不得依赖当前 checkout 的 `node_modules`、workspace symlink 或未发布的 `workspace:*` 依赖。
- Rust sandbox 不是基础 npm CLI 的隐式前置条件；没有显式 runtime 时，必须清楚报告 LocalExecutor/未沙箱模式。
- 本计划默认不执行 `npm publish`、不创建 release tag、不创建 GitHub Release；这些动作必须由维护者单独授权。本次已获得该授权并单独完成 npm 包发布，仍未创建 tag 或 GitHub Release。
- 所有实现任务采用 TDD：先增加可复现的失败测试，再实现最小改动，最后运行局部测试和固定 release gate。

## 当前状态与问题边界

### 已经具备

- 直接从其他目录启动现有构建物时，CLI 可以使用启动目录作为工作目录。
- `--index <path>` 已支持显式扫描外部目录，并在目标目录创建 `.dev-agent/index.json`。
- CLI 已有 `bin` 声明、provider 配置、session 目录、MCP 配置和可选 Rust binary 参数。
- 本机 npm 认证无需重新设计。

### 仍然缺少

- `/apps/cli/package.json` 目前为 `private: true`，且依赖 `workspace:*`；不能作为独立 npm 包安装。
- `dist/index.js` 仍依赖 checkout 中的 `@dev-agent/*` 包，复制 CLI 的 `dist` 目录不能形成自包含发行物。
- `pnpm cli` 是 workspace 根脚本，在其他目录不能直接使用；`pnpm --dir <repo>` 还可能把工作目录带回仓库。
- CLI 没有显式 `--cwd` 参数，正常行为依赖 `process.cwd()`/`INIT_CWD`。
- 入口文件没有直接可执行所需的 Node shebang。
- release workflow 目前只打包 Rust executor，没有发布 JavaScript CLI。
- 默认 session 和 config 位于用户级目录，多项目使用时需要明确隔离策略。

## 推荐的发行决策

### 首次 npm 发布

采用单包 bundle 方案：

```text
@agent_cli/cli
└── dist/cli.js
    ├── agent-core
    ├── code-intelligence
    ├── executor
    ├── mcp
    ├── model
    └── tools
```

npm 安装后的基础命令应当无需访问当前仓库：

```bash
npm install -g @agent_cli/cli
cd /path/to/other-project
dev-agent --once "分析当前项目"
```

基础包默认允许 LocalExecutor 运行；如果用户需要 Rust sandbox，则额外设置
`DEV_AGENT_RUST_BINARY` 或 `--rust-executor`。Rust runtime 的自动下载、校验、升级和平台选择另作为独立发布设计，不在第一次 npm 发布中猜测。

### 暂不采用的方案

- 不把六个内部 workspace 包直接全部公开发布，除非维护者接受多包版本、scope 权限和发布顺序的长期维护成本。
- 不使用 postinstall 脚本静默下载未经明确校验的 Rust 可执行文件。
- 不以“本机 npm 已登录”替代 clean-install、bin 启动和外部目录 smoke test。

---

## Task 1: 建立可发布的 CLI bundle 边界

**Files:**
- Modify: `apps/cli/package.json`
- Modify: `apps/cli/src/index.ts`
- Create: `apps/cli/build-package.mjs`
- Modify: `apps/cli/tsconfig.json`（仅在 bundler 输入或输出需要时）
- Test: `apps/cli/tests/package-manifest.test.ts`

**Interfaces:**
- Consumes: `apps/cli/dist/index.js` 以及已构建的 workspace packages。
- Produces: 不依赖 workspace symlink 的 `apps/cli/dist/cli.js`，并通过 package `bin.dev-agent` 暴露。

- [x] **Step 1: 写 package metadata 的失败测试**
  - 断言 package 的运行时入口、`bin.dev-agent`、bundle 文件、`private` 状态和 package 文件清单符合发布要求。
  - 断言发布包中不存在 `workspace:*` 依赖声明，也不能要求安装未发布的 `@dev-agent/*` runtime package。
  - 断言 bundle 可以在没有仓库 `node_modules` 的临时安装目录中被 Node 加载。

- [x] **Step 2: 运行测试确认失败**
  - Run: `pnpm --filter @agent_cli/cli test -- package-manifest`
  - Expected: 测试因 `private: true`、workspace 依赖或缺少 bundle 入口失败。

- [x] **Step 3: 实现最小 bundle 构建**
  - 为 CLI 增加发布构建脚本；先完成 TypeScript workspace build，再将 CLI runtime bundle 到单一入口。
  - 将 Node 内置模块保持 external，将内部 `@dev-agent/*` 和运行时所需的第三方依赖纳入 bundle。
  - 将 package 的 `main`/`exports`/`bin` 指向最终发行入口；只保留发布需要的 `dist`、README 和 LICENSE。
  - 把 CLI 入口改为以 `#!/usr/bin/env node` 开始，使 npm 全局安装后的 Unix bin 可以直接执行。
  - 只有在确认 package 内容和 clean-install 测试通过后，才把 `private` 改为 `false`。

- [x] **Step 4: 运行局部测试确认通过**
  - Run: `pnpm build`
  - Run: `pnpm --filter @agent_cli/cli build:package`
  - Run: `pnpm --filter @agent_cli/cli test`
  - Expected: bundle、metadata 和既有 CLI 测试全部通过。

- [ ] **Step 5: 提交独立变更**
  - Commit: `feat: make cli package self-contained`
## Task 2: 增加明确的工作目录接口

**Files:**
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/config.ts`（如果环境变量解析放在 config 模块）
- Modify: `apps/cli/tests/cli-args.test.ts`
- Create: `apps/cli/tests/external-working-directory.test.ts`
- Modify: `apps/cli/README.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: CLI 参数、`DEV_AGENT_WORKING_DIRECTORY`、当前 `INIT_CWD`/`process.cwd()` fallback。
- Produces: `--cwd <path>`，并将同一个绝对目录传给 agent context、filesystem、shell、git、search、code-search、MCP runtime context 和 validation。

- [x] **Step 1: 写参数和路径行为的失败测试**
  - `--cwd <existing-directory> --once ...` 使用目标目录，而不是 launcher 的目录。
  - 缺失路径、文件路径和不可访问目录返回结构化错误，不启动 provider 或执行工具。
  - 优先级固定为：`--cwd` > `DEV_AGENT_WORKING_DIRECTORY` > `INIT_CWD` > `process.cwd()`。
  - `--json` 仍只输出一个可解析 JSON 值；未知 flag、缺值和冲突参数继续在执行前失败。
  - 在外部临时项目中运行 `--index .`、filesystem read 和 search，确认路径不回退到 dev-agent checkout。

- [x] **Step 2: 运行测试确认失败**
  - Run: `pnpm --filter @agent_cli/cli test`
  - Expected: `--cwd` 尚未被参数表接受，或外部目录行为无法证明。

- [x] **Step 3: 实现工作目录解析**
  - 在 CLI 参数表加入 `--cwd`，并在 provider、MCP、session/context 初始化之前解析和校验。
  - 将工作目录解析逻辑集中为一个可测试函数，避免在不同工具路径中各自读取 `process.cwd()`。
  - 保留无参数调用的兼容行为；直接从目标目录启动 bundle 时仍然使用当前目录。
  - 在 runtime 状态、session metadata 和 MCP 环境变量中使用最终解析结果。

- [x] **Step 4: 运行外部目录回归测试**
  - Run: `pnpm --filter @agent_cli/cli test`
  - Run: `cd /tmp && node /absolute/path/to/dev-agent/apps/cli/dist/cli.js --cwd /path/to/other-project --index . --json`
  - Expected: 返回的 path/indexPath 和工具上下文都指向目标项目；输出没有 checkout 路径误绑定。

- [ ] **Step 5: 提交独立变更**
  - Commit: `feat: add explicit cli working directory`
## Task 3: 建立 clean-install 和任意目录 smoke test

**Files:**
- Create: `apps/cli/tests/package-install.test.ts` 或等价的根级 package smoke test
- Modify: `apps/cli/package.json`
- Modify: `package.json`
- Modify: `scripts/release-gate.mjs`
- Modify: `tests/release-gate.test.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: Task 1 的 npm tarball 和 Task 2 的 `--cwd`/默认 cwd 行为。
- Produces: 可在没有 workspace symlink 的干净目录中重复执行的 package verification 命令。

- [x] **Step 1: 写 clean-install 失败测试**
  - 在临时 staging 目录运行 `npm pack`，再安装生成的 tarball。
  - 从另一个临时项目目录调用安装后的 `dev-agent` bin，而不是调用仓库内的 `pnpm cli`。
  - 至少验证 `--version`、`--tools`、`--index <external-dir> --json` 和一个不需要真实模型请求的启动路径。
  - 断言安装目录下没有通过 workspace symlink 指回 `/Users/Admin/Desktop/dev-agent` 的 runtime 依赖。

- [x] **Step 2: 运行测试确认失败**
  - Run: `pnpm --filter @agent_cli/cli test`
  - Expected: 当前 tarball 因私有包、workspace 依赖或缺少独立入口无法完成 clean install/smoke。

- [x] **Step 3: 实现 package smoke command**
  - 添加一个不会发布、不会改写用户目录的本地验证脚本。
  - 使用固定临时目录、`--no-audit`、`--no-fund` 和明确的退出码；避免把模型 API 请求纳入 package smoke。
  - 将 smoke 接入 TypeScript release gate 或独立的 package phase，并在 CI 中使用相同命令。

- [x] **Step 4: 运行完整 package 验证**
  - Run: `pnpm --filter @agent_cli/cli build`
  - Run: `pnpm --filter @agent_cli/cli build:package`
  - Run: `pnpm package:smoke`（最终命令名以实现为准）
  - Run: `node scripts/release-gate.mjs --typescript`
  - Expected: clean install、外部目录调用、既有 CLI 测试和 release gate 全部通过。

- [ ] **Step 5: 提交独立变更**
  - Commit: `test: verify cli package outside workspace`
## Task 4: 明确 npm scope、版本和正式发布前检查

**Files:**
- Create: `docs/release-cli-npm.md` 或合并到 `apps/cli/README.md`
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/CHANGELOG.md`
- Test: `tests/documentation-contract.test.mjs`（若现有文档 contract 覆盖 release 文档）

**Interfaces:**
- Consumes: Task 1–3 的 package、smoke 和 release evidence。
- Produces: 维护者可复核的发布清单；不自动执行远程发布。

- [x] **Step 1: 记录发布前置条件**
  - 确认 `npm whoami` 返回预期账号。
  - 确认账号拥有 `@dev-agent` scope，或在发布前改用已确认可用的包名。
  - 确认版本号、CHANGELOG、README 安装命令和 package metadata 一致。
  - 确认 `npm pack --dry-run` 的文件清单没有源码密钥、workspace 引用、测试产物或绝对本地路径。

- [x] **Step 2: 写发布文档失败测试**
  - 检查文档不会把“npm 已认证”错误地写成“已经公开发布”。
  - 检查文档包含从任意目录安装和运行的命令、provider 前置条件、session 隔离说明和可选 Rust runtime 说明。

- [x] **Step 3: 更新用户文档**
  - 同时记录开发态调用：`node /path/to/repo/apps/cli/dist/index.js`。
  - 记录正式安装态调用：`npm install -g @agent_cli/cli` 后从目标项目执行 `dev-agent`。
  - 明确 `pnpm cli` 仍然是 workspace 开发脚本，不是最终用户的全局命令。
  - 明确 Ollama/API key、`rg`、目标目录权限、Git 能力和 Rust sandbox 的区别。
  - 明确同一用户下多个项目应使用不同 `--session` 或 `DEV_AGENT_SESSION_DIR`。

- [x] **Step 4: 运行文档和静态验证**
  - Run: `node --test tests/documentation-contract.test.mjs`
  - Run: `git diff --check`
  - Expected: 文档示例与 package metadata、命令名和当前行为一致。

- [ ] **Step 5: 提交独立变更**
  - Commit: `docs: document npm cli distribution`
## Task 5: 处理项目级 config/session 隔离

**Files:**
- Modify: `apps/cli/src/config.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/tests/config-file.test.ts`
- Modify: `apps/cli/tests/session-dir.test.ts`
- Modify: `apps/cli/README.md`

**Interfaces:**
- Consumes: Task 2 最终工作目录和现有 `--session`/`DEV_AGENT_SESSION_DIR` 行为。
- Produces: 可选择的项目级 config/session 路径，同时保持现有用户级默认值兼容。

- [x] **Step 1: 先固定兼容性规则**
  - 现有 `~/.dev-agent/config.json` 和 `~/.dev-agent/sessions` 继续可用。
  - 明确新增选项的优先级，例如 `--config` > `DEV_AGENT_CONFIG_FILE` > 用户级默认 config。
  - 明确 session 不得因为 `--cwd` 改变而静默覆盖既有 `default` session；自动 project-key 命名需要显式开关或单独迁移策略。

- [x] **Step 2: 写隔离行为的失败测试**
  - 两个项目可以分别指定 config 文件和 session 目录，读取/写入互不覆盖。
  - 一个显式 `--session` 在不同工作目录下仍保持原有语义，不发生隐式重命名。
  - `DEV_AGENT_MEMORY_FILE` 的单文件优先级和文档说明保持一致。

- [x] **Step 3: 实现最小项目级选择能力**
  - 增加可测试的 config 路径解析，不再把路径硬编码在 `loadConfig()` 内部。
  - 如果新增 CLI flag，加入统一参数验证和 `--json` 错误契约。
  - 暂不自动迁移旧 session；先提供显式、可回滚的项目级选择。

- [x] **Step 4: 运行隔离回归**
  - Run: `pnpm --filter @agent_cli/cli test`
  - Expected: 用户级默认、项目级显式配置、session list/metadata/compact/delete/rename 行为均通过。

- [ ] **Step 5: 提交独立变更**
  - Commit: `feat: support project-scoped cli state`
## Task 6: Rust sandbox 的 npm 发布边界

**Files:**
- Modify: `apps/cli/README.md`
- Modify: `README.md`
- Modify: `runtime/rust/README.md`
- Modify: `.github/workflows/release.yml`
- Modify: `apps/cli/src/doctor.ts`（仅在状态信息需要澄清时）
- Test: `apps/cli/tests/rust-health-check.test.ts`、release workflow contract

**Interfaces:**
- Consumes: 当前 `--rust-executor`/`DEV_AGENT_RUST_BINARY` 解析和已有四平台 Rust archive。
- Produces: 基础 npm CLI 与可选 sandbox runtime 的清晰、可验证边界。

- [x] **Step 1: 写边界测试/contract**
  - 没有 Rust binary 时，基础 CLI 仍能运行并明确显示 LocalExecutor/未沙箱状态。
  - 显式 Rust binary 路径仍经过 doctor health check。
  - npm package 不假设某一个 macOS 架构 binary 一定存在，也不把 Windows 误写成已支持。

- [x] **Step 2: 实现基础发布边界**
  - 第一次 npm 发布只保证 JavaScript CLI；文档明确 sandbox 是可选安装项。
  - release archive 继续提供已支持 target 的 Rust binary、checksum 和使用说明。
  - 不在没有签名、checksum、升级和失败回滚设计前加入自动下载 postinstall。

- [x] **Step 3: 评估是否需要完整 parity**
  - 本轮不新增 Rust parity 计划：基础 npm CLI 的可选 runtime 边界已经明确，自动下载、签名校验、升级/回滚和 Windows sandbox 仍保留为后续独立设计。

- [x] **Step 4: 运行 Rust 和 workflow contract**
  - Run: `node --test tests/release-workflow.test.mjs tests/ci-workflow.test.mjs`
  - Run: `pnpm verify:rust`
  - Expected: Rust runtime 的可选边界和现有 release artifacts 没有回归。

## 实施结果（2026-09-16）

本计划已按上述边界完成实现，当前发布候选物具备以下能力：

- `@agent_cli/cli` 产出自包含的 `dist/cli.js`，通过 `dev-agent` bin 暴露；内部 workspace 包不作为 npm runtime 依赖发布。
- 支持 `--cwd`、`--config` 以及对应环境变量，从任意外部项目目录执行 `--index`、工具列表和 JSON 输出。
- 已加入隔离临时目录中的 tarball 安装 smoke test，并接入本地 release gate、CI 和 GitHub Release artifact 构建。
- 已补充 npm scope/版本/认证、provider、session/config、可选 Rust sandbox 和 Windows 当前边界文档。
- 已验证：`pnpm check`、`pnpm build`、`pnpm typecheck`、`pnpm test`、`pnpm package:smoke`、`pnpm verify`、`pnpm verify:rust` 均通过。
- 本次先确认 npm `agent_cli` organization 的 owner 权限，将公开包名从预留的
  `@agent-cli/cli` 修正为 `@agent_cli/cli`，随后在维护者明确授权后成功发布
  `@agent_cli/cli@0.1.2`；没有创建 release tag 或 GitHub Release。

> 说明：各 Task 的“提交独立变更”仍保持未勾选，因为本次只完成工作区实现与验证，没有在用户未明确要求时创建提交。

## 验收标准

### 基础 npm CLI

以下流程必须在一个不属于本仓库、且没有 workspace symlink 的临时环境中通过：

```bash
npm pack
npm install -g ./agent_cli-cli-<version>.tgz
cd /path/to/other-project
dev-agent --version
dev-agent --tools
dev-agent --cwd /path/to/other-project --index . --json
dev-agent --session other-project --once "列出当前目录的文件"
```

验收要求：

- `dev-agent` 能从任意当前目录启动；
- 文件系统、shell、git、search、code-search 使用目标项目目录；
- 安装后的运行不依赖 `/Users/Admin/Desktop/dev-agent` 或其他开发机绝对路径；
- package metadata 没有 `private: true` 或未解析的 `workspace:*` runtime 依赖；
- `--json` 仍然是单一可解析 JSON 文档；
- 无模型请求的命令不需要 API key；需要模型的命令按 provider 文档失败或运行；
- session/config 的默认兼容行为和显式项目隔离行为都有测试覆盖。

### 可选 Rust sandbox

- 不安装 Rust runtime 时，基础 CLI 可用，但 doctor 明确报告未沙箱；
- 显式提供匹配平台的 `dev-agent-executor` 后，`--check-rust` 和真实工具路径通过；
- 发布物和文档只声明已经验证的 macOS/Linux target；
- 未完成自动下载和签名策略前，不把 Rust runtime 宣称为 npm 包的自动能力。

### 发布闸门

正式 `npm publish` 前必须全部通过；本次 `@agent_cli/cli@0.1.2` 发布已于
2026-09-16 按这组闸门完成：

```bash
pnpm check
pnpm build
pnpm typecheck
pnpm test
pnpm package:smoke
pnpm verify
```

具体命令名若在实现中调整，必须同步更新本文件、根 README、CLI README 和
release gate contract。上述命令用于验证本地发布候选物；后续版本发布前仍必须
重新运行。npm registry 发布、release tag 和 GitHub Release 仍需分别按照维护者
授权执行；本计划本次仅完成 npm 包发布，未创建 tag 或 GitHub Release。

## 非目标与后续决策

- 不在本计划中更换 OpenAI、Anthropic、Gemini 或 Ollama provider。
- 不在本计划中重写 agent loop、tool contract、MCP protocol 或 session schema。
- 不在 npm 包内默认携带某个平台的 Rust binary。
- 是否将默认 session 自动按工作目录命名、是否发布内部 `@dev-agent/*` 包、是否提供 Windows sandbox，需在兼容性和供应链方案明确后另行决策。


## 后续补充：0.1.3 项目状态隔离发布（2026-09-16）

在维护者明确授权后，基于本计划已验证的 npm bundle 发布补丁版本
`@agent_cli/cli@0.1.3`。该版本包含显式 `--project-state`，并已通过完整固定 gate、clean
install smoke 和 registry 复核；本次仍未创建 Git tag 或 GitHub Release。

## 后续补充：0.1.4 session metadata 修复发布（2026-09-16）

在维护者明确授权后，将 `@agent_cli/cli` 从 `0.1.3` 升级并发布为 `@agent_cli/cli@0.1.4`。该版本修复了指定
`--session <id>` 时新建/更新 memory metadata 仍保留 `sessionId: "default"` 的问题，并
通过完整固定 gate、package smoke、registry 复核和全局安装后的
`dev-agent --session smoke --metadata --json` 验证；`smoke.json` 的 `sessionId` 为
`smoke`。本次仍未创建 Git tag 或 GitHub Release。

## 后续补充：0.1.5 provider/index/MCP/Desktop 发布（2026-09-17）

在维护者明确授权后，将 `@agent_cli/cli` 升级并发布为 `@agent_cli/cli@0.1.5`。该版本包含
v0.1.5–v0.4.0 的项目初始化、runtime distribution、review/plan/apply、provider/model、
索引、MCP 管理和 Desktop 状态能力；npm registry `latest` 指向 `0.1.5`。本次仍未创建 Git
tag 或 GitHub Release。

## 后续补充：0.1.6 GitHub Release tarball 发布（2026-09-17）

`v0.1.6` GitHub Release 中的 `agent_cli-cli-0.1.6.tgz` 已发布到 npm，`latest` 指向
`@agent_cli/cli@0.1.6`。发布前核对下载 tarball 的 SHA-256 与 GitHub release asset digest；当前工作区
`@agent_cli/cli@0.1.7` candidate 包含未发布的 doctor metadata 收紧和 Desktop managed runtime status。
