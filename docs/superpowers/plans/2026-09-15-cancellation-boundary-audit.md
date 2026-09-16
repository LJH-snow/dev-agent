# Executor cancellation 边界审计记录

**日期：2026-09-15**

**状态：只读审计完成；跨平台进程树增强保持 Preserve。**

**关联计划：**
- [8 小时安全无人值守并行开发目标](2026-09-15-eight-hour-unattended-development-goal.md)
- [8 小时开发目标进度记录](2026-09-15-eight-hour-unattended-development-goal-progress.md)

> 本记录只检查当前本地实现和测试，不新增进程控制 API，不执行发布、联网或破坏性命令。

## 一、当前实现事实

### Rust executor

`runtime/rust/src/local_executor.rs` 当前：

- 在 Unix 上为每个子进程设置独立 process group；
- cancellation/timeout 先对进程组发送 `SIGTERM`；
- 等待固定的 2 秒 termination grace；
- 仍未退出时对直接 child 执行 kill，并等待 child 结束；
- `kill_on_drop(true)` 作为额外的生命周期保护；
- stdout/stderr 读取有上限，达到上限会触发停止路径。

因此，Rust runtime 已经具备比“只杀直接 child”更强的 Unix 进程树意图；但当前测试
主要证明取消、超时和 SIGKILL escalation，不足以证明任意孙进程在所有平台和所有 wrapper
组合下都已退出。

### Node fixed gates

`scripts/release-gate.mjs` 和 `scripts/test-with-sandbox.mjs` 当前：

- 使用固定 argv、固定 cwd 和 `shell: false`；
- 每个 step 有 bounded timeout；
- timeout 后执行 `SIGTERM → SIGKILL`；
- 退出码为 `124` 时表示 timeout；
- 没有为 Node child 建立跨平台 process group，也没有声明可以保证整个子进程树已退出。

这两条脚本的承诺应保持为“有界终止直接 child，并记录 timeout”，不能在没有额外证据
时描述为完整 process-tree cleanup。

## 二、证据与未解决问题

已存在的 Rust contract 覆盖：

- command cancellation；
- profile timeout；
- `SIGTERM` 被忽略时升级到 `SIGKILL`；
- real integration 中的取消和 timeout；
- fixed gate 中的 timeout escalation。

仍未证明的边界：

1. Unix Rust process group 中由 wrapper 创建的孙进程是否在所有退出顺序下都被回收；
2. Node fixed gate 在 macOS/Linux 上的子进程树是否会遗留；
3. Windows 等不支持 restricted backend 的平台如何提供等价的终止语义；
4. 当 child 已退出但 timeout/cancel callback 竞态发生时，报告和清理是否始终一致；
5. 全局 gate deadline 与每 step deadline 的交互语义。

这些问题需要真实跨平台 runner、受控 child-tree fixture 和明确的进程组/Job Object 设计，
不能通过增加一个表面测试或更短 timeout 解决。

## 三、本轮决定

| 边界 | 决定 | 理由 |
| --- | --- | --- |
| Rust Unix process-group 行为 | 保留现状，补充证据再评估 | 已有实现意图，但完整 tree proof 尚不充分 |
| Node release gate process tree | Preserve | 跨平台语义和 runner 设计尚未确定 |
| Windows backend | NO-GO | 当前 roadmap 没有稳定 runner 和隔离原语承诺 |
| 全局 deadline | 不新增 | 会改变 fixed gate 语义，需独立设计 |
| 公开 API/protobuf/session schema | 不修改 | 本轮目标不是协议变更 |

## 四、推荐的后续实现条件

只有同时满足以下条件，才重新打开实现任务：

- 有 macOS/Linux 真实 runner，且测试不把 capability 缺失静默当成通过；
- fixture 能生成可识别的 child/grandchild，并记录各自 pid 和退出时间；
- 明确 Unix process group、Linux subreaper 或平台等价机制的责任边界；
- 明确 Node、Rust 和 Windows/unsupported 的差异化契约；
- 增加失败注入、timeout、cancel、wrapper 和 race 的真实 integration tests；
- 先写 RED contract，再以最小 patch 实现，不改动无关 release 或执行权限逻辑。

在这些条件满足前，当前 **SIGTERM → grace → SIGKILL** 的 bounded direct-child 逻辑继续作为
可审计的保守实现；文档不声称它提供未经证明的全平台进程树保证。

## 五、可复现验证

本次审计依赖以下本地检查：

```bash
rg -n "process_group|killpg|SIGTERM|SIGKILL|timeout|cancel" \
  runtime/rust/src scripts/release-gate.mjs scripts/test-with-sandbox.mjs
node --test tests/release-gate.test.mjs
pnpm verify:rust
pnpm verify:integration
```

没有执行 tag、push、GitHub Release、部署、联网或删除操作。
