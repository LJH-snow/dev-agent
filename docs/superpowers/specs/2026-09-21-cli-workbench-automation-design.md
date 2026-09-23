# CLI Workbench Automation Design

**Date:** 2026-09-21
**Status:** Implemented and verified

## Goal

继续把 Ink 交互界面完善成一个适合长期开发工作的本地编码工作台，补齐文件路径补全、会话导出、失败重试、MCP 进度反馈和主题持久化。

## User-visible behavior

### 1. 文件路径智能补全

- 在输入中出现 `@` 后，按当前工作区扫描可读的文件和目录。
- 只展示工作区内的相对路径，不允许通过补全把用户带出工作区。
- 默认忽略 `.git`、`.dev-agent`、`node_modules`、缓存目录和隐藏构建产物。
- 扫描有深度、条目数和名称长度上限；不可读、符号链接逃逸和超限条目静默跳过。
- 输入 `@src/`、`请检查 @package` 等形式时都能匹配。
- Tab 选择第一个匹配项；上下键选择匹配项；Esc 关闭补全；补全不会改变普通命令建议。
- 文件补全只填入路径文本，不自动读取文件；现有 `resolvePromptContext` 继续负责提交时的安全解析。

### 2. 会话导出

- 交互命令：
  - `:export` 或 `/export`：导出 Markdown。
  - `:export markdown`：导出 Markdown。
  - `:export json`：导出 JSON。
- 默认写入 `<workingDirectory>/.dev-agent/exports/`。
- 文件名包含 session id 和 UTC 时间戳，并经过安全清理。
- 导出的内容只包含已持久化的会话条目；内容经过终端控制字符清理和敏感信息脱敏。
- 导出有条目数和单条内容上限，不接受任意输出路径，避免交互命令成为路径穿越入口。
- ANSI 和 Ink 两种交互模式都支持，成功后给出相对工作区路径。

### 3. 失败重试

- Ink 运行失败后显示错误摘要和 `[r] Retry · :retry · esc dismiss`。
- 空输入时按 `r` 重试最近一次真实 prompt；`:retry` 也可触发。
- Esc 只关闭重试提示，不关闭整个会话；再次失败会替换为最新错误。
- 重试不会把同一次按键重复提交到队列，也不会在 UI 中重复渲染一份失败 prompt。
- 没有可重试运行时，`:retry` 给出明确提示。

### 4. MCP 工具实时进度

- 继续使用现有 Runtime Event / MCP progress 通道，不新增第二套传输协议。
- Tool card 保存最近一次 numeric progress 和可选 total。
- Ink 工具时间线显示进度条、百分比和 detail；未知 total 时显示已完成计数。
- 进度更新原地刷新同一张卡，不创建重复卡片。
- 进度值会被限制在合理范围，避免异常 MCP 服务破坏终端布局。

### 5. 持久化主题

- `:theme signal|mono|ember` 立即切换并写入配置。
- 启动时读取已有 CLI config；环境变量 `DEV_AGENT_THEME` 优先于配置，配置优先于默认 `signal`。
- `--project-state` 使用 `<workingDirectory>/.dev-agent/config.json`，否则使用用户级 `~/.dev-agent/config.json`。
- 写配置时保留其他字段，使用临时文件加 rename 的原子写入方式。
- 配置校验接受 `theme`，非法值返回稳定诊断。
- 非 Ink 模式继续以兼容的文本提示运行，不要求渲染颜色主题。

## Architecture

### Boundaries

- `path-completion.ts`：纯路径扫描和匹配逻辑；不依赖 React，不读取文件内容。
- `session-export.ts`：命令解析、格式化、边界控制和原子写入。
- `InkRuntimeStore`：保存 retry 状态；`InkCliApp` 只负责键盘和展示。
- `TuiSessionModel`：保存 ToolCard 的 numeric progress；`ToolTimeline` 负责视觉呈现。
- `config.ts` / `theme-preferences.ts`：主题解析和持久化；启动及 `:theme` 命令负责调用。

### Security and resource limits

- 所有路径都按解析后的工作区根目录校验；禁止绝对路径、`..` 逃逸、NUL 字节和真实路径逃逸。
- 扫描最多 2,000 个候选条目、深度 8、单项 160 个 Unicode 字符、结果 12 项。
- 导出最多 500 条记录、每条 16,000 个 Unicode 字符、总输出 2 MiB。
- 导出和配置写入都通过临时文件加 rename 完成，并创建目标父目录。
- 渲染前对不可信文本使用项目现有 `sanitizeTerminalText` / `redactSensitiveText`。

## Compatibility

- Node.js `>=20`。
- 不新增 npm 依赖。
- 现有 ANSI、JSON、非交互模式保持行为不变。
- 现有会话内存格式不变，只新增读取和导出能力。
- MCP 进度接口沿用已有 `tool.progress` Runtime Event。

## Verification

- 新增每个模块的单元测试，先写失败测试再实现。
- Ink 键盘测试覆盖 `@` 补全、Tab、Esc、`r` 和 `:retry`。
- TUI session 测试覆盖 progress 的原地更新和边界限制。
- CLI config 测试覆盖环境变量、用户级/项目级路径、原子持久化和非法主题。
- 最后运行 CLI 全量测试、相关 agent-core/MCP 测试、TypeScript 检查和 `git diff --check`。

### 实际验证结果

- CLI focused workbench suite：90 项通过。
- `pnpm --filter @agent_cli/cli test`：508 项通过，0 项失败。
- CLI tarball/package smoke 与 manifest：5 项通过，可在工作区外安装运行，且无未解析的 workspace runtime dependency。
- `pnpm --filter @dev-agent/agent-core test`：176 项通过，0 项失败。
- `pnpm --filter @dev-agent/mcp test`：70 项通过，0 项失败。
- `pnpm --filter @agent_cli/cli typecheck` 与 `git diff --check`：通过。
