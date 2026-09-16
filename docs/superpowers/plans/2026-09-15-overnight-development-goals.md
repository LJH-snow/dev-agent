# dev-agent 过夜开发目标与执行顺序

**建立日期：2026-09-15**

**目标窗口：** 从本计划建立起持续推进；用户预计于 2026-09-16 08:00（Asia/Shanghai）起床。

**当前基线：** `@agent_cli/cli@0.1.3` 已发布到 npm，并已从 registry 安装验证；
CLI 全量测试、npm package smoke、TypeScript、Rust、real-Rust integration、workflow
contract 和 documentation contract 均已通过。

**执行状态：** 目标 1–10 均已达到“实现通过”、`PRESERVE` 或明确
`DONE + DEFERRED`；固定 gate 已完成最后一轮验证。本轮继续收口了目标 4 的三个
Deferred proof gap，后续不再无目的扩张实现，除非用户明确选择下一个 Deferred proof
gap 或开始下一个版本。

## 一、执行边界

1. 所有代码改动先写 RED 测试，再做最小实现；每个目标完成前必须有可重跑的验证命令。
2. 子代理只修改分配给自己的文件范围；不得同时编辑共享计划、锁文件、发布配置或彼此
   的测试文件，主代理统一集成和复核。
3. 不创建秘密、不读取或输出凭据、不修改 npm/GitHub 权限，不执行删除整个仓库、强制
   覆盖用户文件、`git reset --hard` 等破坏性操作。
4. npm 包已经发布；除非用户再次明确授权，不重复发布同一版本，不创建 tag、push 或
   GitHub Release。正式 GitHub release 与 npm package publish 保持分离。
5. 外部目录测试只使用临时目录或仓库明确提供的 fixture，不扫描用户真实隐私目录，
   不把 `/Users/Admin/.Trash`、`.ssh` 等目录作为测试输入。
6. 任一目标若发现需要共享文件、外部权限或产品决策，停止该目标的写入，留下 proof-gap
   报告，主代理再决定是否继续。

## 二、变更文件地图

| 文件/目录 | 责任 | 允许的典型变更 |
| --- | --- | --- |
| `/Users/Admin/Desktop/dev-agent/apps/cli/src/index-command.ts` | CLI 索引遍历、增量索引和报告 | 权限安全、排除规则、确定性和性能 |
| `/Users/Admin/Desktop/dev-agent/apps/cli/src/index.ts` | CLI 参数解析、启动和输出边界 | 新 flag 的契约、错误输出、工作目录行为 |
| `/Users/Admin/Desktop/dev-agent/apps/cli/src/config.ts` | config/session/provider 解析 | 项目级配置和隔离规则 |
| `/Users/Admin/Desktop/dev-agent/apps/cli/tests` | CLI 行为回归 | 与生产改动同范围的 RED/回归测试 |
| `/Users/Admin/Desktop/dev-agent/packages/mcp`、`apps/cli/src/mcp-system-prompt.ts` | MCP 生命周期和元数据 | 超时、取消、命名和失败边界 |
| `/Users/Admin/Desktop/dev-agent/packages/executor`、`/Users/Admin/Desktop/dev-agent/rust` | executor/sandbox 证据 | 取消、资源、平台边界；不凭空加 Windows backend |
| `/Users/Admin/Desktop/dev-agent/apps/desktop` | Desktop 状态 UX | 只有真实 UX trigger 和 bounded contract 才允许改动 |
| `/Users/Admin/Desktop/dev-agent/scripts`、`.github/workflows` | smoke、release gate 和 CI | 验证闭环、fail-closed contract，不直接发布 |
| `/Users/Admin/Desktop/dev-agent/docs`、`README.md` | source-of-truth 文档 | 同步已验证行为、风险和人工闸门 |

## 三、十个开发目标（按顺序）

### 目标 1：索引遇到受保护目录时不再让整个任务失败

**状态：DONE**

**背景：** 用户从 `/Users/Admin` 执行 `dev-agent --index . --json` 时，在
`/Users/Admin/.Trash` 收到 `EPERM`。当前 `collectFiles()` 对目录的 `readdir()` 没有和
文件 `stat()` 一样的容错边界。

**实现范围：**

- 对目录枚举失败建立显式的 skipped-directory 结果，不吞掉根目录本身的错误；
- JSON 输出保持单一可解析文档，记录安全的相对路径、错误类别和跳过计数，不泄露敏感
  的绝对路径或环境变量；
- 人类输出给出简洁 warning；正常项目中的可读文件索引结果不改变；
- 不因为权限错误切换到任意目录、扩大权限或静默启用 Rust runtime。

**优先文件：**

- `/Users/Admin/Desktop/dev-agent/apps/cli/src/index-command.ts`
- `/Users/Admin/Desktop/dev-agent/apps/cli/src/index.ts`
- `/Users/Admin/Desktop/dev-agent/apps/cli/tests/index-command.test.ts`
- `/Users/Admin/Desktop/dev-agent/apps/cli/tests/json-output.test.ts`

**验收：**

- fixture 中存在不可读子目录时，索引成功完成并有结构化 skipped warning；
- 根目录不可读或不存在时，仍返回明确 error；
- `--json` stdout 只有一个可解析 JSON 值；
- `pnpm --filter @agent_cli/cli test` 和 `pnpm package:smoke` 通过。

### 目标 2：提供明确、可审计的索引边界与排除策略

**状态：DONE**

**目标：** 让用户可以显式排除构建产物、缓存、依赖目录和大目录，同时保证默认行为
可预测。

**候选范围：**

- 评估是否需要 `--exclude <path>`、配置项或既有 ignore 规则的统一入口；
- 明确相对路径相对于最终 `--cwd` 解析；
- 统一默认忽略 `.git`、`node_modules`、`.dev-agent` 等已知目录；
- 对 symlink、路径穿越、重复路径和忽略规则顺序建立测试。

**进入条件：** 先证明当前默认规则无法覆盖真实用户场景；若现有规则已足够，则只补
contract 和文档，不增加新 flag。

**验收：**

- 包含/排除行为有 fixture 测试；
- 不会越过最终工作目录边界；
- 结果中的文件数、符号数和 skipped 计数稳定；
- 目标 1 的权限容错仍然有效。

### 目标 3：加固增量索引的正确性和可恢复性

**状态：DONE**

**目标：** 确保索引中断、文件消失、签名变化、损坏缓存和并发调用不会产生“看起来
成功但内容过期”的结果。

**实现范围：**

- 审计 `/Users/Admin/Desktop/dev-agent/packages/code-intelligence` 的 persisted index
  读写与 CLI 报告之间的契约；
- 为损坏 JSON、部分文件不可读、mtime/size 相同但内容异常、重复运行和确定性排序补齐
  RED/回归测试；
- 如果没有可证明的生产缺口，保持 schema v1，不做无必要迁移。

**验收：**

- `pnpm --filter @dev-agent/code-intelligence test` 通过；
- CLI 的 `--index` 回归和 package smoke 通过；
- 明确记录是否需要 schema 变更；没有证据时选择 Preserve。

### 目标 4：完善外部项目的 config、session 和诊断入口

**状态：DONE + DEFERRED**

**目标：** 让安装后的 CLI 在多个项目之间保持 config、session、memory 和 provider
边界清晰，并让用户能快速判断“路径问题、配置问题还是 provider 问题”。

**实现范围：**

- 审计 `--cwd`、`--config`、`DEV_AGENT_WORKING_DIRECTORY`、`DEV_AGENT_CONFIG_FILE`、
  `DEV_AGENT_SESSION_DIR` 和 `DEV_AGENT_MEMORY_FILE` 的优先级；
- 评估 `dev-agent --doctor --json` 是否已覆盖外部项目最关键的前置条件；
- 只有发现稳定 UX 缺口时，才增加最小诊断字段或项目初始化提示；不泄露 key、完整
  环境变量、用户目录下的敏感文件名。

**验收：**

- 两个临时项目的 session/config 不互相污染；
- 无 provider key 时，`--version`、`--tools`、`--index` 仍按文档工作；
- doctor 和 JSON error contract 通过；
- 文档给出可复制的外部目录示例。

**本轮 Deferred proof gap 收口：**

- `DEV_AGENT_SESSION_DIR` 和 `DEV_AGENT_MEMORY_FILE` 的相对路径现在相对于最终
  `--cwd` 解析；空白 memory 路径按未设置处理；`--session-list`、删除、改名、compact、
  metadata、MCP session 均使用同一解析结果；
- `--tools`、metadata、session-list、compact 等 provider-free 命令延迟 provider
  初始化，即使项目 config 指向缺少 key 的 provider，也能正常检查工具和 session；
- doctor 的 JSON 与 human 输出不再回显 config/session 的绝对路径，并保留稳定的诊断
  标签和错误码。

**本轮证据：** 先用新增外部目录和配置测试确认 4 个 RED，再完成最小修复；目标定向
测试 GREEN 为 196/196，`pnpm verify` 全部通过。随后又为 filesystem、search、
code-search 增加了共享的 canonical/symlink-aware 工作目录边界，并让外部 MCP child
使用同一项目目录作为 `cwd`；更强的跨用户配置隔离仍属于后续人工决策，不在本轮扩大
范围。

### 目标 5：建立 npm 包的安装、升级和回滚验证闭环

**状态：DONE（已发布 0.1.2）**

**当前证据：** `@agent_cli/cli@0.1.2` 已于 2026-09-16 成功发布，`latest` 指向
`0.1.2`，并完成 registry clean install；安装后的 `dev-agent --version` 输出 `0.1.2`，
`--tools` 正常工作。候选 tarball 只包含发行入口、source map、README、LICENSE 和
`package.json`，包内没有 workspace runtime dependency、checkout 绝对路径或隐式 Rust
postinstall。

**补充修复：** `0.1.2` 将 CLI 版本改为从包自身的 `package.json` 读取。此前已发布的
`0.1.1` 运行时横幅仍显示 `0.1.0`，使用者应升级到 `0.1.2` 或 `latest`。

**验收：**

- `npm view @agent_cli/cli@0.1.2 version` 返回 `0.1.2`；
- registry clean install 后 `dev-agent --version` 为 `0.1.2`，`dev-agent --tools` 可用；
- `pnpm --filter @agent_cli/cli test` 196/196，`pnpm package:smoke` 和 `pnpm verify` 通过；
- 本次未创建 Git tag、push 或 GitHub Release。

### 目标 6：统一 machine-readable error、redaction 和诊断稳定性

**状态：PRESERVE（已有 gate 证据）**

**目标：** 对参数错误、provider 启动失败、运行失败、工具失败、权限跳过和 session
损坏建立稳定的 JSON/人类输出边界。

**实现范围：**

- 审计 stdout/stderr/exit code 的互斥关系；
- 检查 provider 错误 body、MCP 元数据、路径、model/provider 名称和持久化 metadata
  的脱敏、长度上限和终端控制字符清理；
- 只为真实缺口增加测试或最小修复，不改变成功响应 schema。

**验收：**

- `--json` 每个失败路径最多输出一个 JSON document；
- 人类模式不出现 ANSI/终端控制注入；
- credential-shaped 内容不进入持久化 memory、JSON error 或诊断输出；
- 现有 machine-output、JSON、provider retry 测试全部通过。

### 目标 7：加固 MCP 工具生命周期、取消和命名隔离

**状态：DONE**

**目标：** 保证多个 MCP server、工具进度、取消、超时、晚到结果、资源/提示和
`--mcp-server` stdio framing 在外部 CLI 中稳定。

**实现范围：**

- 检查 unnamed/duplicate server prefix、工具元数据清理和 server startup failure；
- 审计 Ctrl-C、provider abort、MCP tool abort 和 late result 是否会污染下一轮 session；
- 若当前 contract 已完整，补充 proof report，不做第三方框架迁移。

**本轮继续工作：** MCP server 现在为活动 `tools/call` 建立 cooperative
`AbortSignal`，并让 `notifications/cancelled` 绕过阻塞中的普通请求；CLI 内置 tool adapter
会把该 signal 传给 shell 等执行器。普通请求仍保持串行，避免改变既有工具副作用顺序。
stdio client/server 现在按 UTF-8 字节数增量限制单帧大小，默认上限为 8 MiB；CLI 的
`McpServerSession` 会在 tools/resources/prompts 的 list-change 通知后同步工具与元数据，
而 agent loop 在每一轮模型调用前重新读取 system prompt supplement，避免旧 prompt 重复
或新 prompt 只能重启后出现。

**验收：**

- MCP 相关 CLI 测试、stdio 测试和 package smoke 通过；
- 取消不会消费下一段回答或写入错误 session；
- tools JSON 与人类输出均可解析、无控制序列注入；
- MCP frame-limit、session prompt refresh 和 dynamic system-prompt 测试通过。

### 目标 8：保持 TTY、pipe、窄终端和 NO_COLOR 的一致体验

**状态：PRESERVE（已有 gate 证据）**

**目标：** 继续保持 rich TTY 只在真实交互终端启用，同时不破坏 CI、重定向、JSON、
`--once` 和 MCP server。

**实现范围：**

- 审计首 token、tool progress、Ctrl-C、EOF、fenced code、窄宽度和长路径；
- 评估是否存在真实终端回归；没有证据时保持现有 TUI，不引入第三方终端框架；
- 可选地补充基于当前 PTY contract 的跨 shell fixture。

**验收：**

- `apps/cli/tests/tui-*.test.ts`、interactive、machine-output 全部通过；
- `NO_COLOR=1` 没有 ANSI；
- pipe/JSON/once stdout 不混入欢迎屏、Thinking 或进度状态。

### 目标 9：维护 Rust sandbox 的证据边界，不扩张未证明的平台能力

**状态：DONE / PRESERVE WINDOWS**

**目标：** 继续验证 LocalExecutor、macOS sandbox、Linux `bwrap` 的权限、取消、超时、
资源、网络和 stdio 边界，同时保持 Windows backend 为 `Unsupported`，直到有稳定
runner、可审计原语和明确 target commitment。

**实现范围：**

- 运行并审计 Rust unit/doc、真实 Rust integration 和平台 capability 结果；
- 只修复可重现的 cancellation、resource、path、network 或 process-tree 缺口；
- 不把 LocalExecutor 静默宣传成 restricted executor，不添加模拟 Windows shim。

**本轮实现：** Unix LocalExecutor 为子进程组发送终止信号并清理 descendants；stdout/stderr
reader 在 stdin 写入前启动，避免大输入回显造成 pipe deadlock；输出截断、超时和取消共享
同一棵进程树清理路径。Rust stdio transport 与 TypeScript `RustExecutor` 均限制 protobuf
frame，且自定义上限会传给 Rust child；Windows backend 仍保持 Preserve/NO-GO。

**验收：**

- `pnpm verify:rust` 和 `pnpm verify:integration` 有新鲜证据；
- 失败能区分外层权限限制、平台能力缺失和产品代码回归；
- Windows 结论仍为 Preserve/NO-GO，除非所有进入条件同时满足；本轮没有添加 Windows
  shim 或未经证明的 backend。

### 目标 10：收口发布、CI、文档和交接自动化

**状态：DONE**

**目标：** 让 npm package 已发布这一事实、正式 GitHub release 仍需单独授权这一事实、
以及后续版本的发布步骤在所有 source-of-truth 中一致。

**实现范围：**

- 更新 `/Users/Admin/Desktop/dev-agent/README.md`、`/Users/Admin/Desktop/dev-agent/apps/cli/README.md`、
  `/Users/Admin/Desktop/dev-agent/docs/release-cli-npm.md`、CHANGELOG、release checklist；
- 固化 `@agent_cli/cli` scope、版本、registry 安装 smoke、tag-only GitHub workflow 和
  no-secret/no-publish 默认边界；
- 为计划进度、测试证据和 proof gap 保留可审计记录；不创建 tag、push 或 GitHub Release。

**验收：**

- `node --test tests/documentation-contract.test.mjs tests/release-workflow.test.mjs tests/ci-workflow.test.mjs` 通过；
- `git diff --check` 通过；
- 文档不再把 `@agent-cli/cli` 和 `@agent_cli/cli` 混用；
- 交接记录列出已完成目标、未完成目标、风险和下一人工决策。

## 四、执行顺序和并行分配

### 第一轮（现在）

- **主代理：** 建立本计划，冻结边界，随后集成目标 1 的实现；负责最终全量验证。
- **代理 A：** 目标 1，限定于索引权限容错和对应 CLI 测试。
- **代理 B：** 目标 7，限定于 MCP 生命周期审计；只有发现可复现缺口才修改
  `/Users/Admin/Desktop/dev-agent/packages/mcp` 与对应测试。
- **代理 C：** 目标 9，限定于 Rust cancellation/resource proof audit；优先产出测试
  或 proof-gap，不修改 Windows backend。

### 第二轮（目标 1 合并后）

- 目标 2 → 目标 3：索引边界和增量索引串行推进，避免共享 `index-command.ts` 冲突。
- 目标 4、目标 5、目标 6 可在文件范围不重叠时并行审计。
- 目标 8 与目标 10 在核心代码稳定后执行，最后由主代理统一跑 gate。

### 停止/继续条件

- 单个目标通过其局部验收后，更新本文件状态并继续下一个目标；
- 子代理报告 proof gap 时，不把“没有改代码”误报成失败，记录证据后继续其他目标；
- 任一固定 gate 失败时，优先定位和修复当前回归，不扩张到新目标；
- 目标 1–10 全部达到“实现通过”或“有充分 Preserve/Deferred 证据”后，继续做全量
  审计、安装 smoke 和交接文档，直到用户下一次介入或达到 2026-09-16 08:00 的时间盒。

## 五、统一验收命令

局部目标至少运行对应 package test；每轮集成至少运行：

```bash
pnpm --filter @agent_cli/cli test
pnpm package:smoke
node --test tests/documentation-contract.test.mjs tests/release-workflow.test.mjs tests/ci-workflow.test.mjs
pnpm verify
npm view @agent_cli/cli@0.1.2 version
npm install --prefix /tmp/dev-agent-cli-registry-install --no-save @agent_cli/cli@0.1.2
```

发布前的候选检查只允许做查询和本地 dry-run；本轮 `0.1.2` 已在维护者明确确认后发布。
后续版本仍需维护者明确确认版本和发布动作；不创建 tag、不 push、不创建 GitHub Release。所有路径均以最终 `--cwd` 为边界，所有外部项目测试优先使用临时目录。

## 六、进度记录格式

每个目标完成时记录：

- 状态：`DONE`、`PRESERVE`、`DEFERRED` 或 `BLOCKED`；
- 变更文件和未变更文件；
- RED 测试、GREEN 测试和最终 gate 输出；
- 仍存在的 proof gap、平台限制或人工决策；
- 是否允许进入下一个目标。

**当前下一步：** `@agent_cli/cli@0.1.3` 已可在其他项目中使用；本轮已收口 MCP frame
limit、动态 prompt 同步、Rust 进程树/回压和工具级项目目录边界。新的兼容性后续工作是
显式 `--project-state` opt-in 已在当前工作区实现，用于外部项目的 config/session 隔离；
它不改变用户级默认值，也不自动迁移历史 session，且已随已发布的 npm `0.1.3` 提供。
Windows restricted backend 仍需独立的平台决策并保持 deferred。

## 七、当前进度（2026-09-16）

| 目标 | 当前结论 | 证据/后续动作 |
| --- | --- | --- |
| 1 | DONE | 子目录权限错误结构化跳过；目标1实现已由后续 CLI gate 回归覆盖 |
| 2 | DONE | `--exclude` 支持重复/目录/文件；相对最终 `--cwd`；越界拒绝；symlink 不跟随 |
| 3 | DONE | 签名加入 `ctimeMs`；损坏缓存回退全扫；删除/改名与确定性排序回归通过；schema 仍为 v1 |
| 4 | DONE + DEFERRED | provider-free 命令延迟初始化；相对 session/memory 路径按最终 `--cwd` 解析；doctor 不回显 config/session 绝对路径；更强跨用户隔离仍 deferred |
| 5 | DONE | `@agent_cli/cli@0.1.3` 已发布；registry clean install、版本横幅、`--tools` 和 `--project-state` 已复核 |
| 6 | PRESERVE | machine output、redaction 和 release/documentation contract 已有通过证据 |
| 7 | DONE | MCP package 61/61；frame limit、server-side cooperative cancel、tools/resources/prompts 动态同步和每轮 system-prompt refresh 已补齐 |
| 8 | PRESERVE | TTY、pipe、NO_COLOR 与 machine-output 测试已有通过证据 |
| 9 | DONE / PRESERVE WINDOWS | Rust lib 48/48、executor 53/53、binary frame-parser tests 5/5、real integration 11/11 全通过；stdin 回压、进程树和 frame 上限已补齐，Windows 仍 Preserve |
| 10 | DONE | docs、CI、release workflow contract 全通过；npm 0.1.3 已发布，未 tag/push/GitHub Release |

**当前最终结果：** `pnpm verify` 通过；包含 TypeScript build/typecheck/test、CLI
package smoke、preview 8/8、release gate 16/16、release workflow 7/7、CI workflow
2/2、documentation contracts 10/10、Rust lib 48/48、binary frame parser tests 5/5
和 real-Rust integration 11/11。另有 `pnpm --filter @agent_cli/cli test` 200/200、
`@dev-agent/code-intelligence` 30/30、MCP 61/61、executor 53/53、agent-core 119/119、
tools 124/124 通过，`git diff --check` 通过。CLI 测试串行执行，避免 package smoke
的 workspace build 与其他测试并发写 `dist` 造成 ESM 半更新。


## 八、发布后补充（2026-09-16）

- 目标 5 的发布准备已完成：`@agent_cli/cli@0.1.2` 已发布到 npm，`latest` 指向
  `0.1.2`；registry clean install 后 `dev-agent --version` 输出 `0.1.2`，`--tools`
  正常工作。
- `0.1.1` 是中间版本，运行时横幅仍显示 `0.1.0`；版本读取逻辑已修复并包含在
  `0.1.2`，后续使用者应升级到 `0.1.2` 或 `latest`。
- 本次只发布 npm 包，没有创建 Git tag、push 或 GitHub Release。
- 目标 7 的动态 prompt 同步、MCP 协议帧大小上限和目标 9 的 Rust 进程树/回压已在
  2026-09-16 收口并验证；目标 4 的 filesystem/search/code-search/MCP 项目边界也已
  加强。仍保留的 Deferred 只有更强的跨用户配置隔离和 Windows restricted backend，
  两者都需要新的产品/平台决策，本轮不扩大范围。


## 九、项目状态隔离补充（2026-09-16）

- 在当前工作区实现显式 `--project-state`：当没有显式 config/session 覆盖时，最终
  `--cwd` 下使用 `.dev-agent/config.json` 和 `.dev-agent/sessions`；旧的用户级默认路径
  与环境变量优先级保持不变，不自动迁移或覆盖历史 session。
- TDD 证据：先观察到 5 个 CLI RED 测试和 1 个文档 contract RED；实现后 CLI
  200/200、documentation 10/10，最终 `pnpm verify` 全部通过。
- 该功能已随已发布的 `@agent_cli/cli@0.1.3` 提供；本轮没有 tag、push 或 GitHub
  Release。Windows restricted backend 仍保持 deferred。


## 十、0.1.3 发布补充（2026-09-16）

- 在维护者明确授权并恢复 npm 认证后，将 `@agent_cli/cli` 从 `0.1.2` 升级到 `0.1.3`。
- `pnpm verify`、package smoke、registry clean install 和发布后复核均通过；`latest` 指向
  `0.1.3`，`dev-agent --version` 输出 `0.1.3`。
- `--project-state` 已进入已发布包；该模式仍为显式 opt-in，不改变旧的用户级默认值。
- 本次没有创建 Git tag、push 或 GitHub Release；Windows restricted backend 仍 deferred。
