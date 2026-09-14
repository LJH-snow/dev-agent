# Day plan v56：验证 macOS CI runner compatibility 与 live suite skip 边界

**建立日期：2026-09-14**

> 本计划承接 `docs/day-plan-v55.md`。v55 已在本地完成 macOS integration job、fail-closed
> prerequisite checks 和 fixed integration entrypoint；v56 的唯一关键证据是 push 后的真实
> GitHub-hosted `macos-15` workflow run。没有远端日志前，不把本地 contract 当作 CI 成功证明。

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

- [ ] 找到 v55 push 对应的 CI workflow run 和 `macos-integration` job。
- [ ] 确认 runner image、Rust gate、prerequisite step 与 integration step 均执行成功。
- [ ] 读取 Node test summary，确认 10 个 integration tests 没有 unexpected skip。

## Task 1：失败分支（仅在有证据时）

- [ ] 若 runner 缺少 `sandbox-exec`/Python/binary，先写针对日志的 RED compatibility contract。
- [ ] 选择固定 runner、环境安装或 test harness 的最小修复，不改变 fail-closed 语义。
- [ ] 复跑 focused workflow contract 和本地 macOS integration；记录不能在本地证明的部分。

## Task 2：成功分支

- [ ] 若 live suite 10/10 且无 skip，记录 hosted-runner evidence，不再修改 runtime/CI。
- [ ] 更新 CI decision、CHANGELOG、v56 progress 和下一阶段计划。
- [ ] 将 runner compatibility 作为维护边界，而不是引入新的测试计数自动化。

## Task 3：发布与下一阶段

- [ ] 通过对应验证后提交/推送 v56 文档或最小 compatibility 修复。
- [ ] 保留 macOS job 的 prerequisite fail-closed checks 和固定 `verify:integration` entrypoint。
- [ ] 没有新的问题时建立 v57 入口，并继续等待具体用户/CI feedback。

## Acceptance checklist

- [ ] 有真实远端 run 证据，明确 pass/fail/skip 状态。
- [ ] live sandbox coverage 不由 skipped tests 代替。
- [ ] 没有无证据扩展 runtime、API、schema、report 或安全 authority。
