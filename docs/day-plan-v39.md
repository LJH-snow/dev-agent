# Day plan v39：evidence 发布门禁自动化与 before-image 可行性闸门

**建立日期：2026-09-14**

> 本计划承接 `docs/day-plan-v38.md`。v38 已交付 metadata-only audit projection、CLI/Desktop 只读导出和长期 evidence 生命周期矩阵；v39 把这些不变量接入可重复的发布门禁，并继续把跨进程 Undo 保持在独立安全评审之后。

## Goal

将 v38 的 evidence 安全边界和全量验证流程收敛为一个可本地、可 CI 复用的固定门禁，减少不同运行入口之间的检查漂移；同时补齐 before-image 能力的 go/no-go 闸门记录，不在闸门通过前持久化文件内容或实现跨进程 Undo。

## Architecture

- 新增 `scripts/release-gate.mjs`，只执行仓库内固定的结构检查、TypeScript 构建/类型检查/测试、Rust fmt/clippy/unit-doc 和 real-Rust integration 阶段；命令由代码固定，不接受用户输入拼接为 shell 命令。
- 根 `package.json` 暴露完整门禁和按 CI job 拆分的 TypeScript/Rust 入口；CI 复用同一脚本，保持本地与远程检查顺序一致。
- before-image 继续采用文档化安全闸门：完整性绑定、容量、敏感数据、确认、失败恢复、生命周期/并发和兼容性任一项未通过，都不得进入实现。

## Global Constraints

- 不持久化 before-image、patch、diff、文件字节、命令、args、cwd 或绝对 working directory；不实现跨进程 Undo。
- audit export 仍是固定字段 allowlist；新增字段必须先经过逐字段设计评审和兼容性测试。
- 发布门禁只使用仓库内固定命令和固定工作目录，不把 CLI 参数、环境变量或模型输出拼接进 shell。
- TypeScript、Rust、real-Rust integration 三类门禁必须可单独执行，也必须有固定的完整顺序。
- 新增行为遵循 TDD：先写测试并确认 RED，再写最小实现，聚焦回归通过后再运行完整门禁。
- 运行门禁允许产生现有 `dist/`、`tests-dist/` 和 `runtime/rust/target/` 构建产物；不得修改用户工作目录或提交运行时产物。

## Task 0：v38 基线和 before-image 闸门确认

**Produces:** v39 可执行的安全边界和发布门禁契约。

- [x] **Step 1: 复核 v38 交付。** `docs/day-plan-v38-progress.md` 已记录 TypeScript **600/600**、Executor integration **10/10**、Rust unit/doc **46/46** 和 `origin/main` 发布状态。
- [x] **Step 2: 固化禁止项。** `docs/evidence-audit-design-v38.md` 明确 before-image 不进入 v38/v39 实现，audit projection 不得扩散内部字段。
- [x] **Step 3: 写 v39 计划与进度文档。** 本计划和 `docs/day-plan-v39-progress.md` 记录门禁自动化、CI 接入和后续安全评审路线。

## Task 1：固定 release gate runner

**Produces:** `pnpm verify`、`pnpm verify:typescript`、`pnpm verify:rust` 和可测试的固定阶段计划。

**Files:**

- Create: `/Users/Admin/Desktop/dev-agent/scripts/release-gate.mjs`
- Test: `/Users/Admin/Desktop/dev-agent/tests/release-gate.test.mjs`
- Modify: `/Users/Admin/Desktop/dev-agent/package.json`

- [x] **Step 1: 写 RED 测试。** 测试 `parseGateArgs()` 和 `createGatePlan()`：默认顺序必须是 TypeScript → Rust → real-Rust integration；`--typescript`、`--rust`、`--integration` 只能选择对应阶段；未知参数必须拒绝；命令和工作目录必须来自固定计划。
- [x] **Step 2: 运行测试确认 RED。** `node --test tests/release-gate.test.mjs` 首轮因 `scripts/release-gate.mjs` 不存在而按预期失败。
- [x] **Step 3: 写最小实现。** 导出纯函数供测试使用；运行器使用 `spawn` 和固定 argv，阶段失败立即停止并保留失败退出码；默认完整门禁按固定顺序执行。
- [x] **Step 4: 运行聚焦回归。** `node --test tests/release-gate.test.mjs` **5/5** 和 `node scripts/release-gate.mjs --help` 通过；未知参数返回退出码 2。
- [x] **Step 5: 接入根脚本。** 添加 `verify`、`verify:typescript`、`verify:rust`，未改变现有 `build`、`typecheck`、`test` 入口。
- [ ] **Step 6: 提交。** 提交固定 release gate runner 和契约测试。

## Task 2：CI 复用固定门禁

**Produces:** CI 的 TypeScript/Rust job 与本地同源，避免检查顺序和命令漂移。

**Files:**

- Modify: `/Users/Admin/Desktop/dev-agent/.github/workflows/ci.yml`
- Modify: `/Users/Admin/Desktop/dev-agent/README.md`
- Modify: `/Users/Admin/Desktop/dev-agent/docs/README.md`

- [ ] **Step 1: 更新 CI。** TypeScript job 使用 `pnpm verify:typescript`；Rust job 使用 `pnpm verify:rust`，并保留各自运行所需的依赖安装、工作目录和工具链配置。
- [ ] **Step 2: 更新使用文档。** 说明完整门禁、按 job 门禁、失败阶段和不触碰用户工作目录的边界。
- [ ] **Step 3: 运行 workflow 文本检查。** 确认 CI 不再重复维护相同的结构/build/typecheck/test/fmt/clippy/cargo test 命令。
- [ ] **Step 4: 提交。** 提交 CI 与文档同步。

## Task 3：before-image 可行性闸门记录

**Produces:** 下一阶段能否研究受确认的恢复能力的明确决策输入，不实现恢复。

**Files:**

- Modify: `/Users/Admin/Desktop/dev-agent/docs/evidence-audit-design-v38.md`
- Create: `/Users/Admin/Desktop/dev-agent/docs/before-image-gate-v39.md`
- Modify: `/Users/Admin/Desktop/dev-agent/docs/day-plan-v39-progress.md`

- [ ] **Step 1: 写 gate 表。** 为完整性绑定、容量上限、敏感信息、用户确认、原子/可恢复失败、生命周期/并发、版本兼容定义输入、必须证明的断言和否决条件。
- [ ] **Step 2: 写 go/no-go 规则。** 任一 gate 未完成时，只允许 postimage-only validation 和 metadata-only audit；禁止保存或消费 before-image。
- [ ] **Step 3: 写未来实验边界。** 未来若研究 before-image，只能使用隔离、显式确认和可删除的测试夹具，不得接入 production memory schema 或 Undo 路径。
- [ ] **Step 4: 提交设计记录。** 设计文档本身不改变运行时行为。

## Task 4：全量验证、发布和下一阶段计划

**Produces:** v39 门禁自动化可交付，下一阶段路线留在文档中。

- [ ] **Step 1: 运行完整 `pnpm verify`，并单独复跑 TypeScript/Rust 门禁。** 记录每个阶段的通过计数和退出结果。
- [ ] **Step 2: 运行结构检查、diff check 和人工 review。** 确认固定 argv、固定 cwd、fail-fast、无 shell 拼接和 before-image 禁止项。
- [ ] **Step 3: 更新 `docs/CHANGELOG.md`、v39 进度和 README。** 记录门禁命令及完整验证结果。
- [ ] **Step 4: Commit and push。** 发布文档和实现一起推送到 `origin/main`。
- [ ] **Step 5: 新建 v40 计划。** 只在 v39 完成后写入下一阶段；优先评估 audit schema 版本协商、导出大小边界和 before-image 独立评审，不默认承诺跨进程 Undo。

## Acceptance Checklist

- [ ] `pnpm verify` 以固定顺序运行完整门禁，并在首个失败阶段停止。
- [ ] `pnpm verify:typescript` 和 `pnpm verify:rust` 可供 CI job 独立复用。
- [ ] 门禁不接受任意命令字符串，不执行模型输出或历史 evidence 输入。
- [ ] v38 audit projection、session 隔离、active guard、no-auto-rollback、MCP 和 Rust sandbox 边界继续通过。
- [ ] before-image 仍未进入 memory schema、audit export、CLI/Desktop API 或 Undo 路径。
- [ ] 文档记录 before-image 的 go/no-go 闸门和未来实验隔离边界。

## v39 完成后的后续路线

1. 将 evidence matrix 和 release gate 接入每次发布前检查，并保留阶段化失败诊断。
2. 为 audit schema 版本协商、导出大小上限和长时间运行的 operator feedback 做独立设计，不直接暴露内部 DTO。
3. 只有 before-image 七项安全闸门都具备可验证证据后，才评估受用户确认的跨进程恢复能力。
