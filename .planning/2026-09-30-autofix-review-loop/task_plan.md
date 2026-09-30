# 可审阅的 Autofix 修复闭环

## 目标

让 :autofix 在每轮 Agent 修复后先生成受保护的 change-set review，由用户明确批准或拒绝，再复用 trusted validation；保持其他窗口正在进行的 Ink 与 planning 改动不变。

## 阶段

- [complete] 盘点现有 Autofix、approval、change-set review、readline 与 Ink 边界
- [complete] 设计并实现可审阅的修复轮次状态与安全摘要
- [complete] 接入 readline/Ink，并保持 JSON、pipe 与取消语义稳定
- [complete] 添加 focused 回归与独立计划记录（保留其他窗口的文档改动不动）
- [complete] 运行构建、focused tests、CLI 全量回归并检查 scoped diff

## 约束

- 只修改本功能明确涉及的文件；不触碰其他窗口的 Ink、planning、.mimosa/、.zcode/ 或未跟踪文件。
- 不绕过现有 ApprovalPolicy、FilesystemTool change-set guard 或 trusted validation。
- 审阅内容只允许 bounded metadata/diff，禁止原始工具输出、凭据、绝对路径和终端控制字符进入提示或 UI。
- 不自动 commit、push 或发布。

## 当前执行切片

- [x] 明确 Agent 产生修改后的 review handoff、拒绝/取消和下一轮 retry 语义。
- [x] 保持已有 :autofix [1-3] 命令兼容，避免破坏非交互调用。
- [x] 补齐 Ink 路径的 plan → review → apply 调度，并保护等待中的普通 plan。

## Follow-up：可恢复的 Autofix 审阅结果

### 目标

拒绝或取消 Autofix 审阅后，保留最近的 bounded change-set，使用户可以用 :autofix review 重看、:autofix apply 在确认后精确应用，或用 :autofix discard 丢弃；不重新调用模型，不绕过 preimage guard/trusted validation。

### 阶段

- [complete] 设计可恢复 review 的命令解析、状态边界与 session 生命周期。
- [complete] 先补命令与状态行为的 failing tests，再实现 readline/Ink 两条路径。
- [complete] 运行 focused/full scoped 验证，检查暂存边界并交付。

## 下一阶段：跨 session 恢复 Autofix review

### 目标

让被拒绝或取消的 Autofix review 以受保护、限界的 session metadata 持久化；用户执行同进程 session resume 后，可以用 :autofix review 重看、:autofix apply 在确认后精确应用，或用 :autofix discard 清除。CLI 重启后允许恢复 review/discard，但由于待应用 change-set 不包含可执行 mutation，:autofix apply 必须明确 fail-closed；任何可应用路径都不重新调用模型，且继续绑定原 session/workspace、preimage guard 与 trusted validation。

### 验收标准

- review metadata 只保存 bounded prompt、PlanReview 和 session/workspace binding，不保存原始工具输出、凭据或绝对路径。
- 同进程同一 session/workspace resume 后可恢复 review 并精确 apply；不同 session 或 workspace 不可应用，且失败关闭。
- CLI 重启后可以恢复 bounded review 供 review/discard；若运行时没有原始待应用 change-set，apply 返回明确的不可恢复错误，不尝试重建或调用模型。
- readline 与 Ink 都支持恢复、重看、应用和丢弃；普通 plan/apply 冲突保护继续有效。
- 应用恢复 review 时模型请求数不增加，成功后 trusted validation 仍执行。
- 新增测试先红后绿；focused tests、typecheck、build 通过；不修改其他窗口文件，不自动提交或推送。

### 阶段

- [complete] 盘点 session resume、FileMemory/change-set evidence 与可持久化 review 边界。
- [complete] 先补持久化 schema、绑定和恢复行为的 failing tests。
- [complete] 实现 readline/Ink 的持久化、恢复、丢弃和失效处理。
- [complete] 运行 focused/full scoped 验证并更新交付记录。

## Errors Encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Ink Autofix 补丁上下文不匹配 | 1 | 未写入文件；重新读取当前 index.ts 后按现有代码边界补丁。 |
| 测试补丁上下文中的转义文本不匹配 | 1 | 未写入文件；按实际源码重新定位并仅替换 Autofix preview 请求。 |
| CLI 全量测试末尾取消 validation/workflow 文件 | 1 | 两个文件单独复跑 23/23 通过；focused Autofix 13/13 通过。 |
| sessionDir 查询的 rg 正则未闭合 | 1 | 改用 rg -F 固定字符串搜索，未产生文件改动。 |
| CLI review store 测试首次编译缺少模块 | 1 | 按 TDD 先确认红灯，再实现 autofix-review-store.ts。 |
| build 与 CLI test compile 并行导致 dist 竞态 | 1 | 后续按 build 完成后再单独执行 test TypeScript 编译。 |
| CLI typecheck 使用错误 workspace filter | 1 | @dev-agent/cli 未匹配项目；改用实际包名 @agent_cli/cli。 |
| session startup 查询的 rg 正则未闭合 | 1 | 改用 rg -F 固定字符串搜索，未产生文件改动。 |
| pending review 状态查询的 rg 正则未闭合 | 1 | 改用两个 rg -F 固定字符串查询，未产生文件改动。 |
| 计划状态 patch 上下文不匹配 | 1 | 重新读取当前阶段片段后按实际内容更新，未修改业务代码。 |
| validation 全量测试中 persisted change-set 新进程场景超时 | 1 | 先单独复现并检查是否与本阶段 FileMemory/CLI 改动相关，暂不修改无关逻辑。 |
| review store 首次路径修复误判 POSIX 绝对路径 | 1 | 根据 Node win32.isAbsolute 行为和 plan-command 参考，改为显式 Windows drive/UNC 检查 + workspace relative containment。 |
| pending review 文本保留了绝对 workspace path | 1 | 复用 Autofix removeAbsolutePaths 规则，并加入 prompt/diff 回归断言。 |

## 下一阶段：Autofix UX 可发现性与 Ink 回归覆盖

### 目标

让用户在 readline banner、:help 和 Ink command palette 中直接发现 :autofix 的 review/apply/discard 子命令，并用不触碰其他窗口 Ink 组件的 focused 回归测试锁定提示内容与恢复闭环。

### 验收标准

- 所有用户可见命令提示明确列出 :autofix review、:autofix apply、:autofix discard，同时保留 :autofix [1-3] 的兼容说明。
- command hint/parser 回归测试覆盖新提示，且不修改其他窗口正在编辑的 apps/cli/src/ink/app.tsx。
- 既有 Autofix persistence、session resume、restart fail-closed 和 full scoped validation 继续通过。
- 不自动 commit 或 push。

### 阶段

- [complete] 更新命令提示、banner 和 help 文本。
- [complete] 补提示/command palette 回归测试。
- [complete] 运行 focused 与 scoped 验证并更新交付记录。

## 下一阶段：全命令族 smoke verification

### 目标

对 CLI 当前公开命令族逐项完成可重复的测试/验证：普通命令、session/plan、Autofix、validation/evidence、MCP、provider/config/runtime、skills/agents/extensions、memory/security/marketplace、team/collaboration、GitHub workflow、checkpoint、background tasks 和输出模式；危险命令只验证 guard/拒绝路径，不执行真实破坏性操作。

### 验收标准

- CLI 全量测试套件完整跑完，不手动中断；记录总通过/失败/取消数量。
- 每个命令族至少有对应 focused test 文件或明确的现有覆盖；失败项单独复现并判断是否为本阶段回归。
- typecheck、build、diff check 通过；不修改其他窗口文件，不自动 commit/push。

### 阶段

- [complete] 建立命令族到测试文件的覆盖矩阵。
- [complete] 完整运行 CLI suite 并处理真实回归。
- [complete] 单独复跑异常命令族，更新最终覆盖报告。

## 下一阶段：桌面端功能对齐与健康审计

### 目标

检查桌面端当前实现、测试和运行入口，确认核心能力是否可构建、可测试、可启动，并识别 CLI 已有但桌面端缺失或体验不一致的高价值功能；本阶段以审计报告和可复现证据为交付，不擅自修改其他窗口代码。

### 验收标准

- 桌面端 typecheck、build 和全量测试完整运行并记录结果。
- 盘点 session/chat、approval/review、plan/apply、validation/evidence、MCP、GitHub、tasks/schedules、settings/runtime 等功能面。
- 明确区分已实现且有测试、已实现但缺少端到端证据、CLI 有而桌面端缺失、当前被环境/权限阻塞。
- 只读审计不改变其他窗口的 tracked、staged 或 untracked 文件，不自动 commit/push。

### 阶段

- [complete] 运行桌面端构建与全量测试，建立基线。
- [complete] 对照 CLI/桌面端公开能力做功能矩阵审计。
- [complete] 输出风险排序、复现证据和下一步开发建议。

## 下一阶段：桌面 Git metadata 超限修复

### 目标

修复多窗口工作区存在大量未跟踪文件时，桌面端项目 capability 被错误降级为 invalid 的问题；保留 bounded 输出、dirty 判断和安全 fail-closed 行为。

### 阶段

- [complete] 先补大量未跟踪文件的 failing test。
- [complete] 使用不展开目录内容的 Git 状态统计实现最小修复。
- [complete] 运行桌面端 focused/full 验证并更新审计结论。

## Desktop audit errors

| Error | Attempt | Resolution |
|---|---:|---|
| Desktop capabilities GitHub metadata route expected ready but returned invalid | 1 | Desktop baseline completed 359 tests with 358 pass; focused reproduction pending. |

## Errors Encountered (full command verification)

| Error | Attempt | Resolution |
|---|---:|---|
| CLI full suite session-list --no-stream test failed | 1 | Full suite completed 804 tests with 803 pass; single-test reproduction pending. |
| full suite session-list --no-stream transient failure | 2 | Single-test rerun passed; second complete CLI suite passed 806/806. |

## 下一阶段：桌面端 Autofix 审阅闭环

### 目标

把 CLI 已有的 Autofix review/apply/discard 能力接入桌面端，优先建立服务端生成受保护 plan review、复用现有 plan apply/preimage guard/trusted validation 的闭环，再补桌面 UI 触发入口和恢复状态。

### 验收标准

- 桌面端能从最新 failed/blocked validation 生成 bounded Autofix plan review，并通过 SSE 返回。
- apply/discard 复用现有 pending plan/change-set 机制，不重新调用模型，不绕过 guard 或 validation。
- 无可修复 validation、session 冲突、超限输入和跨 session 使用均 fail-closed。
- 新增 server/ChatSession/客户端 focused 测试，现有 Desktop suite 继续全绿。
- 不修改其他窗口文件，不自动 commit/push。

### 阶段

- [complete] 先补 Autofix prompt/target 与 server route 的 failing tests。
- [complete] 实现 ChatSession/server 的 Autofix preview/apply/discard 接线。
- [complete] 补桌面 UI 触发入口与恢复状态，再跑全量验证。
