# Day plan v48：preview contract tests 接入固定 TypeScript release gate

**建立日期：2026-09-14**

> 本计划承接 `docs/day-plan-v47.md`。v47 证明当前没有真实 digest consumer，因此不扩展
> preview/export schema。v48 选择一个已有的工程质量缺口：v45/v46 新增的 root benchmark
> 与跨宿主 parity tests 目前需要手工运行，没有进入 `pnpm verify:typescript` 的固定门禁。
> 本轮只补 gate coverage，不改变 preview runtime 或 benchmark full-matrix 的 dev-only 性质。

## Goal

让 preview contract regressions 成为固定 TypeScript release gate 的一部分，确保每次
CI/pre-push 都验证 benchmark artifact allowlist、canonical bytes、core/CLI/Desktop parity、
query compatibility 和 sensitive-field/read-only boundaries，同时保持 gate 的固定命令、
固定 cwd、无 shell、metadata-only report 和 fail-fast 设计。

## Questions

- root `.mjs` contract tests 应作为一个固定 gate step 运行，还是并入已有 release-gate
  contract test，哪种方式最能保持清晰的失败定位与稳定计数？
- parity tests 依赖 agent-core/CLI/Desktop build；如何复用 TypeScript gate 已生成的 dist，
  又不在 CI 中运行 100,000-file benchmark full matrix？
- release report 是否只增加稳定 phase id/status/timing/exit code，不暴露命令、args、cwd、
  fixture evidence 或 provider/workspace details？
- root test failure 是否在 TypeScript mode、default full mode 和 report mode 中一致 fail-fast，
  且 Rust/integration phase 不被错误吞掉？

## Global constraints

- 不改变 `EvidenceAuditPreview` v1、v1 export、v41 caps、CLI/Desktop query semantics 或
  operation isolation；不新增 digest、pagination、cursor、partial、schema v2、before-image
  或 Undo authority。
- release gate 仍只执行 repository-defined fixed command arrays/fixed working directories，
  不启用 shell，不使用 model output、persisted evidence 或任意用户命令作为执行输入。
- CI 运行 contract tests 时只使用临时 synthetic FileMemory/workspace fixture；不启动 provider、
  不进入 chat queue。100,000-file benchmark 仍由 `pnpm benchmark:evidence` 显式触发，不塞入
  默认 release gate。
- 新增 gate behavior 先写 RED test；报告保持 metadata-only allowlist，禁止子进程输出、环境
  值、路径、fixture content 或 error detail 进入 report。

## Task 0：冻结现有 gate 与 root test baseline

**Produces:** 固定 phase 设计、基线计数和不运行 full benchmark 的边界。

- [ ] **Step 1: inventory 当前 release gate。** 记录 TypeScript mode 的固定 phases、argv、cwd、
  workspace build/test 顺序、report schema 和 fail-fast 行为。
- [ ] **Step 2: 选择 contract phase。** 决定 benchmark contract（5 tests）与 parity contract
  （3 tests）作为一个固定 root phase，或有明确理由拆成两个 phase；full benchmark matrix
  不进入 gate。
- [ ] **Step 3: 写 gate coverage matrix。** 映射每个 root test 到 allowlist/bytes/parity/query/
  sensitive/side-effect boundary，定义失败时的稳定 phase id。

## Task 1：root preview tests 接入 TypeScript gate

**Produces:** `pnpm verify:typescript` 自动执行 preview contract tests。

- [ ] **Step 1: 先写 RED gate tests。** 让 release-gate contract test 证明 selected TypeScript
  run 包含 root preview phase、固定 argv/cwd、失败会被报告且不继续后续阶段。
- [ ] **Step 2: 最小实现固定 phase。** 复用已构建 dist，运行 `node --test` 的明确文件列表；不
  让 root tests 改写 session/workspace，清理临时资源，不把 `.dev-agent` artifact 纳入 git。
- [ ] **Step 3: report/CI parity。** report 只增加稳定 phase metadata；default run、TypeScript
  run、report run 的 phase 选择和退出码保持可预测。

## Task 2：边界与性能回归

**Produces:** 不因 gate coverage 引入 flaky tests 或隐式资源预算。

- [ ] **Step 1: 验证 root tests 不依赖当前日期/机器路径/外部 provider。** 对 generatedAt、
  temp dirs、UTF-8、workspace sentinel 和 process env 做确定性 review。
- [ ] **Step 2: 分离轻量 contract 与重 benchmark。** gate 只跑 8 个轻量 tests；完整六 fixture、
  100,000 files 与 heap measurements 仍由显式 benchmark 命令运行。
- [ ] **Step 3: 记录失败定位与计数。** package tests、root preview phase、release-gate contract、
  Rust/integration 的 totals 不互相覆盖，docs 记录 exact counts。

## Task 3：验证、发布和下一阶段

**Produces:** v48 gate coverage decision、发布提交和 v49 计划。

- [ ] **Step 1: full verification。** focused root tests、TypeScript、Rust、integration、report、
  structure 和 diff check 全部通过。
- [ ] **Step 2: 更新 README、CHANGELOG、progress 和 gate matrix。** 说明默认 gate 覆盖的轻量
  contract 与 dev-only full benchmark 的区别。
- [ ] **Step 3: commit/push 并制定 v49。** 如果 phase 增加造成明显 gate latency 或 flake，
  优先修复测试隔离，不放宽 contract 或跳过安全边界。

## Acceptance checklist

- [ ] `pnpm verify:typescript` 自动运行 8 个 preview contract tests。
- [ ] `pnpm verify`、report mode、fail-fast 和 phase metadata allowlist 行为稳定。
- [ ] 默认 gate 不运行 100,000-file full benchmark；开发者仍可显式运行完整 benchmark。
- [ ] v1 export、preview schema、query compatibility、v41 caps、pagination/schema v2、
  before-image/cross-process Undo boundaries remain intact.
