# v53 开发进度：release summary 的 source-of-truth 评估

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v53.md` 为准。v53 已完成 inventory 和 bounded docs-only
> 修正，没有改变 release gate、公开 report 或 runtime surface。

## 当前状态

v52 的 README 修正把 543 换成了当时记录的 612，但 fresh inventory 证明当前 workspace
package tests 合计为 **614/614**。这再次证明 evergreen README 不应手工保存会随测试增删而
漂移的总数；v53 选择移除当前 README 的硬编码数字，并在带日期的 decision doc 中记录精确
证据。

## Source-of-truth inventory

- TypeScript workspace：fixed gate 的 `pnpm test`（八个 package 的 `node --test` summary）
  当前为 model 54、code-intelligence 30、MCP 49、executor 48、agent-core 118、tools 121、
  Desktop 76、CLI 118，合计 **614/614**。
- Preview contract：`tests/evidence-preview-benchmark.test.mjs` 与
  `tests/evidence-preview-parity.test.mjs`，当前 **8/8**。
- Release-gate contract：`tests/release-gate.test.mjs`，当前 **11/11**。
- Rust unit/doc：固定 `cargo test` 输出为 43 library + 3 binary + 0 doctest，合计 **46/46**。
- Real integration：`@dev-agent/executor` 的 `test:integration`，当前 **10/10**。
- Report boundary：`scripts/release-gate.mjs` 的 report 只保存 schemaVersion、generatedAt、
  modes、status、failedStepId（失败时）以及每个 step 的 id/status/timing/exitCode；没有测试
  stdout、命令、路径、环境或计数器。

## Completed tasks

- [x] 对比 gate command、package scripts、report allowlist 和当前/历史 docs 口径。
- [x] 复现漂移：543（旧 README）→612（v52 初始修正）→614（fresh workspace inventory）。
- [x] 评估 stdout parsing、静态 `test()` 扫描、report 扩展和重复 gate wrapper 的风险。
- [x] 决策为 Preserve/NO-GO；没有写 RED prototype，也没有新增依赖或公开 schema 字段。
- [x] README 改为 suite-category-only，精确 counts 只留在带日期的 release notes/decision doc。
- [x] 建立 v54 计划，等待显式 machine-readable metrics 需求或重复漂移反馈。

## Validation

- [x] 新鲜 `pnpm verify`：所有 fixed stages 通过，workspace 614/614、preview 8/8、release-gate
  11/11、Rust unit/doc 46/46、real-Rust integration 10/10。
- [x] `node scripts/check.mjs` 通过。
- [x] `git diff --check` 通过。
- [x] 没有 runtime code、dependency、API、schema、gate order 或 session/evidence boundary
  变更。

## Decision

**Preserve / NO-GO。** 不把不稳定的 test stdout、命令或环境写入 metadata-only report，也不
通过源码扫描猜测动态测试数量。未来若有 CI/仪表板消费者要求机器可读计数，转入 v54 单独定义
contract；在此之前，类别摘要比错误的精确数字更可靠。

## 发布状态

- [x] `docs/release-summary-source-of-truth-v53.md` 已建立。
- [x] `README.md`、`docs/CHANGELOG.md`、v52 handoff 和 v53 docs 已更新。
- [x] v54 入口已建立；本轮保持 docs-only 和 metadata-only boundary。
