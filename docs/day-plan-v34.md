# v34 Change Set 派生验证与结果反馈实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 v33 的 reviewed change set 安全落盘之后，自动从实际变更路径派生最小、可解释、可取消的验证集合，把验证结果反馈给模型、CLI 和 Desktop；验证失败必须清楚地表示“修改已应用但检查失败”，不能伪装成 apply 失败，也不能未经用户要求自动回滚。

**Architecture:** `@dev-agent/agent-core` 定义与工具无关的 validation plan/result contract，并在 approved `apply` 完成后触发可注入的验证器；`@dev-agent/tools` 根据 change-set 文件路径和仓库布局生成受 allowlist 约束的验证命令，并通过现有 executor 运行；CLI 与 Desktop 复用同一 planner/runner，分别输出 JSON/human summary 与 SSE/UI 状态。验证器只接收已经存在的 change-set review 和受信任工作目录，不执行模型提供的任意 shell 字符串。

**Tech Stack:** Node.js 26 built-ins、TypeScript 5.9、现有 `SandboxExecutor`/`LocalExecutor`、Node test runner、pnpm workspace、Desktop SSE；不增加运行时依赖。

**Spec:** v33 完成后的下一阶段；核心结果字段为 `validationId`、`changeSetId`、`status` (`passed`/`failed`/`skipped`/`blocked`)、`checks`、`durationMs`、`summary`。

## Global Constraints

- 验证只能在 change set 已成功 apply 后运行；preview、deny、timeout、disconnect、preimage conflict、rollback 不得误触发验证。
- 验证命令必须由受信任的路径/仓库规则派生，不能把模型传入的任意字符串直接交给 executor；每条命令记录 cwd、参数、超时和退出结果。
- 默认选择最小集合：只检查受影响 package/运行时，不在每个普通文件变更后无条件跑整仓重型检查；无法安全推断时返回 `blocked`/`skipped` 和原因。
- 验证失败不撤销已应用的文件；用户可以通过 v33 的 guarded rollback 自主 Undo。结果必须同时携带 apply 成功状态与 validation 失败状态。
- 每个验证步骤继承外层 AbortSignal；超时必须终止实际进程，客户端断开和 Ctrl-C 不得留下后台检查。
- `allow`、`deny-dangerous`、`ask`、`review-writes`、MCP cancellation/progress、Rust sandbox 和 v33 change-set contract 保持兼容。
- 先为每个 Task 写失败测试并运行，再写最小实现；每个 Task 通过 focused test 后单独提交；任何接口变更先同步本计划和 progress ledger。

---

### Task 0: 建立 v34 进度账本和验证基线

**Files:**
- Create: `/Users/Admin/Desktop/dev-agent/docs/day-plan-v34-progress.md`
- Modify: `/Users/Admin/Desktop/dev-agent/docs/day-plan-v34.md`

**Interfaces:**
- 账本记录 v33 release commit、当前工作区、验证契约、每个 Task 的 RED/GREEN、测试数量和失败原因。
- 基线命令固定为 `git status --short --branch`、`git log -1 --oneline --decorate`、`pnpm build`、`pnpm typecheck`、`pnpm test`、executor integration 和 Rust checks。

- [x] **Step 1: 写 progress ledger。** 记录 v34 目标、v33 release commit `4ee7ab7`、当前远端状态和阶段顺序。
- [x] **Step 2: 运行并记录基线。** 验证 workspace clean、TypeScript 512/512、Rust unit/doc 46/46、real-binary integration 10/10。
- [x] **Step 3: Commit the plan and ledger.**

```bash
git add docs/day-plan-v34.md docs/day-plan-v34-progress.md
git commit -m "docs: add v34 validation plan"
```

### Task 1: 定义 validation contract 和确定性最小集合 planner

**Files:**
- Create: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/validation.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/index.ts`
- Create: `/Users/Admin/Desktop/dev-agent/packages/tools/src/validation-plan.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/packages/tools/package.json`
- Modify: `/Users/Admin/Desktop/dev-agent/pnpm-lock.yaml`
- Modify: `/Users/Admin/Desktop/dev-agent/packages/tools/src/index.ts`
- Tests: `/Users/Admin/Desktop/dev-agent/packages/agent-core/tests/validation.test.ts`
- Tests: `/Users/Admin/Desktop/dev-agent/packages/tools/tests/validation-plan.test.ts`

**Interfaces:**
- `ValidationStatus`、`ValidationCheck`、`ValidationResult`、`ValidationPlan`：字段包含 `validationId`、`changeSetId`、`status`、`checks`、`durationMs?`、`summary`、`reason?`。
- `ValidationRunner`：`run(plan, options?): Promise<ValidationResult>`，接受 `AbortSignal`，不暴露任意 shell 拼接接口。
- `deriveValidationPlan(review, context)`：按仓库相对路径、包边界和文件类型派生稳定排序的 check ids/commands；同一 review 在同一仓库快照上必须得到相同 plan。

- [x] **Step 1: 写失败测试。** 覆盖 agent-core contract 导出、无变化/文档-only、单 package TS、跨 package TS、Rust runtime、测试文件、未知扩展、重复路径和稳定排序；断言不把模型文本作为命令执行。
- [x] **Step 2: 运行 focused tests 确认失败。**

```bash
pnpm --filter @dev-agent/agent-core test -- --test-name-pattern="validation"
pnpm --filter @dev-agent/tools test -- --test-name-pattern="validation plan"
```

Expected: FAIL，因为 validation DTO、planner 和公共导出不存在。

- [x] **Step 3: 实现 contract 和 planner。** 只生成受信任的结构化 check 定义；先支持 TypeScript package、Rust runtime、test-only、docs/config fallback，未知路径返回可解释的 skipped/blocked，不生成任意命令。
- [x] **Step 4: 运行 agent-core/tools focused + full tests。**
- [x] **Step 5: Commit。**

### Task 2: 实现受约束 runner、超时和取消

**Files:**
- Modify/Create: `/Users/Admin/Desktop/dev-agent/packages/tools/src/validation-runner.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/packages/tools/src/index.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/validation.ts`
- Tests: `/Users/Admin/Desktop/dev-agent/packages/tools/tests/validation-runner.test.ts`

**Interfaces:**
- `createValidationRunner(executor, options)`：只运行 planner 生成的 check，统一 capture bounded stdout/stderr、exit code、duration、timeout/abort 状态。
- 每个 check 有独立结果；一个 check 失败默认停止后续高成本 check，并将未运行项标记 `skipped`，而不是丢失信息。

- [x] **Step 1: 写失败测试。** 覆盖 pass/fail、超时会杀掉进程、AbortSignal、输出上限、cwd、命令参数不可注入、失败后的 skipped 和空 plan。
- [x] **Step 2: 运行 focused test 确认失败。**
- [x] **Step 3: 用现有 executor 实现 runner。** 不重复实现进程组终止、Rust cancel 或 quota；把 executor 错误归一化为 check result。
- [x] **Step 4: 运行 tools 全套测试。**
- [x] **Step 5: Commit。**

### Task 3: 将验证接入 AgentLoop 的 apply 生命周期

**Files:**
- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/loop.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/approval.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/validation.ts`
- Tests: `/Users/Admin/Desktop/dev-agent/packages/agent-core/tests/validation-lifecycle.test.ts`

**Interfaces:**
- `AgentLoopOptions.validation` 或等价注入点：提供 `prepare(review)`/`run(plan, signal)`，不让 agent-core 依赖 `@dev-agent/tools`。
- 新增 `onValidation` callback；事件顺序明确为 `approval` → `tool-result`（apply）→ `validation`，或在现有生命周期中记录同等可观察顺序。

- [x] **Step 1: 写失败测试。** 覆盖 approved apply 才验证、deny/prepare failure/preimage conflict 不验证、validation failure 不伪装 apply failure、abort 会取消 runner、无 validation 注入保持 v33 行为。
- [x] **Step 2: 运行 focused test 确认失败。**
- [x] **Step 3: 实现最小生命周期和 callback。** validation result 写入模型可见的 tool result/context，但不自动 rollback。
- [x] **Step 4: 运行 agent-core 全套测试。**
- [x] **Step 5: Commit。**

### Task 4: CLI 验证展示和结构化输出

**Files:**
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/index.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/packages/tools/src/validation-plan.ts`
- Tests: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/validation.test.ts`

- [x] **Step 1: 写失败测试。** 覆盖 human 输出、`--json` 单对象的 `validations`、失败/跳过摘要、`review-writes` 与 validation 的组合，以及 MCP server 没有验证 runner 时的安全行为。Ctrl-C 的底层取消行为由已有 CLI/AgentLoop/runner 测试覆盖。
- [x] **Step 2: 运行 focused test 确认失败。** 初始新增 CLI validation tests 在 `validations` 字段尚未接入时失败；human command-summary 回归测试在实现前也失败。
- [x] **Step 3: 接入同一 planner/runner。** human mode 展示 check id、结构化命令摘要、耗时和失败原因；JSON 保持 stdout 单值并保留完整结构化结果；非 Git workspace 不运行 `git diff --check`。
- [x] **Step 4: 运行 CLI build + full tests。**
- [x] **Step 5: Commit。**

### Task 5: Desktop SSE、验证卡片和 Undo 协同

**Files:**
- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/loop.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/tests/validation-lifecycle.test.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/src/chat-session.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/public/index.html`
- Tests: `/Users/Admin/Desktop/dev-agent/apps/desktop/tests/validation.test.ts`

> `server.ts` 保持通用 SSE 转发，不需要为新增事件增加分支；validation 的 SSE、session 隔离和 cancel 行为由新增 Desktop tests 覆盖。

- [x] **Step 1: 写失败测试。** 覆盖 validation SSE payload/order、失败/取消 UI、验证中 Stop、validation 与 Undo 并存、session 隔离和既有未知事件兼容。
- [x] **Step 2: 运行 focused test 确认失败。** 初始 functional run 在 ChatSession 尚未接入 validation、UI 尚未处理 `validation` 事件时失败。
- [x] **Step 3: 接入 validation callback 和安全 UI。** ChatSession 复用同一 planner/runner；验证结果显示 pass/fail/skipped/blocked；Undo 仍只回滚已 apply 的 change set；取消时先发送 blocked validation，再以 aborted done 收尾。
- [x] **Step 4: 运行 Desktop 全套测试和浏览器脚本语法检查。**
- [x] **Step 5: Commit。**

### Task 6: 文档、全量回归与发布

**Files:**
- Modify: `/Users/Admin/Desktop/dev-agent/packages/tools/README.md`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/README.md`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/README.md`
- Modify: `/Users/Admin/Desktop/dev-agent/README.md`
- Modify: `/Users/Admin/Desktop/dev-agent/docs/CHANGELOG.md`
- Modify: `/Users/Admin/Desktop/dev-agent/docs/day-plan-v34-progress.md`
- Modify: `/Users/Admin/Desktop/dev-agent/docs/day-plan-v34.md`

- [x] **Step 1: 文档化 validation contract、默认 check 集合、失败语义、取消语义和 `validations`/SSE payload。**
- [x] **Step 2: 运行完整验证。**

```bash
node scripts/check.mjs
pnpm build
pnpm typecheck
pnpm test
pnpm --filter @dev-agent/executor test:integration
cd runtime/rust
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cd ../..
git diff --check
```

- [x] **Step 3: 统计测试和人工 review。** 已确认命令派生不可注入、验证失败不自动回滚、abort 通过共享取消链路收敛、MCP 无交互行为安全、v33 Undo guard 不回归。
- [x] **Step 4: Commit and push。**

**Task 6 verification record (2026-09-14):**

- `node scripts/check.mjs`: 13 directories and 34 expected files verified.
- `pnpm build` and `pnpm typecheck`: passed.
- `pnpm test`: **543/543** TypeScript tests passed (model 54, code-intelligence 30, MCP 49, executor 48, agent-core 86, tools 106, Desktop 65, CLI 105).
- Real Rust-binary integration: **10/10** passed.
- Rust `fmt --check`, `clippy --all-targets -- -D warnings`, and unit/doc tests: **46/46** passed (43 library, 3 binary; 0 doctests).
- Desktop inline browser script: **1/1** `node --check`; `git diff --check`: passed.
- Manual review confirmed structured allowlisted commands, no model shell/diff injection, apply/validation status separation, no automatic rollback, abort propagation, MCP no-review denial, and v33 guarded Undo compatibility.

## Acceptance Checklist

- [x] 同一 change set 在同一仓库快照上生成稳定、最小、可解释的 validation plan。
- [x] planner 不执行模型提供的任意命令；每条 check 的命令、cwd、timeout 和结果可审计。
- [x] approved apply 后才运行验证；deny/冲突/rollback 不误触发。
- [x] 验证支持 pass/fail/skipped/blocked、超时、取消和 bounded output；失败不会遗留后台进程。
- [x] validation failure 明确表示 apply 已完成且检查失败，不自动覆盖用户的 rollback 决策。
- [x] CLI human/JSON 与 Desktop SSE/UI 展示同一 validation DTO；MCP 无交互路径保持安全。
- [x] v33 的 review diff、preimage/postimage guard、Undo、旧 approval modes、MCP cancellation/progress 和所有 Rust checks 无回归。

## Execution Protocol

- 先完成 Task 0，再按 Task 1 → 2 → 3 → 4 → 5 → 6；每个 Task 通过 focused tests 后单独提交。
- 每次新增 command/check 先写 planner 测试与注入防护测试；不允许通过字符串拼接绕过 allowlist。
- 每次验证取消、失败或 rollback 后，优先检查实际进程和工作区 bytes/hash，再继续下一步。
- 完成 Task 6 之前不宣称 v34 完成；完成后把实际 commit、push、测试数量和剩余限制写入 progress ledger。
