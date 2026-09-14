# Day plan v40：verification report 与受控 operator feedback

**建立日期：2026-09-14**

> 本计划承接 `docs/day-plan-v39.md`。v39 已把固定 release gate 接入本地/CI，并把 before-image 保持在七项安全闸门之外；v40 只增加可审计的门禁结果输出，不扩大 evidence、Undo 或命令执行边界。

## Goal

为固定 release gate 增加一个默认关闭、可显式请求的 metadata-only 结果报告，让本地和 CI 能稳定读取阶段、状态、耗时和失败位置；同时继续评估 audit export 的大小/版本边界，但不把 before-image 或任何历史命令变成执行输入。

## Architecture

- `scripts/release-gate.mjs` 保持固定 argv、固定 cwd、无 shell 和 fail-fast；新增 `--report` 只写入仓库的 `.dev-agent/release-gate-report.json`，不接受任意输出路径。
- 报告使用独立 schema，只包含 schema version、生成时间、所选 gate、阶段 id/status/timing/exit code 和失败阶段；不记录命令、args、cwd、stdout、stderr、环境变量或工作区文件内容。
- audit export 仍由 agent-core 的 allowlist projection 负责；报告不复用 memory evidence，也不写入 session memory。before-image 继续由 `docs/before-image-gate-v39.md` 的 NO-GO 状态约束。

## Global Constraints

- 不持久化 before-image、patch、diff、文件字节、命令、args、cwd 或绝对 working directory；不实现跨进程 Undo。
- 报告输出仅允许 `.dev-agent/release-gate-report.json`，不得通过参数写入任意路径，不覆盖 session memory 或用户工作目录。
- 报告字段固定 allowlist；不得把子进程输出、环境变量或历史 evidence 复制进去。
- gate 仍只执行仓库内固定命令和固定工作目录，不拼接 shell，不执行模型输出。
- 新增行为遵循 TDD：先写测试并确认 RED，再写最小实现，聚焦回归通过后再跑完整门禁。

## Task 0：v39 基线和边界确认

**Produces:** v40 可执行的报告 schema 和安全边界。

- [x] **Step 1: 复核 v39。** `pnpm verify`、分阶段 gate、CI 复用和 before-image NO-GO 记录均已完成。
- [x] **Step 2: 固化报告禁止项。** 报告只反映门禁结果，不是 evidence export、session memory 或执行审计日志。
- [x] **Step 3: 写 v40 计划与进度文档。** 本计划和 `docs/day-plan-v40-progress.md` 记录实现和后续路线。

## Task 1：固定 gate report

**Produces:** `--report` 和 `GateReport` 固定 schema；未请求时不产生报告文件。

**Files:**

- Modify: `/Users/Admin/Desktop/dev-agent/scripts/release-gate.mjs`
- Test: `/Users/Admin/Desktop/dev-agent/tests/release-gate.test.mjs`
- Modify: `/Users/Admin/Desktop/dev-agent/package.json`
- Modify: `/Users/Admin/Desktop/dev-agent/.gitignore`

- [x] **Step 1: 写 RED 测试。** 覆盖 report schema 的 allowlist、默认关闭、`--report` 选择、失败阶段、耗时/退出码、`.dev-agent` 固定输出位置和禁止任意路径。
- [x] **Step 2: 运行测试确认 RED。** `node --test tests/release-gate.test.mjs` 首轮因 report API 尚不存在而按预期失败。
- [x] **Step 3: 写最小实现。** 新增固定报告路径和版本化 DTO；`runGatePlan` 收集阶段结果；请求 `--report` 时在成功或失败后写入原子 JSON，不写命令/输出/cwd。
- [x] **Step 4: 运行聚焦回归。** 契约测试 **9/9**、`--help` 和 `--typescript --report` smoke run 通过；报告检查确认固定字段、固定路径和成功阶段结果。
- [x] **Step 5: 接入文档。** README 和 `docs/README.md` 已说明报告开关、固定路径、字段 allowlist 和失败时仍可读取的结果。
- [x] **Step 6: 提交。** 报告实现和契约测试提交为 `40cc4b0`。

## Task 2：audit export 版本/大小边界设计

**Produces:** 下一阶段可实现的兼容性决策，不改变 v40 runtime。

**Files:**

- Create: `/Users/Admin/Desktop/dev-agent/docs/evidence-audit-limits-v40.md`
- Modify: `/Users/Admin/Desktop/dev-agent/docs/evidence-audit-design-v38.md`
- Modify: `/Users/Admin/Desktop/dev-agent/docs/day-plan-v40-progress.md`

- [x] **Step 1: 定义上限语义。** `docs/evidence-audit-limits-v40.md` 区分 record count、file count、serialized byte budget 和 keyset pagination；超限 fail closed，禁止静默截断导致 summary 与内容不一致。
- [x] **Step 2: 定义 schema negotiation。** 明确旧 CLI/Desktop 客户端遇到新字段、未知版本、部分导出和不支持的格式时的 fail-closed 行为。
- [x] **Step 3: 写兼容性矩阵。** 覆盖旧 memory、旧 audit client、新 projection、超限、损坏、过滤后的排序/计数和 cursor 失效关系。
- [x] **Step 4: 提交设计记录。** 限额与版本边界提交为 `b11b513`，只写安全决策，不直接扩大对外 schema。

## Task 3：全量验证、发布和下一阶段计划

**Produces:** v40 report 可交付，后续边界继续留在文档中。

- [x] **Step 1: 运行完整 `pnpm verify`，并单独复跑 TypeScript/Rust gate。** 完整门禁、`pnpm verify:typescript` 和 `pnpm verify:rust` 均通过；报告开关在成功和失败路径都有契约覆盖。
- [x] **Step 2: 检查报告文件副作用。** 默认运行未创建报告，`--report` 只写 `.dev-agent/release-gate-report.json`，未改变 workspace/session memory。
- [x] **Step 3: 更新 CHANGELOG、v40 进度和使用文档。** 已记录报告 schema 和完整验证结果。
- [x] **Step 4: Commit and push。** v40 实现和文档提交后推送到 `origin/main`。
- [ ] **Step 5: 新建 v41 计划。** 优先评估 audit export 上限/版本协商和 before-image 独立安全评审，不默认承诺跨进程 Undo。

## Acceptance Checklist

- [x] 未提供 `--report` 时 gate 行为和文件副作用与 v39 相同。
- [x] `--report` 只生成固定 `.dev-agent/release-gate-report.json`，不接受任意路径。
- [x] 报告有显式 schema version、稳定阶段顺序、状态、耗时和失败定位。
- [x] 报告不包含命令、args、cwd、stdout、stderr、环境变量、文件内容、session evidence 或 before-image。
- [x] gate 失败时报告仍写入已完成阶段和失败阶段，且进程保留失败退出码；失败结果由契约测试覆盖。
- [x] v39 audit projection、session 隔离、active guard、no-auto-rollback、MCP 和 Rust sandbox 边界继续通过。

## v40 完成后的后续路线

1. 先用报告提高 CI/本地失败诊断，再独立设计 audit export 的大小与版本协商。
2. 将报告与 release artifact 关联时只使用稳定 hash/id，不复制命令或工作区路径。
3. 只有 before-image 七项安全闸门均具备可验证证据后，才评估受用户确认的恢复能力。
