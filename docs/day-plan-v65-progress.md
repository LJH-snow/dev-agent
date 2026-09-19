# v65 开发进度：方案 A：Desktop / CLI 工作台体验打磨

> 最后更新：2026-09-19
>
> 当前阶段：已完成 Desktop / CLI 体验验收；未改变 provider、executor、MCP、
> 审批和非交互输出契约。

## RED-to-GREEN 记录

### RED

先加入两个行为契约，再实现：

- Desktop 页面必须暴露主题根节点和主题切换控件；
- CLI renderer 必须导出宽度受控的 `renderSignalDivider`。

首次运行时：

- Desktop 测试因缺少 `theme-toggle` 和 `data-theme` 断言失败；
- CLI 测试因 `renderSignalDivider` 尚未实现而编译失败。

### GREEN

完成最小实现后，相关检查全部通过：

- Desktop 全套测试：**132 passed / 0 failed**；
- CLI 全套测试：**340 passed / 0 failed**；
- `git diff --check`：通过；
- CLI rich TTY：欢迎屏、`:model`、`:quit` 均正常。

## Browser Evidence

使用本地 Chrome 对 `http://127.0.0.1:4317/` 做真实页面检查：

- 初始系统主题正确应用，页面标题为 `dev-agent`；
- 点击主题按钮后切换为深色主题，按钮状态和可访问名称同步更新；
- 刷新页面后深色主题仍然保留；
- 800px 宽度下 Inspector 按钮可由 `Inspector` 变为 `Hide inspector`；
- 390px 宽度下页面宽度与视口一致，没有横向溢出；
- 移动端输入区和 `Send` 按钮可见；
- 浏览器控制台无 error 或 warning。

截图证据：

- `/tmp/dev-agent-desktop-polish-light.png`
- `/tmp/dev-agent-desktop-polish-dark.png`
- `/tmp/dev-agent-desktop-polish-medium.png`
- `/tmp/dev-agent-desktop-polish-mobile.png`

## TTY Evidence

真实交互式 TTY 已确认：

- 欢迎屏显示 `SIGNAL WEAVE`、provider、model、session 和工作目录；
- `:model` 显示 `SIGNAL RAIL`、provider、model 和 streaming transport；
- `:quit` 正常退出；
- renderer 单元测试确认分隔线在宽度 24 的终端中不超宽。

## Current Decision

**GO：方案 A 体验打磨完成。**

当前可直接打开本地 Desktop：

`http://127.0.0.1:4317/`

它是本地 Web 工作台，不是已经打包签名的 macOS 原生应用。原生 `.app`
仍需要单独的 macOS packaging 计划。
