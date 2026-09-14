# Day plan v56：验证 macOS CI runner compatibility 与 live suite skip 边界

**建立日期：2026-09-14**

**当前状态：第三个 hosted run 已确认 executor dist 构建缺口；显式 package build 修复已完成，等待下一次 run。**

> 本计划承接 `docs/day-plan-v55.md`。v55 已在本地完成 macOS integration job、fail-closed prerequisite checks 和 fixed integration
> entrypoint；首个 run（34806937694）、第二个 run（34807975071）和第三个 run（34808369664）
> 均提供了失败证据，但没有提供 live integration 成功证据。v56 继续只基于远端日志推进，
> 不把本地 contract 当作 CI 成功证明。

## Goal

确认 macOS CI job 在真实 hosted runner 上确实执行 live sandbox integration，而不是因为
runner image 缺少 `sandbox-exec`、Python fixture 或 Rust binary 而静默 skip；若失败，基于日志
选择最小 compatibility 修复或 Preserve/NO-GO。

## Global constraints

- 先读取真实 workflow run 的状态、job summary 和相关日志，再决定是否改 runner image 或测试。
- 不放宽 prerequisite、不把 skipped tests 计为 live enforcement coverage，不把失败改成允许跳过。
- 不改变 Rust/TypeScript runtime、protobuf、Evidence、session、Undo、公开 API/schema 或
  release report。
- 只在有具体远端失败证据时写 RED test 和最小修复；远端成功时不做 speculative cleanup。

## Task 0：远端运行证据

- [x] 找到 v55 push 对应的 CI workflow run 和 `macos-integration` job。
- [x] 读取首个 run：macOS Rust gate 成功，但合并 prerequisite step 失败；integration 未执行。
- [x] 读取首个 run 的 Ubuntu Rust failure：Linux-only 测试调用 `RestrictedExecutor::run`
  时缺少 `cancel` 参数。
- [x] 读取第二个 run：Ubuntu Rust/TypeScript 和 macOS Rust gate 通过；macOS binary
  prerequisite 失败，`sandbox-exec`、Python 和 integration 尚未执行。
- [x] 读取第三个 run：Rust/TypeScript、production binary 和三个 host prerequisites 均通过；
  integration 在 executor TypeScript compile 阶段失败。
- [ ] 读取下一次 run 的 Node integration summary，确认 10 个 integration tests 没有
  unexpected skip。

## Task 1：失败分支（仅在有证据时）

- [x] 用 Linux target compile 在本地复现远端 Rust error，并补齐缺失的 `None` cancel 参数。
- [x] 将 binary、`sandbox-exec`、Python fixture 检查拆成独立 steps；新增 contract 锁定失败
  可观测性与执行顺序。
- [x] 根据第二个 hosted log 确认 `cargo test` 不会保证生产 binary artifact，加入显式
  `cargo build --bin dev-agent-executor`，不改变 fail-closed 语义。
- [x] 根据第三个 hosted log 确认 integration 需要 executor `dist` artifact，加入显式
  `pnpm --filter @dev-agent/executor build`，不改变固定 integration entrypoint。
- [x] 复跑 focused workflow contract 和本地 Rust/package checks；本地 macOS integration 仍保持
  10/10。

## Task 2：成功分支

- [ ] 若下一次 live suite 10/10 且无 skip，记录 hosted-runner evidence，不再修改 runtime/CI。
- [ ] 更新 CI decision、CHANGELOG、v56 progress 和下一阶段计划。
- [ ] 将 runner compatibility 作为维护边界，而不是引入新的测试计数自动化。

## Task 3：发布与下一阶段

- [ ] 通过对应验证后提交/推送 v56 文档或最小 compatibility 修复。
- [x] 保留 macOS job 的 prerequisite fail-closed checks 和固定 `verify:integration` entrypoint。
- [ ] 没有新的问题时建立 v57 入口，并继续等待具体用户/CI feedback。

## Acceptance checklist

- [ ] 有真实远端 run 证据，明确 pass/fail/skip 状态。
- [ ] live sandbox coverage 不由 skipped tests 代替。
- [ ] 没有无证据扩展 runtime、API、schema、report 或安全 authority。
