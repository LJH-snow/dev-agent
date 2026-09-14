# v56 开发进度：验证 macOS CI runner compatibility 与 live suite skip 边界

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v56.md` 为准。首个 GitHub-hosted `macos-15` run 已完成，
> 但没有形成 live integration 证据；v56 进入“基于真实失败修复并复跑”的阶段。

## 当前状态

首个远端 run **34806937694**（commit `70081840543f86ce9612599f4093bfed556357fa`）暴露了
两个独立问题：

1. **Ubuntu Rust job** 在 Linux-only 的 `linux_bwrap_runs_echo` 测试处编译失败。远端调用
   `RestrictedExecutor::run` 少传了第三个 `cancel` 参数；这个问题在本地 macOS gate 中不可见。
2. **macOS integration job** 的 Rust gate 已通过，但原先把 binary、`sandbox-exec` 和 Python
   检查放在一个 fail-fast 多行 step 中，该 step 失败且没有标出具体缺失项，因此 integration
   没有执行，也不能据此判断 `sandbox-exec` 是否可用。

本轮已完成第一项的最小修复，并把第二项的 prerequisite 检查拆成独立、可诊断且仍然
fail-closed 的 steps。当前仍等待下一次 hosted run，不能把 v55 标记为远端通过。

## 已完成

- [x] 找到 v55 push 对应的 CI run、Ubuntu Rust job 和 `macos-integration` job。
- [x] 读取远端 job 状态：Ubuntu Rust compile failure；macOS Rust gate passed、prerequisite
  step failed、integration 未执行。
- [x] 在本地用 `cargo check --tests --target x86_64-unknown-linux-gnu` 重现 Linux-only 编译
  错误，确认根因而非猜测 runner 行为。
- [x] 给 `linux_bwrap_runs_echo` 的 `RestrictedExecutor::run` 补齐 `None` cancel 参数。
- [x] 将 macOS prerequisite 拆为 Rust binary、`sandbox-exec`、Python socket 三个独立 steps，
  让下一次失败能直接定位到具体 capability。
- [x] 更新 release-gate workflow contract；focused suite 仍为 **12/12**。
- [x] 本地 Rust gate 通过；Linux target check 与 target-specific clippy 通过。

## 待完成

- [ ] 提交并推送本轮 Rust compatibility fix 与 prerequisite diagnostics。
- [ ] 观察下一次远端 run，确认 Ubuntu Rust job 通过。
- [ ] 确认 macOS 三个 prerequisite steps 均通过，并读取 `pnpm verify:integration` 的真实
  summary。
- [ ] 只有在 hosted runner 上明确得到 live sandbox **10/10、无 unexpected skip** 后，才能
  关闭 v56 并建立 v57；若具体 prerequisite 失败，基于该 command 的日志继续做最小兼容性决策。

## 当前决策

**Preserve fail-closed / hosted evidence pending。** 不放宽 prerequisite、不把 skip 当作 live
coverage、不切换到未经证据支持的 runner image，也不修改 runtime/API/schema。当前改动只修复
已确认的跨平台 Rust 调用错误，并改善 CI 失败可观测性。

## 下一步

1. 完成本地 full gate、结构检查和 diff 检查。
2. 提交并推送，等待新的 GitHub Actions run。
3. 根据独立 prerequisite step 的真实结果，选择“远端通过并记录证据”或“针对具体缺失能力
   写下一份最小 RED contract”。
