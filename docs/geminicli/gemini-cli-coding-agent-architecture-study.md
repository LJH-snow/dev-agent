# Gemini CLI 技术架构、实现技术与设计思想研究笔记

> 版本：2026-09-20
>
> 用途：本文件用于提供给正在开发 Coding Agent / Agent Platform 的编码模型，作为“架构参考资料”，而不是要求照搬 Gemini CLI。
> 官方仓库：https://github.com/google-gemini/gemini-cli

---

## 0. 阅读说明：应该“借鉴”，而不是“复制”

Gemini CLI 是一个成熟的开源 Coding Agent。它适合用来研究：

- Coding Agent 如何分层
- Agent Runtime 如何组织
- Tool Registry 如何设计
- 文件 / Shell / Web 工具如何接入
- MCP 如何发现、注册、调用
- Permission / Policy 如何控制工具
- Sandbox 如何隔离工具执行
- Context / Prompt / Session 如何组织
- Skills / Hooks / Extensions 如何扩展
- CLI UI 如何与 Agent Runtime 解耦
- IDE / ACP / A2A 等外部集成如何接入

不要把 Gemini CLI 的当前目录结构机械复制到新项目。应抽象其设计原则，再结合当前项目已有代码进行重构。

---

# 1. Gemini CLI 的定位

Gemini CLI 的官方定位是：

> 一个 terminal-first、可扩展的开源 AI Agent，用于代码理解、代码生成、自动化以及 MCP 集成。

它不是简单的：

```text
用户 -> LLM -> 文本回答
```

而是：

```text
用户
  ↓
CLI / Client
  ↓
Agent Runtime
  ↓
Model
  ↓
Tool Call
  ↓
Tool Execution
  ↓
Tool Result
  ↓
Model
  ↓
...
  ↓
Final Answer
```

因此研究 Gemini CLI 时，应把它理解成：

```text
Terminal UI
+
Agent Runtime
+
Tool System
+
Context / Prompt System
+
Permission / Policy
+
Sandbox
+
MCP
+
Session / Checkpoint
+
Skills / Extensions / Hooks
+
Observability
+
IDE / Protocol Integration
```

---

# 2. 核心技术栈

Gemini CLI 当前主要使用：

| 层 | 技术 |
|---|---|
| 主要语言 | TypeScript |
| Runtime | Node.js >= 20 |
| CLI UI | React + Ink |
| 包管理 | npm workspaces |
| Monorepo | npm workspaces |
| 构建 / Bundle | esbuild |
| 测试 | Vitest |
| 类型检查 | TypeScript |
| Lint | ESLint |
| Format | Prettier |
| Terminal PTY | node-pty |
| Git | simple-git |
| Schema / 数据验证 | Zod 等 |
| MCP | `@modelcontextprotocol/sdk` |
| ACP | Agent Client Protocol |
| Agent-to-Agent | A2A |
| Observability | OpenTelemetry 相关能力 |
| Sandbox | Docker / Podman / macOS Seatbelt / LXC / Windows 原生等，具体取决于平台和配置 |
| Code / Syntax 相关能力 | Tree-sitter 等 |
| Web / Browser 能力 | Web / Browser 工具及相关依赖 |
| UI React 版本 | 当前仓库使用 React 19 系列 |

官方项目上下文明确列出 TypeScript、Node.js、React + Ink、Vitest、esbuild、ESLint、Prettier，以及 npm workspaces monorepo 架构。

注意：依赖和目录会随版本变化。本文件描述的是 2026-09-20 左右官方仓库可以观察到的架构，不应视为永久不变的 API。

---

# 3. 顶层架构

可以把 Gemini CLI 抽象成：

```text
                         User
                          │
                          ▼
                 ┌─────────────────┐
                 │    CLI / UI     │
                 │ React + Ink     │
                 └────────┬────────┘
                          │
                          ▼
                 ┌─────────────────┐
                 │ Agent Runtime   │
                 │ packages/core   │
                 └────────┬────────┘
                          │
            ┌─────────────┼──────────────┐
            │             │              │
            ▼             ▼              ▼
          Model         Context        Policy
            │             │              │
            │             │              │
            └─────────────┼──────────────┘
                          │
                          ▼
                    Tool Registry
                          │
          ┌───────────────┼────────────────┐
          │               │                │
          ▼               ▼                ▼
       Filesystem        Shell            Web
          │               │                │
          └───────────────┼────────────────┘
                          │
                     MCP / Extensions
                          │
                          ▼
                       Sandbox
                          │
                          ▼
                    Host / Workspace
```

核心思想：

**UI 不应该等于 Agent Runtime。**

CLI UI 负责：

- 输入
- 输出
- 交互
- diff 展示
- tool confirmation UI
- 状态显示

Core / Agent Runtime 负责：

- model orchestration
- prompt
- context
- tools
- tool execution
- agent lifecycle
- policy
- MCP
- session
- retry / fallback
- telemetry
- safety

这样未来可以复用同一个 Agent Runtime：

```text
              Agent Core
                  │
       ┌──────────┼──────────┐
       ▼          ▼          ▼
      CLI        Web       Desktop
```

---

# 4. Monorepo 设计

Gemini CLI 使用 npm workspaces 组织 monorepo。

核心 package 可以理解为：

```text
gemini-cli/
│
├── packages/
│   ├── cli/
│   ├── core/
│   ├── a2a-server/
│   └── 其他 package
│
├── integration-tests/
├── memory-tests/
├── evals/
├── scripts/
├── docs/
└── package.json
```

其中最值得研究的是：

```text
packages/cli
packages/core
```

---

# 5. packages/cli：Terminal UI 层

`packages/cli` 是用户直接看到的部分。

它负责：

- Terminal 输入
- Terminal 输出
- React / Ink UI
- command
- prompt input
- tool confirmation UI
- diff 展示
- loading / progress
- session UI
- 状态显示
- IDE / ACP 等客户端交互入口

技术：

```text
TypeScript
+
React
+
Ink
+
Node.js
```

---

# 6. Ink 是什么？

Ink 是 Node.js 生态中的 Terminal UI framework。

它允许：

```text
React component model
        ↓
Ink renderer
        ↓
Terminal
```

也就是说，它不是：

```text
React -> Browser -> DOM
```

而是：

```text
React -> Ink -> Terminal
```

因此 Coding Agent CLI 可以使用 React 的：

- component
- state
- props
- hooks
- render
- composition

来构造复杂的终端界面。

例如概念上：

```tsx
<Box flexDirection="column">
  <Text>Agent</Text>
  <Text>Reading package.json...</Text>
  <Text>✓ Tool completed</Text>
</Box>
```

这比直接使用：

```js
process.stdout.write(...)
ANSI escape code
cursor movement
```

更容易维护。

### 对自己的 Agent 项目的启示

如果项目需要：

```text
CLI
+
动态状态
+
Tool Call 展示
+
Diff
+
Permission Dialog
+
Progress
```

那么 TypeScript + React + Ink 是一个值得考虑的 CLI UI 技术路线。

但是：

**Ink 只是 UI，不是 Agent Framework。**

---

# 7. packages/core：最值得研究的部分

官方 `packages/core/GEMINI.md` 将 core 定义为：

> Gemini CLI 的后端逻辑，包括 API orchestration、prompt construction、tool execution 和 agent management。

当前 core 的目录可以作为 Coding Agent 架构参考：

```text
src/
├── agent/
├── agents/
├── availability/
├── billing/
├── code_assist/
├── commands/
├── config/
├── confirmation-bus/
├── core/
├── fallback/
├── hooks/
├── ide/
├── mcp/
├── output/
├── policy/
├── prompts/
├── resources/
├── routing/
├── safety/
├── scheduler/
├── services/
├── skills/
├── telemetry/
├── tools/
├── utils/
└── voice/
```

这些目录体现了一个成熟 Coding Agent 的模块边界。

---

# 8. Agent Runtime 的核心思想

最核心的模型不是：

```text
prompt -> response
```

而是：

```text
Prompt
  ↓
Model
  ↓
Response
  ↓
Tool Call?
  ├── No → Final Response
  │
  └── Yes
       ↓
   Permission / Policy
       ↓
   Execute Tool
       ↓
   Tool Result
       ↓
   Context Update
       ↓
   Model
       ↓
      ...
```

因此一个最小 Agent Loop 可以抽象为：

```python
while True:
    response = model.generate(context, tools)

    if response.is_final:
        return response

    if response.has_tool_call:
        result = execute_tool(response.tool_call)
        context.append(response)
        context.append(result)
```

成熟实现还需要增加：

```text
retry
fallback
context compression
loop detection
tool confirmation
policy
timeouts
cancellation
session
telemetry
```

---

# 9. Tool System：Coding Agent 的“手”

Gemini CLI 使用 Tool Registry 管理工具。

工具让模型从：

```text
只能生成文本
```

变成：

```text
可以操作外部世界
```

典型工具：

```text
File Read
File Write
File Edit
Shell
Search
Web
MCP
```

官方工具文档明确指出，ToolRegistry 管理可用工具；工具执行会经过安全策略，修改文件或执行 shell 等 mutator 工具通常需要用户确认。

---

# 10. Tool Registry 的设计思想

不要把 Agent 写成：

```python
if tool == "read":
    ...
elif tool == "write":
    ...
elif tool == "shell":
    ...
```

而应该：

```text
ToolRegistry
   │
   ├── ReadFileTool
   ├── WriteFileTool
   ├── EditTool
   ├── ShellTool
   ├── SearchTool
   └── MCPTool
```

每个 Tool 应该具有类似：

```text
name
description
input schema
execute()
confirmation policy
result formatter
```

例如：

```typescript
interface Tool {
    name: string;
    description: string;
    inputSchema: Schema;

    execute(
        args: unknown,
        context: ToolContext
    ): Promise<ToolResult>;
}
```

这比让 LLM 直接操作操作系统更容易扩展和控制。

---

# 11. Native Tools 与 MCP Tools

一个成熟 Agent 应同时支持：

```text
Native Tools
+
MCP Tools
```

Native：

```text
read_file
write_file
edit_file
shell
search
```

MCP：

```text
GitHub
Database
Browser
Playwright
Custom APIs
```

这样：

```text
                 Tool Registry
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
       Built-in Tools          MCP Tools
```

---

# 12. MCP 的具体架构

Gemini CLI 的 MCP 集成值得重点学习。

官方文档描述的流程：

```text
MCP Configuration
       ↓
Discover Servers
       ↓
Connect
       ↓
Fetch Tool Definitions
       ↓
Validate / Sanitize Schemas
       ↓
Register Tools
       ↓
LLM sees tools
       ↓
Tool Call
       ↓
MCP Server
       ↓
Tool Result
       ↓
LLM
```

支持的 transport 包括：

```text
stdio
SSE
Streamable HTTP
```

MCP server 不仅可以提供：

```text
tools
```

还可以提供：

```text
resources
prompts
```

因此 MCP 在架构上更像：

```text
External Capability Provider
```

而不是简单的“插件”。

---

# 13. Permission / Confirmation / Policy

这是 Coding Agent 非常关键的一层。

不要：

```text
LLM
 ↓
shell
 ↓
OS
```

而应该：

```text
LLM
 ↓
Tool Request
 ↓
Policy
 ↓
需要确认？
 ├── No
 │    ↓
 │ Tool
 │
 └── Yes
      ↓
 User Confirmation
      ↓
 Allow / Deny
      ↓
 Tool
```

Gemini CLI 当前 core 有：

```text
confirmation-bus
policy
safety
```

等模块。

---

# 14. Tool 风险等级思想

可以把工具分为：

### Read-only

```text
list_files
read_file
search
git_status
```

通常风险较低。

### Mutating

```text
write_file
edit_file
npm install
git checkout
```

可能需要确认。

### Dangerous

```text
rm
sudo
修改系统目录
访问敏感凭证
网络攻击类命令
```

需要更严格的 policy。

不要让 LLM 自己决定“这个操作安全吗”。

应该由：

```text
Policy Engine
```

做判断。

---

# 15. Sandbox：不是 Agent，而是执行隔离层

Gemini CLI 的 sandbox 不是：

```text
Rust = sandbox
```

也不是：

```text
Docker = Agent
```

而是：

```text
Tool Execution
      ↓
Sandbox
      ↓
Isolated Environment
```

官方当前 sandbox 文档支持多种后端 / 模式，包括：

```text
macOS Seatbelt
Docker
Podman
LXC
Windows native 等
```

因此设计上应该抽象为：

```text
Sandbox Interface
       │
       ├── DockerSandbox
       ├── PodmanSandbox
       ├── MacSandbox
       ├── WindowsSandbox
       └── LocalSandbox
```

不要把 Agent Runtime 和 Docker 强绑定。

---

# 16. 为什么 Docker 可以作为 Sandbox

Docker 可以提供：

```text
process isolation
filesystem isolation
resource control
network control
reproducible environment
```

典型结构：

```text
Host
│
├── Agent CLI
│
└── Docker Sandbox
     │
     ├── /workspace
     ├── node
     ├── npm
     ├── python
     └── shell
```

项目目录可以作为 workspace mount 到容器中。

这样 Agent 可以：

```text
read
write
npm install
npm test
python
go test
```

但不需要直接获得整个宿主机环境。

---

# 17. 为什么不是“用 Rust 代替 Docker”

这是错误的层级比较：

```text
Docker = container / isolation technology
Rust = programming language
```

正确关系是：

```text
Sandbox
│
├── Docker
├── VM
├── OS sandbox
└── custom runtime
      ↑
      可以用 Rust 实现
```

如果自己用 Rust 做低层 Sandbox，就需要处理：

```text
process
filesystem
namespace
cgroups
seccomp
capabilities
network
PTY
signals
resource limits
```

这实际上是在开发 Runtime / Sandbox 技术。

所以成熟项目通常先使用：

```text
Docker / Podman / OS sandbox
```

而不是重新实现容器运行时。

---

# 18. Gemini CLI 的一个重要设计：Tool-level sandboxing

Gemini CLI 不只考虑：

```text
整个 CLI 进程进入 Sandbox
```

还提供：

```text
Tool-level sandboxing
```

即：

```text
CLI
 │
 ├── UI
 ├── Config
 └── Agent
       │
       ├── Read Tool
       ├── Shell Tool → Sandbox
       ├── Write Tool → Sandbox
       └── MCP Tool
```

这让非工具操作继续使用宿主环境，而真正有副作用的操作进入隔离环境。

这是值得自己的 Agent 平台重点参考的设计。

---

# 19. Sandbox Expansion

实际 Coding Agent 会遇到：

```text
npm install
```

或者：

```text
访问额外目录
```

或者：

```text
访问网络
```

初始 Sandbox 权限可能不够。

Gemini CLI 支持 Sandbox Expansion：

```text
Tool
 ↓
Sandbox execution
 ↓
Permission denied
 ↓
Determine required capability
 ↓
Sandbox Expansion Request
 ↓
User approval
 ↓
Retry with expanded permission
```

这是比“所有东西直接 Docker 放开”更成熟的安全设计。

---

### 当前项目的落地边界

本项目已将这条流程落到共享 Agent Core，而不是复制 Gemini CLI 的目录
结构：

```text
Rust executor denial
        ↓
typed SandboxDeniedError
        ↓
Agent Core capability classification
        ↓
CLI / Desktop approval requester
        ↓
bounded profile expansion
        ↓
retry the same tool call once
```

当前扩权合同有三个刻意限制：

1. 只允许在现有工作区边界不变的情况下开启网络访问。
2. 不接受模型直接提供的绝对路径、策略脚本或任意权限配置。
3. 非交互 CLI、MCP server 和没有可用审批请求器的调用默认拒绝，并把
   拒绝作为普通工具失败返回给模型。

运行时会分别发出 `tool.sandbox-expansion-requested` 和
`tool.sandbox-expansion-resolved` 事件，CLI TUI 也会把它显示成独立的审批
卡片，避免与普通危险命令审批混淆。这个边界保留了未来增加路径扩权、
容器后端或更细能力分类的接口，但当前不为尚未需要的后端引入复杂度。

# 20. Context / Prompt System

成熟 Coding Agent 不会每轮都把整个项目塞给模型。

需要：

```text
System Prompt
+
User Prompt
+
Workspace Context
+
Relevant Files
+
Tool Results
+
Previous Turns
+
Task State
```

抽象：

```text
Context Manager
      │
      ├── System instructions
      ├── User task
      ├── File context
      ├── Tool result
      ├── History
      ├── Summary
      └── Compression
```

这部分是 Coding Agent 的核心竞争力之一。

---

# 21. Prompt 应该模块化

不要一个 5000 行字符串：

```text
SYSTEM_PROMPT = "...."
```

而应该：

```text
prompts/
├── base
├── coding
├── tools
├── safety
├── planning
├── skills
└── snippets
```

然后根据运行环境组合：

```text
Base Prompt
+
Coding Instructions
+
Tool Instructions
+
Workspace Instructions
+
Skill Instructions
```

这样更容易测试和演进。

---

# 22. Session / History / Checkpoint

Coding Agent 不应该只有：

```text
messages[]
```

而应该有 Session：

```text
Session
│
├── session id
├── workspace
├── model
├── messages
├── tool calls
├── task state
├── permissions
├── checkpoints
└── metadata
```

Gemini CLI 当前文档也包含：

```text
session resume
history
rewind
checkpointing
```

这意味着用户可以继续、回退或恢复工作状态。

---

# 23. Checkpoint / Rewind 的思想

Coding Agent 修改代码以后：

```text
Before
   ↓
Agent edits
   ↓
After
```

应该能：

```text
rewind
```

恢复之前状态。

可以结合：

```text
Git
+
filesystem snapshot
+
checkpoint metadata
```

实现。

不要单纯依赖聊天历史。

---

# 24. Skills

Gemini CLI 当前提供 Agent Skills。

可以理解成：

```text
Skill
=
一组针对某类任务的专业 instructions / resources / workflow
```

例如：

```text
skills/
├── react/
├── python/
├── unity/
├── backend/
└── testing/
```

Agent 根据任务：

```text
User:
帮我开发 Unity VR 功能

↓

Skill Discovery

↓

Unity Skill

↓

加载相关 instructions

↓

执行 Agent
```

关键思想：

**不要把所有专业知识永远塞进 System Prompt。**

应该按需加载。

---

# 25. Hooks

Hooks 可以理解成：

```text
Agent Lifecycle Events
```

例如：

```text
BeforeTool
AfterTool
BeforeModel
AfterModel
SessionStart
SessionEnd
```

允许外部逻辑插入：

```text
logging
security check
formatting
validation
custom automation
```

这是一种非常好的扩展机制。

---

# 26. Extensions

Extensions 比单个 Tool 更高层。

可以理解成：

```text
Extension
│
├── Tools
├── Commands
├── Skills
├── MCP
├── Config
└── Resources
```

因此：

```text
Tool = 一个能力
Skill = 一类任务的知识 / instructions
Extension = 一个完整扩展包
```

这三个概念不要混在一起。

---

# 27. Model Routing / Fallback

成熟 Agent 不应该假设：

```text
一个 Model 永远可用
```

需要：

```text
Model Router
     │
     ├── Primary Model
     │
     ├── Fallback Model
     │
     └── Retry Strategy
```

例如：

```text
Gemini Model
 ↓
rate limit
 ↓
Fallback
 ↓
另一模型
```

或者：

```text
fast model
 ↓
planning
 ↓
strong model
 ↓
coding
```

---

# 28. Scheduler / Background Tasks

Agent 不一定所有任务都是：

```text
同步等待
```

成熟平台可以有：

```text
Task
│
├── queued
├── running
├── waiting_for_confirmation
├── completed
├── failed
└── cancelled
```

这会为：

```text
background agent
long-running agent
parallel task
```

提供基础。

---

# 29. Telemetry / Observability

Agent 特别需要 Trace。

例如一次任务：

```text
Agent Run #123

├── Model Call #1
│    ├── input tokens
│    └── output tokens
│
├── Tool Call #1
│    ├── read_file
│    └── 200ms
│
├── Tool Call #2
│    ├── shell
│    └── 2.4s
│
├── Model Call #2
│
└── Final
```

这样才能分析：

```text
为什么 Agent 慢？
为什么失败？
哪个 Tool 出问题？
用了多少 token？
模型为什么循环？
```

OpenTelemetry 是值得采用的方向。

---

# 30. CLI 与 Agent Runtime 解耦

这是非常重要的设计思想。

不要：

```text
Agent
里面直接 console.log()
```

应该：

```text
Agent Runtime
       ↓
Events
       ↓
CLI Renderer
```

例如 Agent 产生：

```json
{
  "type": "tool.started",
  "tool": "shell",
  "args": {
    "command": "npm test"
  }
}
```

CLI 决定怎么显示：

```text
▶ Running npm test...
```

Web UI 可以显示：

```text
[Tool] npm test
```

Desktop UI 可以显示：

```text
Tool Execution Card
```

这会让一个 Agent Runtime 支持多个前端。

---

# 31. ACP：IDE 集成方向

Gemini CLI 目前支持 ACP（Agent Client Protocol）。

可以理解成：

```text
IDE / Client
     │
     │ JSON-RPC 2.0 / stdio
     ↓
Gemini CLI
     │
     ↓
Agent Runtime
```

这样 IDE 可以把 Gemini CLI 当作一个 Agent Server。

这是值得自己的 Agent 平台参考的：

```text
Agent Runtime
       │
       ├── CLI
       ├── Web
       ├── IDE
       └── Desktop
```

---

# 32. A2A：Agent-to-Agent

Gemini CLI 仓库还有 A2A server 相关 package。

概念：

```text
Agent A
   │
   │ task
   ↓
Agent B
   │
   │ result
   ↓
Agent A
```

它适合以后做：

```text
Planner Agent
Coder Agent
Reviewer Agent
Tester Agent
```

但不要在项目第一阶段就使用 Multi-Agent。

先把：

```text
Single Agent
+
Tool Calling
+
Context
+
Execution
```

做稳定。

---

# 33. Testing / Evaluation

Coding Agent 不能只靠：

```text
npm test
```

还应该测试 Agent 行为：

```text
Task
 ↓
Agent
 ↓
Expected tool sequence
 ↓
Expected result
```

可以建立：

```text
evals/
├── coding/
├── tool-use/
├── context/
├── safety/
├── regression/
└── benchmark/
```

测试：

```text
Agent 是否正确选择 Tool？
Agent 是否修改正确文件？
Agent 是否会无限循环？
Agent 是否会执行危险命令？
Agent 是否能修复测试？
```

这比只测函数单元测试更重要。

---

# 34. Gemini CLI 的设计哲学可以总结成 12 条

## ① Terminal-first

先服务开发者的 Terminal 工作流。

## ② Core / UI 分离

Agent Runtime 不依赖具体 UI。

## ③ Tool-first

模型通过工具改变外部世界。

## ④ Tool Registry

工具统一注册、发现、验证、执行。

## ⑤ Policy-first

工具执行前经过安全策略。

## ⑥ Sandbox

副作用操作可以在隔离环境执行。

## ⑦ MCP extensibility

外部能力通过 MCP 接入。

## ⑧ Skills

专业知识按需加载。

## ⑨ Hooks

生命周期事件允许扩展。

## ⑩ Session / Checkpoint

Agent 是长期任务，而不是一次 API 请求。

## ⑪ Observability

Agent 每一步都应该可追踪。

## ⑫ Protocol-oriented

通过 ACP / MCP / A2A 等协议与其他系统集成。

---

# 35. 对你正在开发的 Agent 项目的建议架构

不要直接复制 Gemini CLI。

可以考虑演进成：

```text
your-agent/
│
├── apps/
│   ├── cli/
│   ├── web/
│   └── desktop/
│
├── packages/
│   │
│   ├── core/
│   │   ├── agent/
│   │   ├── context/
│   │   ├── session/
│   │   ├── model/
│   │   ├── routing/
│   │   └── events/
│   │
│   ├── tools/
│   │   ├── registry/
│   │   ├── filesystem/
│   │   ├── shell/
│   │   ├── search/
│   │   └── git/
│   │
│   ├── security/
│   │   ├── policy/
│   │   ├── permission/
│   │   └── sandbox/
│   │
│   ├── mcp/
│   │
│   ├── skills/
│   │
│   ├── protocol/
│   │   ├── acp/
│   │   └── a2a/
│   │
│   └── observability/
│
├── skills/
├── sandbox/
├── evals/
├── integration-tests/
└── docs/
```

注意：

**这是根据 Gemini CLI 的架构思想重新抽象出来的建议，不是 Gemini CLI 的原始目录结构。**

---

# 36. 推荐你的 Agent Runtime 数据流

```text
User
 │
 ▼
Client
 │
 ▼
Session
 │
 ▼
Context Manager
 │
 ▼
Agent Loop
 │
 ▼
Model Router
 │
 ▼
LLM
 │
 ├─────────────── final
 │
 └─────────────── tool call
                         │
                         ▼
                    Tool Registry
                         │
                         ▼
                    Policy Engine
                         │
              ┌──────────┴──────────┐
              │                     │
           allowed                denied
              │                     │
              ▼                     ▼
          Sandbox              Confirmation
              │                     │
              └──────────┬──────────┘
                         ▼
                    Tool Result
                         │
                         ▼
                    Context Update
                         │
                         ▼
                      Agent Loop
```

这张图应该成为你项目重构时的核心参考。

---

# 37. 技术选型建议

如果当前项目已经使用 TypeScript / Node.js：

### 建议保留

```text
TypeScript
Node.js
npm workspaces
React
Ink
MCP SDK
Vitest
esbuild
```

### Agent Core

```text
TypeScript
```

### CLI

```text
React + Ink
```

### Shell

```text
node-pty
```

### Git

```text
simple-git
```

### Sandbox

第一阶段：

```text
Docker
```

后续：

```text
Docker
Podman
macOS sandbox
Windows sandbox
```

### Desktop

后续可以考虑：

```text
Tauri
```

而不是现在就加入。

---

# 38. Rust 应该放在哪里？

如果项目以后真的需要 Rust：

```text
TypeScript Agent Runtime
          │
          ↓
      Rust Runtime
          │
     ┌────┼─────┐
     ↓    ↓     ↓
    PTY  FS    Sandbox
```

适合 Rust 的方向：

```text
Process Manager
PTY
Sandbox Runtime
Filesystem Watcher
Native Desktop Runtime
Performance-sensitive components
```

不要因为“Codex 很可能用了 Rust”就把整个 Agent 都改成 Rust。

真正需要 Rust 的地方，是系统边界和高性能 / 高隔离组件。

---

# 39. 参考源码时的阅读顺序

不要从整个仓库开始读。

推荐：

```text
1. packages/core/GEMINI.md
       ↓
2. packages/core/src/tools/
       ↓
3. ToolRegistry
       ↓
4. Agent / GeminiClient
       ↓
5. context / prompt
       ↓
6. policy / confirmation-bus
       ↓
7. mcp
       ↓
8. skills
       ↓
9. sandbox
       ↓
10. session / checkpoint
       ↓
11. telemetry
       ↓
12. packages/cli
       ↓
13. ACP / A2A
```

---

# 40. 最重要的“借鉴原则”

给编码模型阅读时，不要告诉它：

> “照着 Gemini CLI 改。”

而应该告诉它：

> “研究 Gemini CLI 的架构设计思想，结合当前项目已有实现，识别可以借鉴的模块边界、接口抽象、安全模型、Agent Loop、Tool Registry、Context、MCP、Sandbox、Session 和 UI 解耦方式，然后提出重构方案。禁止机械复制 Gemini CLI 代码或目录结构。”

这样模型更容易做正确的架构迁移，而不是把一个成熟项目的复杂度整个搬进你的项目。

---

# 41. 官方资料

Gemini CLI 官方 GitHub：

https://github.com/google-gemini/gemini-cli

Core 架构：

https://github.com/google-gemini/gemini-cli/blob/main/packages/core/GEMINI.md

Tool Reference：

https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/tools.md

MCP：

https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md

Sandbox：

https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/sandbox.md

项目架构 / Project Context：

https://github.com/google-gemini/gemini-cli/blob/main/GEMINI.md

ACP：

https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md

---

# 42. 给编码模型的最终任务提示

将本文作为参考资料后，要求编码模型：

```text
你正在开发一个 Coding Agent / Agent Platform。

请阅读本 Gemini CLI 架构研究文档，但不要机械复制 Gemini CLI。

你的任务：

1. 分析当前项目已有架构。
2. 找出当前 Agent Runtime、Tool System、Context、Session、Permission、Sandbox、MCP、CLI/UI 等模块。
3. 将当前架构与 Gemini CLI 的设计思想进行对照。
4. 找出当前项目存在的架构耦合、职责混乱、扩展困难和安全问题。
5. 提出新的目标架构。
6. 优先保持已有可工作的代码，不要为了模仿 Gemini CLI 而进行无意义重写。
7. 把 Agent Runtime 与 UI 解耦。
8. 建立统一 Tool Registry。
9. 建立 Policy / Permission 层。
10. 为 Sandbox 设计抽象接口，不要把 Agent Runtime 直接绑定 Docker。
11. 为 MCP、Skills、Hooks、Session、Checkpoint、Observability 预留清晰扩展点。
12. 先设计接口和模块边界，再实施代码迁移。
13. 每次只实施一个架构阶段，并保证现有测试继续通过。
14. 不要直接复制 Gemini CLI 源代码。
15. 不要为了追求“像 Gemini CLI”而引入当前项目暂时不需要的复杂组件。

最终目标不是复制 Gemini CLI，而是吸收其成熟 Coding Agent 架构思想，形成适合本项目自身定位的 Agent Runtime。
```
