# v56 开发进度：验证 macOS CI runner compatibility 与 live suite skip 边界

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v56.md` 为准。第二个 GitHub-hosted `macos-15` run 已完成：
> Ubuntu/TypeScript 已通过，但 macOS 在 binary prerequisite 处失败；已确认根因并准备第三次
> run 验证显式 binary build。

## 当前状态

v56 已连续从真实 hosted logs 得到两项证据：

1. 首个 run **34806937694** 暴露 Linux-only 测试缺少 `cancel` 参数，以及合并 prerequisite
   step 无法定位具体失败命令。
2. 第二个 run **34807975071** 证明上一项 Rust compile fix 已生效：Ubuntu Rust 与 TypeScript
   job 均通过，macOS Rust gate 也通过；但 binary prerequisite 失败。根因是 `cargo test` 会
   编译测试 harness，却不会保证生产 binary 出现在 `runtime/rust/target/debug/`，而
   `verify:integration` 直接依赖该路径。

本轮已在 workflow 中加入显式 `cargo build --bin dev-agent-executor`，并用 contract 锁定它位于
Rust gate 之后、binary check 之前。`sandbox-exec` 与 Python fixture 尚未在 hosted runner 上
得到判断，因为 binary check 仍先失败；integration 也尚未执行。

## 已完成

- [x] 找到 v55 push 对应的首个 CI run、Ubuntu Rust job 和 `macos-integration` job。
- [x] 读取首个 run：Ubuntu Rust compile failure；macOS Rust gate passed、合并 prerequisite
  step failed、integration 未执行。
- [x] 在本地用 `cargo check --tests --target x86_64-unknown-linux-gnu` 重现 Linux-only 编译
  错误，补齐 `None` cancel 参数。
- [x] 将 binary、`sandbox-exec`、Python socket 检查拆成独立且 fail-closed 的 steps。
- [x] 观察第二个 run：Ubuntu Rust/TypeScript 和 macOS Rust gate 通过，macOS binary check
  失败。
- [x] 根据第二个 run 确认 binary artifact 根因，先写 RED contract，再加入显式 debug binary
  build step。
- [x] 本地 `pnpm verify`、Linux target check/clippy、focused workflow contract **12/12**、
  structure/YAML/diff checks 均通过。

## 待完成

- [ ] 提交并推送显式 binary build 修复与进度文档。
- [ ] 观察下一次远端 run，确认 Ubuntu Rust、macOS binary、`sandbox-exec` 和 Python steps
  均通过。
- [ ] 确认 `pnpm verify:integration` 在 hosted runner 上真实执行并输出 **10/10、无
  unexpected skip**。
- [ ] 只有在 hosted runner 上明确得到 live sandbox 证据后，才能关闭 v56 并建立 v57；若
  后续具体 prerequisite 失败，继续基于该 command 的日志做最小兼容性决策。

## 当前决策

**Preserve fail-closed / hosted evidence pending。** 不放宽 prerequisite、不把 skip 当作 live
coverage、不切换到未经证据支持的 runner image，也不修改 runtime/API/schema。当前改动只修复
已确认的 Rust 跨 target 调用错误、补齐生产 binary 构建，并改善 CI 失败可观测性。

## 下一步

1. 在本地验证显式 `cargo build --bin dev-agent-executor` 与完整 release gate。
2. 提交并推送，等待新的 GitHub Actions run。
3. 根据独立 prerequisite steps 的真实结果，选择“远端通过并记录证据”或“针对具体缺失能力
   写下一份最小 RED contract”。
