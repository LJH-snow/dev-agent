# dev-agent 超长期开发路线：安全、可观察、可恢复的开发执行中心

## 总目标

把当前 dev-agent 逐步完善为一套可持续使用的本地开发执行中心：用户能看懂运行发生了什么、在后台运行结束后不会错过结果、可以从历史记录回到验证和变更证据、可以恢复中断的会话和队列，同时 CLI 与 Desktop 的关键行为保持一致。

完成不以功能看起来存在为准，而以每个阶段都有 RED 到 GREEN 测试、构建和类型检查、边界回归以及必要的真实 UI 或 PTY 证据为准。

## 永久边界

- 保持 metadata-only：默认不持久化 prompt、原始工具输入/输出、命令、环境变量、凭据、绝对路径或原始错误。
- 所有用户输入、历史记录、外部 GitHub/MCP 内容和浏览器数据都视为不可信数据；使用 bounded normalization、textContent 和 fail-closed 分支。
- 不新增 unrestricted shell、任意网络、凭据读取、远程 mutation 或绕过审批/沙箱的入口。
- 不修改并行窗口的 apps/desktop/src/autofix.ts、apps/desktop/tests/autofix-loop.test.ts 及其关联未提交计划。
- 不修改、不回滚、不清理 .mimosa/ 既有改动；不使用 broad restore、reset、clean、checkout 或 stash。
- 不自动 git commit、git push、发布 npm、创建 release 或重启宿主应用。
- 每个阶段使用独立 .planning/<date>-<slug>/ 账本；不覆盖当前并行窗口的 active plan。

## 当前基线与已完成能力

- Desktop Execution Center 已有 bounded snapshot、session 详情、持久化历史、历史详情、验证/变更集证据跳转。
- 历史列表已有 run ID 搜索、运行状态筛选、验证状态筛选、上一条运行对比和安全摘要复制。
- 既有工作台已有 Run Inspector、runtime trace、终端、loopback preview、task workspace、验证中心、Changes Center、MCP health、GitHub read-only 诊断和 scheduled tasks。
- 当前 Desktop 全量测试基线为 400/400；最近历史功能 focused 为 14/14；最近代码构建、测试类型编译和 git diff --check 已通过。
- 工作区有大量并行未提交改动；这些改动不是本路线的清理对象。

## 长期阶段总览

### 阶段 0：基线、边界和证据账本（已完成）

交付：建立本路线计划、findings、progress；记录工作区保护边界；确认当前测试基线和真实接入点。

门槛：能从账本回答当前阶段、下一个阶段、受保护文件和最后一次验证结果；任何命令失败都记录原因和替代方案。

### 阶段 1：运行完成通知与未读状态（已完成）

交付：

- 为每个 session 建立有界的 completion notification projection，只保存 session/run ID、终态、时间和是否已读。
- 统一处理正常完成、失败、中止、等待审批和 plan review 等边界；plan review 不应误报为最终完成。
- 当前 session 可自动清除未读；切换 session、后台运行完成和刷新后状态不串线。
- Execution Center 展示未读数量和最近终态，支持查看、全部标记已读及单条清除；所有按钮有中英文文案、键盘焦点和 aria-live 状态。
- 通知不读取或展示原始消息，不触发模型、重跑、apply、rollback 或远程写入。

验收：先写模型、渲染、生命周期 RED 测试；覆盖 done、failed、aborted、等待 plan、session rename/delete、stale event、重复 done 和刷新；再做 Desktop focused、全量和隔离浏览器验收。

### 阶段 2：历史视图与安全导出（已完成）

交付：

- 支持保存一组有界筛选条件（session、运行状态、验证状态、时间窗口）到本地 UI 状态，不写入敏感历史。
- 支持历史列表分页/加载更多或明确的有界窗口，保证响应、渲染和 DOM 数量上限。
- 增加 metadata-only Markdown/JSON 摘要导出，导出前明确显示字段范围和估算大小。
- 导出严格排除 prompt、tool payload、command、path、raw output、凭据和私密错误；未知字段 fail-closed。

验收：导出快照 golden tests、超大数据测试、旧 schema 兼容测试、浏览器下载/复制验收和文档契约测试。

### 阶段 3：会话生命周期与运行恢复（已完成）

交付：

- 系统化覆盖 session rename、delete、reload、active fallback、history migration、pending plan、approval allowlist、run replay 和 task workspace 绑定。
- 运行恢复接口明确区分 active、waiting、done、failed、aborted、unknown 和 stale cursor。
- 刷新/切换过程中旧响应不能覆盖新 session；恢复失败必须有稳定、脱敏、可行动的状态。
- 对需要恢复的内存态设置明确的生命周期上限和清理时机。

验收：重启、并发 rename/delete、活动 session 删除、cursor gap、重复 done、客户端断开和恢复后继续操作的端到端测试。

### 阶段 4：队列、审批和计划执行可靠性（已完成）

交付：

- 统一排查 prompt queue、plan review、approval request、sandbox expansion 和 cancellation 的状态机交叉路径。
- 确保队列 FIFO、active/waiting/paused 状态可解释；失败或中止不会丢失等待项也不会自动重跑危险操作。
- 计划 apply 只使用用户审阅过的 change set；取消、超时、stale review、重复 apply 和跨 session 复用都 fail-closed。
- 补齐 UI 上的恢复、重试、放弃和需用户处理状态，但不绕过授权。

验收：Agent Core、Desktop、CLI 三侧状态机测试；真实 MCP transport/approval seam 测试；并行运行隔离测试。

### 阶段 5：证据、验证和变更血缘（已完成）

交付：

- 将 validation attempt、change set、rollback、rerun、Autofix target 和 run summary 的关联规则写成稳定 contract。
- 显示验证历史、最新结果、失败原因的 bounded summary；支持从运行回到正确证据，不让 session/change set 串线。
- 处理旧记录无 validationId、重复 validation、rolled-back change set、跨工作区恢复和 postimage conflict。
- 保留现有 evidence audit/preview 限制，不把完整 diff 或输出塞进运行历史。

验收：证据 schema、过滤、导出、parity 测试，跨重启和跨 session 隔离测试，隔离 Git fixture 浏览器验收。

### 阶段 6：Task Workspace 与 Changes Center 完整闭环（已完成）

交付：

- 让任务选择、工作树状态、Changes Center、review comment、验证、merge/cleanup 的生命周期一致。
- 保持 committed/staged/unstaged/untracked 的区分和有界 diff anchor；禁止把未提交用户改动误当作可清理内容。
- 补齐 dirty worktree、缺失 worktree、恢复工作目录、merge 冲突和 cleanup 拒绝的可视状态。
- 评论和筛选只作用于当前 task，不能跨 session 泄漏。

验收：临时 Git 仓库 fixture、脏工作区矩阵、浏览器 split/unified diff、键盘导航和合并边界测试。

### 阶段 7：Terminal 与 Preview 的可恢复体验（已完成）

交付：

- terminal reconnect、sequence gap、输出滚动、命令历史、清空/导出、进程组清理和 session 绑定形成统一状态模型。
- preview 只允许 loopback HTTP(S) 与显式端口；iframe stale event、加载失败、清理和生命周期 trace 不产生假状态。
- 终端输出/输入/命令历史和 preview URL 不进入 trace、history 或 export；复制和插入上下文继续 bounded。
- 确定长输出、手动滚动、恢复、断开、停止和重复连接的用户行为。

验收：Desktop focused、真实本地 PTY、隔离浏览器和生命周期 trace 对照；不使用外部生产项目。

### 阶段 8：MCP、审批、沙箱和能力边界复核（已完成）

交付：

- 将 MCP action/resource/prompt 分类、审批风险、server-scoped capability token、loopback/origin 检查和 Rust sandbox profile 做一次端到端审计。
- notification/list_changed 不得把旧能力、旧授权或旧 session 数据泄漏到新状态。
- worker-scoped MCP 若没有完整的 server selection、外部资源语义、并发上限和清理 contract，则保持明确 NO-GO，不为了功能数量强行实现。
- 所有缺失 metadata、错误 token、错误 origin、未连接 MCP、sandbox denial 和取消路径 fail-closed。

验收：Agent Core、Tools、CLI、Desktop、MCP transport、Rust integration 分层测试和安全契约检查。

### 阶段 9：CLI 与 Desktop 关键体验对齐（已完成）

交付：

- 对齐运行状态、审批、plan review、验证结果、取消、恢复和错误分类的用户可见语义，但保留各端适合的交互形式。
- CLI Ink viewport、PageUp/PageDown、mouse wheel、scrollback、composer/queue 和 PTY clean exit 持续有行为评估。
- provider/model metadata、默认配置、skills、scheduled work 和可选 Claude Agent SDK 边界不被 Desktop 功能倒灌破坏。
- 新增能力优先共享 metadata projection/contract，避免复制敏感执行逻辑。

验收：CLI focused/full、rich TUI evals、真实 fixture provider PTY、Desktop 全量及跨端 contract tests。

### 阶段 10：无障碍、双语和响应式质量（已完成）

交付：

- 所有新增 panel、筛选、详情、通知和导出动作具备键盘顺序、可见焦点、可读 label、disabled 语义和 aria-live。
- 中英文文案完整，动态状态不把英文 key 泄漏到界面；窄视口、密集模式、深浅色和 reduced-motion 行为稳定。
- 文本溢出、长 ID、空状态、错误状态和加载状态可理解且不撑破布局。

验收：DOM/contract tests、视觉浏览器验收、键盘流程、窄视口截图和文案完整性检查。

### 阶段 11：性能、容量和故障注入（已完成）

交付：

- 对 history、evidence、trace、session list、terminal output、MCP metadata 和 export 统一记录数量、字符、字节和时间上限。
- 对大历史、重复刷新、并发 session、慢 fetch、断开连接、坏 JSON、磁盘失败和模型超时做故障注入。
- 避免每次 token/轮询产生无界 DOM 或 listener；对必要列表使用明确替换、虚拟化或分页策略。
- 记录可复现的性能基线，避免把通过建立在偶然的测试时序上。

验收：benchmark、bounded-response tests、慢路径和资源清理检查；不牺牲安全上限换取速度。

### 阶段 12：发布候选、文档和维护闭环（已完成）

交付：

- 同步 README、架构文档、运行手册、release checklist、CHANGELOG 和各阶段 findings/progress。
- 运行 workspace build/typecheck/tests、Desktop/CLI focused、package smoke、documentation contracts、native Desktop、Rust unit/integration 和 release gate。
- 做一次从干净临时 HOME/配置开始的启动检查；确认未跟踪 QA 产物和凭据不进入 diff。
- 生成最终验收清单和已知边界；只有用户明确要求才提交/推送。

完成门槛：所有阶段 checklist 完成；所有 required gates 有本轮证据；浏览器/PTY 关键流程至少各有一次隔离验收；工作区保护边界仍满足。

### 阶段 13：CI 完整 verify gate（已完成）

交付：

- 在 GitHub Actions 中新增独立 `full-verify` job，执行完整 `pnpm verify`。
- 为完整 gate 提供 Rust、bwrap、PTY、ripgrep、protobuf 和 Linux user namespace 前置条件。
- 保留现有 TypeScript、Rust、Linux integration、macOS integration job，继续提供清晰的失败边界。
- 以 workflow contract 测试锁定 job、环境变量、前置顺序和完整命令。

验收：CI workflow contract、release-gate contract、结构检查和 `git diff --check` 通过；完整 gate 命令在 CI 配置中唯一且可见。

## 阶段执行规则

1. 每次只推进一个可验证切片，先读当前阶段账本和相关代码。
2. 新行为必须先写 RED 测试并观察预期失败，再写最小实现。
3. 每两次搜索、浏览或视觉操作后，把发现写进 findings/progress，避免上下文丢失。
4. 每个阶段完成后运行最窄 focused gate，再逐步扩大到 Desktop、CLI、full 和 release gate。
5. 遇到并行文件、凭据、外部远程 mutation 或需要用户授权的动作，停在边界并记录，不擅自绕过。
6. 每轮结束报告真实完成项、测试输出、未完成项和下一步；不把计划写完等同于代码完成。
