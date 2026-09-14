# Day plan v48：preview contract tests 接入固定 TypeScript release gate

**建立日期：2026-09-14**

**状态：v48 完成；`preview-contract` 已进入 TypeScript fixed gate，验证与发布通过。**

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

- [x] **Step 1: inventory 当前 release gate。** 固化 TypeScript mode 的 phases、argv、cwd、
  workspace build/test 顺序、report schema 和 fail-fast 行为。
- [x] **Step 2: 选择 contract phase。** benchmark contract（5 tests）与 parity contract
  （3 tests）合并为一个固定 `preview-contract` phase；full benchmark matrix 不进入 gate。
- [x] **Step 3: 写 gate coverage matrix。** 每个 root test 到 allowlist/bytes/parity/query/
  sensitive/side-effect boundary 的映射见 `docs/preview-contract-gate-v48.md`。

## Task 1：root preview tests 接入 TypeScript gate

**Produces:** `pnpm verify:typescript` 自动执行 preview contract tests。

- [x] **Step 1: 先写 RED gate tests。** release-gate contract tests 先证明缺少
  `preview-contract` phase，随后覆盖 exact command、position、fixed cwd、fail-fast/report。
- [x] **Step 2: 最小实现固定 phase。** 复用已构建 dist，运行明确的两个 root test 文件；root
  tests 使用临时 fixture 并清理资源，不把 `.dev-agent` artifact 纳入 git。
- [x] **Step 3: report/CI parity。** report 只增加 `preview-contract` 的稳定 phase metadata；
  `pnpm verify:typescript` 已通过，preview 8/8，release-gate contract 11/11。

## Task 2：边界与性能回归

**Produces:** 不因 gate coverage 引入 flaky tests 或隐式资源预算。

- [x] **Step 1: 验证 root tests 不依赖当前日期/机器路径/外部 provider。** generatedAt 使用
  ISO shape、fixture 使用 temp dirs、UTF-8 与 workspace sentinel 有确定性检查，provider/session
  side effects 均被回归。
- [x] **Step 2: 分离轻量 contract 与重 benchmark。** gate 只跑 8 个轻量 tests；完整六 fixture、
  100,000 files 与 heap measurements 仍由显式 `pnpm benchmark:evidence` 运行。
- [x] **Step 3: 记录失败定位与计数。** package tests、preview 8/8、release-gate contract 11/11、
  Rust/integration totals 分层记录于 `docs/preview-contract-gate-v48.md`。

## Task 3：验证、发布和下一阶段

**Produces:** v48 gate coverage decision、发布提交和 v49 计划。

- [x] **Step 1: full verification。** `pnpm verify` 通过：TypeScript workspace 612/612、preview
  contract 8/8、release-gate contract 11/11、Rust unit/doc 46/46、real-Rust integration
  10/10；独立 TypeScript/Rust gate、report、structure 和 diff check 也通过。
- [x] **Step 2: 更新 README、CHANGELOG、progress 和 gate matrix。** 说明默认 gate 覆盖的轻量
  contract 与 dev-only full benchmark 的区别。
- [x] **Step 3: commit/push 并制定 v49。** v49 计划已建立；`origin/main` 保持可复现。

## Artifacts

- `tests/release-gate.test.mjs`
- `docs/preview-contract-gate-v48.md`
- `pnpm test:benchmark`
- `pnpm test:preview-parity`

## Acceptance checklist

- [x] `pnpm verify:typescript` 自动运行 8 个 preview contract tests。
- [x] `pnpm verify`、report mode、fail-fast 和 phase metadata allowlist 行为稳定。
- [x] 默认 gate 不运行 100,000-file full benchmark；开发者仍可显式运行完整 benchmark。
- [x] v1 export、preview schema、query compatibility、v41 caps、pagination/schema v2、
  before-image/cross-process Undo boundaries remain intact.


## v48 decision summary

- fixed gate coverage：**GO**；TypeScript mode 新增 `preview-contract` phase，运行 8 个轻量 root tests。
- fail-fast/report：**通过**；phase 使用固定 `node --test` argv、repository cwd、shell=false，
  report 仍是 metadata-only。
- performance boundary：full 100,000-file benchmark 仍为显式 dev command，不进入 CI。
- 详细矩阵：见 `docs/preview-contract-gate-v48.md`。
