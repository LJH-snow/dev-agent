# Progress

## 2026-09-30

- 用户确认当前其他窗口的未提交改动不应被触碰。
- 已建立独立计划目录，后续只围绕可审阅 Autofix 闭环工作。
- 已完成核心状态扩展与 readline plan/review/apply 流程；下一步仅补 Ink 调度、测试和校验。
- 发现上一次 Ink 补丁因上下文不匹配未写入，已重新读取目标区段；没有产生额外文件变更。
- 已完成 Ink plan → review → confirmation → exact apply 流程，拒绝/取消不会启动 validation；普通 pending plan 有冲突保护。
- pnpm --filter @agent_cli/cli run typecheck、CLI build、test TypeScript 编译均通过。
- Autofix focused tests：13/13 通过；validation/workflow 单独复跑：23/23 通过。
- CLI 全量 suite：756 通过，末尾两个长生命周期测试被取消；单独复跑后均通过，未发现本任务相关失败。

## 2026-09-30 follow-up

- 用户同意继续开发“Autofix 审阅结果可恢复”：review / apply / discard。
- 已按 TDD 先补 parser 与 readline 集成红灯测试，再实现 review/apply/discard 命令。
- 新增 session-local pending review，保存原始 AgentContext、prompt 和 PlanReview；拒绝/取消保留，成功 apply 后清除，:clear/session resume 会清除。
- readline 与 Ink 都会复用原 change-set 的 applyPlannedChangeSet、preimage guard 和 trusted validation；恢复 apply 不重新调用模型。
- focused parser tests：12/12 通过；Autofix CLI integration：2/2 通过。
- pnpm --filter @agent_cli/cli run typecheck、CLI build 与 test TypeScript 编译均通过。
- 未触碰其他窗口的 Ink、文档、planning、.mimosa/、.zcode/ 或未跟踪文件；未 commit/push。

## 2026-09-29 next phase

- 用户授权自主制定下一阶段；选定目标为跨 session/CLI 重启恢复被拒绝或取消的 Autofix review。
- 验收重点：bounded metadata、session/workspace binding、同一 change-set 的 preimage guard/trusted validation，以及恢复 apply 不新增模型请求。
- 当前阶段为 session resume 与持久化边界盘点，尚未修改业务代码或测试。
- 盘点完成：FileMemory 可持久化 metadata，但 FilesystemTool 的 planned change-set 只存在进程内；applied evidence 不含可执行 mutation/before-image，不能安全用于跨重启 apply。
- 目标收敛为：同进程 session resume 支持精确 apply；重启后只恢复 review/discard，apply 对缺失 runtime plan 明确 fail-closed，不保存可执行 mutation 或原始工具输出。
- 已新增 FileMemory 红灯测试：pending Autofix review 应跨实例持久化并可 clear；当前 38 个 memory 测试中 37 通过、目标测试因 API 尚不存在而失败。
- 已新增 CLI review-store 红灯测试：要求 bounded/relative-path 脱敏、同 workspace restore 和跨 workspace fail-closed；当前因模块尚不存在而编译失败。
- 已新增同进程 session-switch CLI 红灯测试；当前实现拒绝后切换回原 session 时 :autofix review 不再显示，证明 interactive 生命周期尚未接入持久化记录。
- 已实现 PendingChangeSetReview 的 bounded FileMemory/InMemoryMemory capability，以及 CLI review-store 的 relative-path、敏感文本清理和 workspace binding。
- readline 与 Ink 均在生成 review 后持久化；同进程 session resume 恢复并可精确 apply；重启后 review/discard 可用，apply 明确 fail-closed，不调用模型。
- focused verification：FileMemory 38/38、review-store 3/3、auto-fix-command 12/12、Autofix CLI 4/4 通过；CLI/agent-core typecheck 与 build 通过。
- agent-core 全量测试：223/223 通过；session-registry 4/4、session-resume 3/3、plan-command 7/7 通过。
- validation 全量并行执行时有 1 个既有新进程场景超时；单独复跑该场景已通过，诊断改动已撤销，下一步单独复跑 validation 全集确认稳定性。
- validation 全集单独复跑 17/17 通过；agent-core 全量 223/223 通过；scoped diff check 通过且无调试残留。
- 本阶段业务改动仍未 commit/push；只保留本阶段源码/测试改动及既有未跟踪工作目录，未触碰其他窗口文件。
- 追加绝对路径安全回归后，review-store 3/3 与 Autofix CLI 4/4 仍通过；prompt/diff 不再持久化绝对 workspace path。

## 2026-09-30 UX follow-up

- 用户要求继续开发；选择下一阶段为 Autofix UX 可发现性与 Ink command palette 回归覆盖。
- 受保护文件：其他窗口的 apps/cli/src/ink/app.tsx，本阶段只修改命令提示/帮助文本和 focused 测试。
- 并行窗口已提交 UX 改动：6c0ca37 feat(cli): persist and expose autofix reviews；新增 :autofix review/apply/discard command hints，并更新 Ink palette 回归断言。
- UX 验证通过：Ink app 52/52、tui-renderer 15/15、Autofix focused 15/15；CLI typecheck/build 通过；未修改其他窗口的 Ink app 组件。

## 2026-09-30 full command verification

- 用户要求把所有 CLI 命令族完整测试一遍；本阶段先运行 CLI 全量 suite，再按命令族结果补充单独复跑和覆盖记录。
- CLI full suite completed without interruption: 804 tests, 803 passed, 1 failed in session-list.test.ts (CLI --no-stream is accepted as a valid flag).
- The failed session-list case passed in isolation, and a second complete CLI suite finished with 806/806 passed, 0 failed, 0 cancelled.
- Command-family coverage now includes approval/ordinary CLI, sessions/plan/Autofix, validation/evidence, MCP, provider/config/runtime, skills/agents/extensions, security/marketplace, team/collaboration, GitHub workflow, checkpoints/tasks/background jobs, index/project memory, Ink UI, output modes, package/install smoke, and Rust/runtime guards.

## 2026-09-30 desktop audit

- 用户同意进行桌面端功能对齐与健康审计；先建立构建/测试基线，再输出能力差异和风险排序。
- Desktop typecheck/build 通过；全量桌面测试为 359 个用例，358 通过、1 失败。
- 唯一失败是 capabilities.test.ts 的 monitoring project state：当前 workspace 的 git porcelain 输出约 206,872 字节，超过 capabilities.ts 的 16 KiB bounded git output，因而 fail-closed 为 invalid；GitHub route 本身返回 ready。
- 桌面端最近提交集中在 2026-09-25 至 2026-09-28，已有 65 个测试文件、359 个测试用例、20 个 source 文件和 21 个 public 文件；结论是持续开发中而非长期停滞，但当前 dirty multi-window workspace 暴露了 Git metadata 的环境耦合风险。
- 高价值下一步：让 inspectRepository 在超出 status 输出预算时保留 ready/dirty 的 bounded 结果或使用更窄的 Git status 统计，避免无关未跟踪目录把桌面监控面板降级为 invalid；本轮未修改业务代码。

## 2026-09-30 desktop Git metadata fix

- 用户要求继续开发；先为大量未跟踪文件导致的项目 capability invalid 增加回归测试，再实现最小修复。
- 已将 inspectRepository 的 Git status 改为 --untracked-files=normal，避免展开大型未跟踪目录；新增回归测试覆盖 1,200 个未跟踪文件。
- Desktop typecheck/build 通过；capabilities focused 8/8；Desktop 全量测试 360/360 通过。其他窗口文件未触碰，未 commit/push。

## 2026-09-30 desktop Autofix

- 用户同意把 CLI Autofix 审阅闭环接入桌面端；本阶段先从 prompt/target 与 server route 的 TDD 红灯开始。
- 已新增桌面 Autofix target/prompt 模块和 4 个 focused tests；ChatSession 暴露最新 failed/blocked target，server 新增 POST /api/autofix plan-mode SSE route，复用现有 pending plan/apply/discard 机制。
- 当前 Autofix focused tests 4/4 通过；UI 触发入口和全量 Desktop 回归仍待完成。
- 后端 preview route 已接入：POST /api/autofix 选择最新 failed/blocked validation，使用 plan mode SSE，并复用现有 pending plan apply/reject guard。
- Desktop Autofix backend focused tests：4/4 通过；Desktop 全量测试：364/364 通过；typecheck/build 通过。
- 当前剩余工作：public/index.html validation 卡片的 Autofix 触发按钮、SSE turn 状态和 review/apply/discard UI 状态接线。
- 已完成 public validation 卡片 Autofix 按钮、队列 kind 持久化和 /api/autofix SSE 调度；Desktop 全量测试最终 365/365 通过，typecheck/build 通过。
- Autofix 阶段完成：failed/blocked validation 可发起 plan review，用户可复用现有 review card apply/reject，模型不会被重复调用，队列和取消状态沿用桌面既有生命周期。
- 并行窗口当前正在修改 apps/desktop/public/index.html、public/task-validation-ui.js、public/styles.css、tests/task-validation-ui.test.ts 等 UI 文件；全量回归的唯一失败是其未完成的 taskValidation.autofix 文案契约。为避免覆盖并行工作，本窗口暂停 UI 文件修改，只保留并验证后端 Autofix 接线。
- Desktop baseline completed typecheck/build and 359 tests: 358 passed, 1 failed in capabilities.test.ts where GitHub metadata expected ready but received invalid.
