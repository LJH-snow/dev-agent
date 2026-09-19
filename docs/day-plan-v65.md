# dev-agent 开发计划 v65：方案 A：Desktop / CLI 工作台体验打磨

**建立日期：2026-09-19**

**当前状态：已完成；本计划只覆盖体验层打磨，不改变模型、工具权限或发布边界。**

## Goal

在已有 Desktop 工作台和 npm CLI 能力之上，完成一轮可验证的体验打磨：

- Desktop 形成稳定的三栏工作台层级，支持浅色、深色和跟随系统主题；
- Desktop 的运行状态在空闲、运行、完成和错误时有清晰且低干扰的视觉反馈；
- Desktop 在中等宽度和移动宽度下保持可用，不出现横向溢出；
- CLI rich TTY 延伸 `SIGNAL WEAVE` 视觉语言，让工具、审批和验证事件更容易扫描；
- 非交互、管道和 JSON 输出保持原有机器可读契约不变。

## Scope

### Included

- `apps/desktop/public/index.html`
- `apps/desktop/public/styles.css`
- Desktop HTML smoke contract
- `apps/cli/src/tui-renderer.ts`
- CLI TTY renderer tests
- 本地浏览器和真实 TTY 验收

### Explicitly excluded

- 不新增原生 macOS `.app` 打包；
- 不修改 provider、executor、MCP 或审批语义；
- 不改变 npm 包入口、JSON schema 或非 rich 输出；
- 不把视觉装饰扩展为营销型 landing page。

## Design

### Desktop

1. 保留左侧 session rail、中间 conversation、右侧 runtime inspector 的工作台结构。
2. 在顶部加入主题控制，支持 `system`、`light`、`dark`，并使用 `localStorage` 记住用户选择。
3. 为状态指示器增加 `active`、`ready`、`error` 状态，运行时用轻量 pulse 表示正在工作。
4. 维持中等宽度 Inspector 折叠控制；移动端改为纵向布局，保证输入区和发送按钮可见。

### CLI

1. 复用 `SIGNAL WEAVE` 的字符和色彩语言，不引入新的终端框架。
2. 在 tool call、tool result、approval、validation rich block 前加入宽度受控的 `SIGNAL WEAVE` 分隔线。
3. 所有标签先经过现有终端清理、敏感信息脱敏和宽度裁剪。
4. 只在 rich TTY 路径使用分隔线，保持 `--json`、管道和非交互输出不变。

## Execution Steps

- [x] 先为 Desktop 主题控制和 CLI 信号分隔线补充失败优先测试。
- [x] 实现 Desktop 主题状态、持久化和状态指示器。
- [x] 实现 CLI `renderSignalDivider` 并接入 rich semantic blocks。
- [x] 运行 Desktop 全套测试和 CLI 全套测试。
- [x] 用真实浏览器验证桌面、800px 中等宽度和 390px 移动宽度。
- [x] 用真实交互式 TTY 验证欢迎屏、`:model` 和 `:quit`。
- [x] 记录验收结果和后续边界。

## Acceptance Checklist

- [x] Desktop 测试全部通过。
- [x] CLI 测试全部通过。
- [x] 主题切换可用，刷新后选择仍保留。
- [x] 浏览器控制台无错误或警告。
- [x] 390px 宽度无横向溢出，输入区和发送按钮可用。
- [x] 800px 宽度 Inspector 可展开。
- [x] CLI 分隔线在窄终端宽度内不会超宽。
- [x] CLI rich TTY 仍能启动、显示状态并退出。
- [x] 非 rich 输出和已有 doctor/npm 改动未被视觉改造覆盖。

## Decision Boundary

方案 A 已完成，结论为 **体验打磨完成，可继续使用当前本地 Desktop 和 npm CLI**。

本计划不表示已有原生 macOS `.app` 安装包；Desktop 当前仍以本地 Web 工作台方式运行。
若后续需要真正的桌面安装包，应另立计划处理原生壳、签名、打包和更新机制。
