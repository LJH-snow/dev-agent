# CLI 运行信息与响应耗时

**建立日期：2026-09-14**

**文档状态：已完成（2026-09-14）**

## 目标

让 CLI 用户在启动和每次请求结束后都能确认当前使用的模型、流式状态以及响应延迟，避免把本地模型预热或上下文处理误认为 CLI 没有流式输出。

## 行为契约

### 人类可读模式

进入真正的交互或 `--once` 请求前打印一行运行信息：

```text
[runtime] provider=<provider> model=<model> streaming=enabled|disabled
```

每次请求结束后打印一行耗时信息：

```text
[timing] first-token=<毫秒数>ms total=<毫秒数>ms
```

当请求使用 `--no-stream`、`--json` 或没有收到可见 token 时，`first-token` 使用 `n/a`；`total` 仍然记录从请求开始到 agent run 结束的耗时。

### JSON 模式

不向 stdout 插入运行信息或耗时文本，保持 stdout 为单个 JSON 文档，避免破坏脚本调用方。

### 边界

- 不改变 provider 或 model 的解析顺序。
- 不改变 Ollama/OpenAI/Anthropic/Gemini 的请求协议。
- 不把耗时或展示信息作为执行、审批、验证或记忆状态的一部分。
- 使用单调时钟计算耗时，不暴露密钥或完整 prompt。

## 验收标准

- CLI 人类模式显示实际 provider、model 和 streaming 状态。
- 流式请求报告数值化首 token 延迟；非流式请求报告 `first-token=n/a`。
- JSON 输出仍可被 `JSON.parse` 直接解析。
- CLI 测试、TypeScript 检查和现有固定验证保持通过。

## 实现证据

- CLI suite：**120/120** 通过，包含非流式与流式 runtime/timing contract。
- CLI build、structure check 和 documentation contract **2/2** 通过；`pnpm verify:typescript` 的全部选定 gate 通过。
- 人类模式输出不会把流式回答与 `[turn N]` 标记粘在同一行。
- JSON 模式继续只输出单个 JSON 文档。
- 本阶段不创建 release tag 或 GitHub Release。
