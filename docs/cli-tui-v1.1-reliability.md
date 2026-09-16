# CLI Modern TUI v1.1：流式与输入可靠性

**建立日期：2026-09-14**

**文档状态：已完成**

## 背景

CLI Modern TUI v1 已经把 rich presentation 接入真实 TTY，但实际 PTY 审查发现两类影响
日常使用的可靠性问题：readline 回显与额外的用户消息块重复，以及高频 token 逐 token
完整重绘导致终端写入量和渲染成本快速增长。首 token 之前也缺少明确的等待状态。

## 本阶段目标

- 保留 readline 的正常输入编辑能力，但不再重复打印同一条用户输入；
- 在请求等待首 token 时显示可清理的 `Thinking…` 状态，成功、工具调用、失败、取消后都
  不残留；
- 将流式回答重绘限制在可控频率，`finish()` 强制刷新最后内容，保证不丢字符；
- 保持现有 `--json`、`--once`、`--mcp-server`、pipe/CI、审批、验证和 session memory
  语义不变；
- 保持轻量 Markdown，包括未闭合 fenced code 在流式过程中也可见。

## 范围

### 包含

- `apps/cli/src/tui-stream.ts` 的节流和最终刷新；
- `apps/cli/src/index.ts` 的 rich-only Thinking 生命周期与输入回显策略；
- CLI 纯单元测试、交互回归测试和可重复的 PTY smoke/测试边界记录；
- README、CHANGELOG 和实现计划同步。

### 不包含

- 不引入第三方终端框架；
- 不重写 readline 为 raw-mode 编辑器；
- 不在本阶段实现命令 Tab 补全、鼠标、alternate screen、窗口 resize；
- 不修改 provider 协议、工具 schema、审批策略、MCP stdio、JSON 输出或 session schema。

## 设计约束

1. rich UI 仍只在 stdin/stdout 都是 TTY 且不是 `--json`、`--once`、`--mcp-server` 时启用。
2. line-mode 与 JSON 模式继续使用现有直接输出路径，不生成 TUI 控制序列。
3. `LiveAssistantRenderer` 的输出写入器可注入，节流时钟可测试；`finish()` 是唯一的最终
   提交边界。
4. Thinking 状态必须有明确的清除路径：首 token、tool call、tool result、正常完成、
   异常、Ctrl-C。

## 验收标准

- rich PTY 中输入文本只显示一次，不同时出现输入回显和重复的 `You` 块；
- 请求等待期间能看到 `Thinking…`，首 token/工具/结束/错误/取消后不残留；
- 高频 token 不导致每个 token 都触发完整渲染，结束时回答首尾内容完整；
- 未闭合代码围栏在回答生成过程中可见，闭合后不重复、不丢失；
- CLI 全量测试、TypeScript gate、documentation contract、`git diff --check` 通过；
- PTY 回归覆盖 rich welcome、Thinking、stream、输入回显和 Ctrl-C；纯渲染 smoke 覆盖
  `:help`、`:model`、`:clear` 和 `:quit`；不创建 release tag 或 GitHub Release。

## 验证记录

- CLI 全量测试：**138/138 passed**；其中 rich TTY 测试由 `expect` 直接驱动真实控制
  终端，避免依赖 `interact` 转发 pipe 输入。
- TypeScript build、测试编译和现有 workspace gate 通过；documentation contract 为
  **2/2**，`git diff --check` 通过。
- 流式 renderer 的节流、`finish()` 最终刷新、未闭合 fenced code 可见性均有确定性单元
  测试；line-mode、JSON、`--once`、`--mcp-server` 和 pipe 路径继续走原有输出分支。
- `NO_COLOR=1` 在 rich TTY 中只关闭颜色 ANSI；光标移动、清行和重绘所需的控制序列仍会
  保留。需要完全无终端控制序列的 transcript 时，应使用 pipe、`--once` 或 `--json`。
