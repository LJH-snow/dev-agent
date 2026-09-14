# v56 开发进度：验证 macOS CI runner compatibility 与 live suite skip 边界

> 最后更新：2026-09-14

> v56 已完成。第三个失败 run 后加入 executor package build，第四个 GitHub-hosted
> `macos-15` run 已证明完整 macOS live integration 真正执行并通过。

## 最终状态

最终 run [34808757733](https://github.com/LJH-snow/dev-agent/actions/runs/34808757733)，对应
commit `6be9778a8a55ae1c344b39f2bb8deffc88b9a205`，三个 job 全部成功：

- Ubuntu `Rust`：Rust release gate 通过。
- `TypeScript`：TypeScript release gate 通过。
- macOS `integration`：Rust gate、debug binary build、executor package build、binary/
  `sandbox-exec`/Python prerequisites 和 real integration 全部通过。
- hosted integration 日志明确为 **10 tests、0 failures、0 skipped**。

这关闭了 v55/v56 的核心外部证据边界：macOS hosted runner 确实提供了本次 live sandbox
测试所需的 capability，integration 没有通过 skip 伪装成 coverage。

## 期间发现并修复的问题

1. 首个 run **34806937694** 暴露 Linux-only 测试缺少 `cancel` 参数，以及合并 prerequisite
   step 无法定位具体失败命令。
2. 第二个 run **34807975071** 证明上一项 Rust compile fix 已生效，但 `cargo test` 不会保证
   production binary 出现在 `runtime/rust/target/debug/`；加入显式
   `cargo build --bin dev-agent-executor`。
3. 第三个 run **34808369664** 证明 host prerequisites 已通过，但 integration 的 TypeScript
   compile 缺少 `packages/executor/dist/`；加入显式
   `pnpm --filter @dev-agent/executor build`。

每项修复都先用失败的 workflow contract 或本地 target reproduction 锁定，再做最小改动；
没有放宽 fail-closed checks，也没有修改 runtime/API/schema。

## 已完成

- [x] 找到并读取首个、第二个、第三个和最终 hosted CI run 的 job/log 状态。
- [x] 用 `cargo check --tests --target x86_64-unknown-linux-gnu` 重现并修复 Linux-only 编译
  错误。
- [x] 将 binary、`sandbox-exec`、Python socket 检查拆成独立且 fail-closed 的 steps。
- [x] 在 Rust gate 后显式构建 production debug binary。
- [x] 在 host prerequisites 后显式构建 executor package `dist`。
- [x] 用 release-gate contract 锁定 Rust gate → binary build → prerequisites → package build
  → integration 顺序；focused suite **12/12**。
- [x] 本地 `pnpm verify`、executor package build、Linux target check/clippy、structure/YAML/
  diff checks 均通过。
- [x] hosted macOS live integration **10/10、0 skipped**。

## 最终决策

**GO / Preserve fail-closed。** 保留固定 `macos-15` job、显式 production binary/package builds、
独立 host prerequisites 和 `pnpm verify:integration` entrypoint。没有证据支持切换 runner image、
放宽 capability 检查或修改 runtime/API/schema，因此不做这些变更。

## 下一阶段

v56 的工作已收尾；下一阶段计划见 `docs/day-plan-v57.md`，重点只处理已观察到的文档/门禁
契约一致性，不重新打开已经通过 hosted evidence 证明的 sandbox runtime 行为。
