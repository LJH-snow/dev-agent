# dev-agent 后续开发计划：v0.1.5–v0.4.0

**建立日期：2026-09-16**
**计划状态：执行中**
**当前基线：`@agent_cli/cli@0.1.4` 已发布到 npm；仓库 `v0.1.4` Tag、GitHub Release workflow、核心验证 gate 和外部项目 smoke 已完成。**

本文记录 `dev-agent` 在跳过真实用户反馈等待后，按优先级直接推进的产品化与工程化计划。每个阶段都必须先建立可执行的 RED contract 或失败测试，再实现最小完整闭环，最后运行与范围匹配的验证。

## 总体原则

1. **按阶段顺序交付。** 先完成 v0.1.5，再进入 v0.2.0；不得在前一阶段未形成可用闭环时并行修改后续阶段的公共接口。
2. **保持安全边界。** sandbox 不可用时不得静默降级；敏感信息不写入配置、日志、session 或 evidence；项目初始化不得未经明确选择修改用户文件。
3. **保持兼容。** 保留现有 flags、session 格式、MCP 协议、metadata-only evidence 和外部目录使用方式；新增命令优先采用向后兼容的子命令或显式 flags。
4. **先测试后实现。** 新行为必须有单元测试、CLI 集成测试和必要的外部目录 smoke；涉及发布或 runtime 的阶段必须补充 release/workflow contract。
5. **主代理负责整合。** 可以并行委托边界清晰的调查、实现和验证工作，但不同代理不得修改同一组文件，最终结果由主代理统一检查、测试和整合。
6. **不提前实现明确的 NO-GO。** Windows restricted backend、跨进程 before-image/Undo 和无触发条件的大规模 Desktop 重设计不属于本计划默认范围。

## 阶段总览

| 阶段 | 内容 | 优先级 | 状态 | 主要交付物 |
| --- | --- | ---: | --- | --- |
| v0.1.5 | `dev-agent init`、配置校验、项目初始化 | 最高 | DONE（待版本发布） | 初始化命令、配置命令、项目状态/忽略规则、安全测试 |
| v0.2.0 | Rust runtime 自动分发与安装 | 最高 | DONE（待版本发布） | 平台 runtime 包、安装/状态命令、校验和、fail-closed 解析 |
| v0.2.x | `review`、`plan/apply`、CI 非交互模式 | 高 | DONE（待版本发布） | 只读审查、计划与应用边界、稳定退出码/JSON 事件 |
| v0.3.0 | Provider/model 管理与预算控制 | 中高 | DONE（待版本发布） | provider/model 命令、连通性检查、预算与 fallback 策略 |
| v0.3.x | Code Search 多语言和大型项目优化 | 中 | DONE（待版本发布） | ignore 语义、索引状态/增量、更多语言或可插拔扫描器 |
| v0.4.0 | MCP 管理和 Desktop 状态面板 | 中 | DONE（待版本发布） | MCP 管理命令、健康状态、Desktop 执行能力状态展示 |

## v0.1.5：项目初始化与配置校验

### 目标

让用户在任意外部项目中完成一次安全、可解释、可重复的初始化，不再手动创建 `.dev-agent` 目录、配置文件或 `.gitignore` 条目。

### 建议命令

```bash
dev-agent init
dev-agent init --project-state
dev-agent init --gitignore
dev-agent config validate
dev-agent config show --json
dev-agent doctor --json
```

### 实现范围

- `init`：检查最终 `--cwd`，创建项目级 `.dev-agent/config.json` 和 sessions 目录；已有文件默认不覆盖。
- `--project-state`：显式启用项目级配置和 session；不迁移、不重命名、不覆盖用户级历史 session。
- `--gitignore`：仅在用户明确指定时添加 `.dev-agent/`，重复执行幂等；修改前后提供清晰摘要。
- `config validate`：检查 JSON 结构、未知字段、provider/model、approval、MCP server、pricing 和 validation policy。
- `config show`：输出脱敏后的有效配置；不得打印 API key、token、绝对 session 路径或敏感环境值。
- `doctor --json`：保留现有检查，并增加最终 cwd、project-state、config 来源和 runtime 选择的 metadata-only 状态。
- 非交互模式：`--json` 输出稳定 schema；需要人工确认的初始化操作在非交互模式下 fail-closed。

### 验收标准

- 在空目录、已有 `.dev-agent`、已有 `.gitignore`、损坏 config、只读目录和非 Git 目录中均有明确结果。
- 重复运行 `init` 不覆盖已有用户内容且结果幂等。
- `--gitignore` 只添加精确规则，不重排或删除用户已有规则。
- 项目配置和 session 路径始终以最终 `--cwd` 为边界。
- CLI、JSON、doctor、config 和外部目录 smoke 全部覆盖。

## v0.2.0：Rust runtime 自动分发与安装

### 目标

让 npm 安装的 CLI 在支持的平台上可以显式安装并使用受限 Rust runtime，不要求用户从仓库构建二进制。

### 实现范围

- 为 macOS ARM64/x64、Linux x64/ARM64 设计平台 runtime 包或等价的下载通道。
- 新增 `dev-agent runtime status|install|path`，支持指定版本、缓存路径和卸载/清理状态。
- 使用固定 manifest、平台/架构匹配、SHA-256 校验，下载失败或校验失败必须停止。
- 增加 `local`、`rust-sandbox`、`unsupported` 的明确 executor 状态；禁止 silent fallback。
- `doctor` 显示 runtime 来源、版本、能力和缺失原因。
- release workflow 验证 npm CLI 与 runtime artifact 的版本绑定、归档内容、可执行权限和 checksum。

### 验收标准

- 从干净 npm prefix 安装 CLI 后，无仓库 checkout 也能完成 runtime 状态检查。
- 支持平台安装后可运行真实 sandbox integration；不支持平台返回结构化 `Unsupported`。
- 损坏下载、错误平台、版本不匹配、无权限目录和中途取消均不会留下可被误用的 runtime。
- 任何 runtime 不可用的情况都不会隐式改用 LocalExecutor。

## v0.2.x：Review、Plan/Apply 与 CI 非交互模式

### 目标

把现有 tool、change-set、validation 和 evidence 能力暴露为可用于 CI、代码审查和自动化流水线的稳定接口。

### 实现范围

- 只读 `review`：基于 Git base/head 或 working tree 生成 metadata-only 的审查结果。
- `plan` 与 `apply` 分离：计划阶段不能修改 workspace；应用阶段只能消费明确绑定、未过期的 change set。
- `--non-interactive`：遇到 approval、需要人工输入或不确定状态时返回结构化失败，不等待 stdin。
- 稳定退出码：区分成功、发现问题、策略拒绝、配置错误、runtime 不可用和执行失败。
- JSON event stream：为 CI 提供 turn/tool/validation/change-set/terminal 事件，默认脱敏且有边界。
- 增加 token、成本、turn、时间和输出大小上限；超限时保留结构化原因并停止后续执行。

### 验收标准

- GitHub Actions 或普通 shell 中无需 TTY 即可运行。
- review 不写入文件；plan 不应用变更；apply 必须经过现有 approval/change-set guard。
- 同一输入在 `--json` 下输出稳定字段，不输出 provider secret、命令输出或绝对路径。
- CI 能根据退出码可靠区分失败类型。

## v0.3.0：Provider/model 管理与预算控制

### 目标

让模型配置从环境变量加 JSON 文件升级为可检查、可解释、可控成本的 provider/model 生命周期。

### 实现范围

- `providers list|test|status` 和 `models list|current`。
- provider endpoint、认证变量、模型名称和能力检查；API key 只检查存在性，不回显值。
- 项目级 model profile、模型别名和显式 fallback 顺序。
- 单次运行和 session 级 token、费用、turn、时间预算。
- 429、超时、provider 不可用和 fallback 选择输出结构化原因。
- 配置 schema/version 与向后兼容解析；无效配置在 doctor/config validate 中明确失败。

### 验收标准

- Ollama、OpenAI、Anthropic、Gemini 至少各有配置/连通性/错误路径测试。
- 预算触发不会启动下一轮 model/tool 调用。
- fallback 只在显式启用时发生，并在 metadata 中记录 provider/model 选择，不记录密钥。
- 现有默认 provider 和现有 session 行为保持兼容。

## v0.3.x：Code Search 多语言与大型项目优化

### 目标

提升索引在真实 monorepo 和多语言项目中的速度、覆盖率、可诊断性和增量可靠性。

### 实现范围

- 明确 `.gitignore`、`.ignore`、`--exclude` 和默认排除目录的优先级。
- `index status|refresh|clear`，展示文件数、symbol 数、缓存命中率、错误和最近更新时间。
- watcher 或显式增量 refresh；删除、重命名、symlink 和大文件边界继续 fail-closed。
- 在有稳定 scanner/fixture 后增加 Go、Java、Kotlin、C#、PHP 或 C/C++；不为凑语言数量引入低质量解析器。
- monorepo 分区、并发上限、内存/时间预算和可取消索引。
- 更完整的 cross-file definition/reference 关系，保持现有 JSON 兼容。

### 验收标准

- 大型 fixture 能证明冷启动、增量刷新、删除/重命名和取消的边界。
- 默认不会索引 `node_modules`、`.git`、构建产物、虚拟环境和缓存目录，且可审计覆盖规则。
- 新语言只能在 scanner、definition/reference、CLI 和 external-project tests 完整后进入默认支持。
- 索引错误不会损坏可恢复的已保存索引。

## v0.4.0：MCP 管理与 Desktop 状态面板

### 目标

把已有 MCP lifecycle 能力和 executor/evidence 状态变成可操作、可诊断的产品界面。

### 实现范围

- `mcp list|test|status|validate`，展示 server 名称、连接状态、能力摘要、耗时和失败原因。
- MCP 配置导入/导出与脱敏诊断；不自动执行不受信任的安装脚本。
- Desktop header/doctor panel 显示 executor mode、sandbox capability、provider/model、approval 和最近 validation 状态。
- 对 timeout、cancel、policy deny、runtime unsupported 和 tool failure 使用一致的可访问性语义。
- 保持 evidence metadata-only，不新增 before-image、原始命令输出或敏感字段。

### 验收标准

- MCP 管理命令在无 server、server 超时、server capability 变化和连接失败时均有稳定输出。
- Desktop 状态面板不改变 session、evidence、Undo 或 approval 的公开 schema。
- 键盘、无障碍名称、颜色之外的状态语义和 JSON/HTML 端到端测试齐全。

## 执行顺序与代理分工

### 主代理负责

- 维护本计划与阶段状态。
- 处理跨包接口、版本兼容、安全边界、最终整合和发布。
- 运行完整 `pnpm verify`、package smoke、外部目录 smoke 和必要的 runtime integration。

### 可并行委托的边界

- v0.1.5：CLI 参数/命令实现、配置校验测试、外部目录 smoke 可以拆成不重叠文件集。
- v0.2.0：平台 artifact/release contract、runtime resolver、安装状态测试可以拆分，但公共 manifest schema 先由主代理确定。
- v0.2.x 以后：review/plan、provider 管理、index 优化和 MCP 管理可以分别拆分；共享 schema 和 CLI 路由由主代理整合。

每个代理必须返回：修改的文件、测试命令、测试结果、未解决的风险。代理不能创建 Tag、发布 npm、推送远程或修改其他代理的范围。

## 发布与版本策略

- 每个阶段先以内部变更完成并通过固定 gate，再决定是否提升 npm 版本。
- v0.1.5 重点是命令和配置兼容，不改变现有 npm 包的默认 provider、session 或 sandbox 语义。
- v0.2.0 涉及平台 runtime 和下载边界，应在发布前完成真实平台 artifact、checksum 和 clean-install 验证。
- v0.2.x/v0.3.x/v0.4.0 应优先保持向后兼容；公开 schema 变化必须有迁移说明和 contract test。
- 不重复发布已经存在的版本；Tag、npm publish 和 GitHub Release 都必须使用明确版本与新提交。

## 当前执行项

- [x] 建立本计划文档。
- [x] v0.1.5：写 RED contract。
- [x] v0.1.5：实现 `init`、`config validate/show` 和项目初始化。
- [x] v0.1.5：补齐 CLI、外部目录和安全回归验证。
- [x] v0.1.5：更新 README、CHANGELOG 和版本计划状态。
- [x] v0.2.0：Rust runtime 自动分发与安装。
- [x] v0.2.x：实现 `review`、`plan/apply`、稳定退出码、脱敏 JSON event stream 和非交互 fail-closed 基础。
- [x] v0.3.0：Provider/model 管理、profile/alias/fallback 与预算控制。
- [x] v0.3.x：Code Search ignore 语义、索引状态、增量 refresh 与大型项目默认排除。
- [x] v0.4.0：MCP 管理命令与 Desktop metadata-only 状态面板。

## v0.2.x 完成记录（2026-09-16）

- 新增 provider-free 的 `dev-agent review`：支持 working tree 和成对的 Git base/head，输出变更文件、状态、增删统计和稳定 reason；不回显 diff、stderr、命令参数或绝对路径。
- 新增 `dev-agent plan` / `dev-agent apply`：plan 只生成 metadata-only 文档，不修改 workspace；apply 校验 session、workspace、过期时间、mutation 输入和 before/after hash，并支持在不同 CLI 进程中通过 `--changes-file` 安全重建 change set。
- 新增 `--non-interactive` 的 fail-closed 基础：普通运行没有 `--once` 时不会读取 stdin；approval 或人工输入要求返回结构化拒绝和稳定退出码。
- 新增 `--event-stream`（review/plan/apply）以及稳定退出码：0 成功、2 findings、3 policy denied、4 config error、5 runtime unavailable、6 execution error、64 usage error；事件默认脱敏。
- 新增预算追踪基础模块，覆盖 turns、tokens、duration 和 output chars 的下一次调用前检查，后续 v0.3.0 会接入 provider/model 生命周期。
- CLI 完整测试通过（272/272）；本轮只完成工作区实现与验证，未提升 npm 版本、创建 tag、推送或发布。

## v0.2.0 完成记录（2026-09-16）

- runtime-manager 已独立为 `@dev-agent/runtime-manager` workspace package，覆盖四个支持 target：
  macOS ARM64/x64、Linux ARM64/x64 glibc；Windows、Linux musl 和未知平台明确返回
  `UNSUPPORTED_PLATFORM`。
- 发布 workflow 已聚合并上传固定的 `dev-agent-runtime-manifest.json`，manifest 由四个平台
  archive 和 `.sha256` sidecar 生成，校验目标、archive allowlist、版本和稳定 JSON；当前仍为
  checksum-only，不伪造签名。
- CLI 已增加 `runtime status|install|path|remove`、`--executor local|rust-sandbox`、
  `--runtime-version` 和 `--runtime-dir`；status/path/remove 不联网、不启动 provider/MCP，
  rust-sandbox 缺少已安装 runtime 时 fail-closed。
- 安装流程使用临时目录、SHA-256、受限 tar.gz 解包、可执行位、Rust health/protocol/version
  检查和完成标记后原子替换；npm 包不执行 postinstall，也不静默回退到 local。
- Rust runtime 与 executor health contract 已统一为 release `0.2.0`、protocol `1`。
- 当前只完成工作区实现和验证，尚未提升 npm 版本、创建 v0.2.0 tag、推送或发布；这些动作需单独授权。

## v0.1.5 完成记录（2026-09-16）

- RED contract 先于实现：CLI 初始化和配置命令测试在路由接入前确认失败。
- `init` 已覆盖空目录、重复运行、不覆盖已有配置、`.gitignore` 幂等、dry-run、路径冲突和
  symlink/file conflict；项目状态只以最终 `--cwd` 为边界。
- `config validate` / `config show` 已覆盖非法 JSON、未知字段、provider/model、approval、
  validation policy、pricing、MCP 字段与敏感值不泄露；命令不加载 provider，也不执行 MCP。
- `--doctor --json` 已增加非路径化的 scope/runtime metadata。
- v0.1.5 当前只完成工作区实现和验证，尚未提升 npm 版本或重复发布；版本发布需单独决定。

## v0.3.0–v0.4.0 完成记录（2026-09-17）

- **Provider/model 管理：** `providers list|status|test` 与 `models list|current` 已接入显式 CLI
  路由；四类 provider 均有配置存在性、连通性和失败路径测试。API key、响应 body 和原始
  provider 异常不会进入结果。
- **选择与 fallback：** 项目配置支持 profiles、aliases 和显式 fallback order；显式 flags、
  profile/alias、环境变量、配置和默认值的优先级固定，fallback 未明确启用时不会切换。切换后的
  provider/model metadata 会写回当前 agent context。
- **预算：** AgentLoop 在 model/tool 边界前检查 turns、provider token usage、duration 和 output
  chars；超限不会启动下一次调用，并返回稳定 `budget_exceeded` JSON。已有 pricing/cost estimation
  保持兼容。
- **Code Search/index：** 新增可恢复的 index status metadata（files/symbols、signatures、cache
  hits/misses、errors、更新时间），支持显式 `index refresh/status/clear`、自定义 `--index-file`、
  confirmation-gated clear、增量 refresh 规划和删除/重命名边界；默认跳过 node_modules、构建产物、
  缓存、虚拟环境等目录，并应用 root `.gitignore`、`.ignore` 与显式排除规则。
- **MCP：** 新增 list/validate/status/test 管理命令；list/validate 是 metadata-only，status/test
  使用有界 stdio capability probe，超时、连接失败、取消和 capability 变化均映射到稳定 reason。
- **Desktop：** 新增 `/api/status` 与状态面板，展示 executor/runtime/provider/model/approval/
  validation policy/最近 validation result；payload 通过 allowlist 生成，不改变 session、evidence、
  Undo 或 approval schema。
- **验证与发布边界：** 工作区相关 package tests、CLI 309 项测试、Desktop 84 项测试及最终
  `pnpm verify` 已于 2026-09-17 全部通过；本轮不自动 bump version、tag、push 或 publish npm。
  下一步如需对外发布，仍需单独授权并先决定版本号、变更日志和发布渠道。
