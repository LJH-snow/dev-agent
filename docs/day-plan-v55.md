# Day plan v55：把 real Rust integration 接入 macOS CI

**建立日期：2026-09-14**

**状态：v55 本地实现完成；等待首个 GitHub-hosted macOS workflow run 作为外部验证。**

> 本计划承接 `docs/day-plan-v54.md`。v54 评估了 release summary 的测试计数，选择
> Preserve/NO-GO；本轮 inventory 发现一个不同且可验证的质量缺口：`.github/workflows/ci.yml`
> 只运行 TypeScript 和 Rust unit/doc gate，没有在能执行 macOS sandbox 的 runner 上运行
> `real Rust integration`。v55 只补 CI coverage，不改变 runtime/API/schema。

## Trigger

固定本地 `pnpm verify` 包含 `rust-integration`，但当前 GitHub CI 只有
`pnpm verify:typescript` 和 `pnpm verify:rust` 两个 job。现有
`packages/executor/tests/real-rust-integration.integration.ts` 的 sandbox cases 要求
macOS 与 `/usr/bin/sandbox-exec`；在 Ubuntu job 中这些 cases 会被 skip，不能替代 live
macOS enforcement evidence。

## Goal

在 CI 中增加一个明确、可观察、可失败的 macOS integration job：先用固定 Rust gate 构建并
验证 debug runtime，再执行固定 `integration` gate，并在测试前确认 sandbox、Rust binary 和
Python network fixture 的前置条件存在。

## Global constraints

- 不改变 Rust/TypeScript runtime、protobuf、Evidence、session、Undo、API 或公开 schema。
- 复用 `scripts/release-gate.mjs` 的固定命令、固定 cwd、`shell=false` 和 fail-fast 语义；
  不在 workflow 中拼接模型输出或任意命令。
- 不把 Ubuntu 上的 skipped tests 当作 live sandbox coverage；macOS job 的 prerequisite
  check 失败时必须让 CI 失败，而不是静默降级。
- 不增加第三方运行时依赖；只使用已有的 pnpm/Rust/protoc/Python/runner tooling。
- `macos-15` 先作为稳定、明确的 CI image；若后续 runner image 迁移影响
  `/usr/bin/sandbox-exec`，必须重新验证后再调整。

## Task 0：确认 CI coverage gap

- [x] **Step 1: inventory。** 对照固定 gate plan、CI workflow 和 integration test skip 条件，
  确认 CI 当前没有 live macOS integration。
- [x] **Step 2: bound。** 只增加 macOS integration job、固定 integration script 和最小 workflow
  contract test；不把 Linux skip 重新标成通过覆盖。
- [x] **Step 3: acceptance。** job 必须先通过 Rust gate，确认 binary/sandbox/python，再运行
  `pnpm verify:integration`；顺序和失败语义可由测试验证。

## Task 1：RED contract

- [x] **Step 1: 写 RED test。** 在现有 release-gate contract 中断言 root script 和 macOS job
  的固定结构；实现前 focused suite 为 **11/12**，按预期因 entrypoint 缺失失败。
- [x] **Step 2: 记录 failure。** 失败只涉及新增 script/job 不存在；没有修改 runtime 代码。

## Task 2：最小 CI 实现

- [x] **Step 1: root entrypoint。** 增加 `pnpm verify:integration`，映射到固定 gate 的
  `--integration` mode。
- [x] **Step 2: macOS job。** 在 `.github/workflows/ci.yml` 增加 `macos-15` job，安装
  protobuf 和 workspace dependencies，运行 `verify:rust`，检查 live prerequisites，再运行
  `verify:integration`。
- [x] **Step 3: contract GREEN。** 断言 job 不会只跑 raw test command、不会缺少 Rust build
  顺序，也不会允许 prerequisite 缺失时静默 skip。

## Task 3：验证、文档和发布

- [x] **Step 1: focused verification。** release-gate contract **12/12**、integration gate
  **10/10**、structure、diff、YAML/text contract 均通过；本地 macOS prerequisites 已满足。
- [x] **Step 2: full verification。** 完整 `pnpm verify` 通过，TypeScript workspace **614/614**、
  preview **8/8**、release-gate contract **12/12**、Rust unit/doc **46/46**、real Rust
  integration **10/10**。
- [x] **Step 3: docs/release。** 已更新 README、docs/README、CHANGELOG、v54/v55 progress 和
  decision doc；已建立 v56 入口，记录远端 workflow run 仍待观察。

## Decision

**GO：补充 macOS live integration CI coverage。** 本地实现已完成；首个 GitHub-hosted
`macos-15` workflow run 是剩余外部证据。若 runner 缺失 `sandbox-exec`，必须保留 fail-closed
行为并新建 compatibility decision，不得改成静默 skip。

## Acceptance checklist

- [x] CI workflow 有明确的 macOS live integration job。
- [x] integration job 的 prerequisite 缺失会 fail，不会把 sandbox tests 静默当作覆盖。
- [x] fixed gate 的 integration command 有稳定 root entrypoint，且 Rust gate 先于 integration。
- [x] 没有 runtime/API/schema/dependency/Evidence/Undo boundary 回归。
