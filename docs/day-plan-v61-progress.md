# v61 开发进度：Windows restricted execution feasibility 与 fail-closed 平台边界

> 最后更新：2026-09-14

> v61 已完成。v60 已通过 hosted CI；v61 完成平台 inventory、初步 threat model 和 feasibility
> decision，未修改 runtime、公开 schema、CI 或 release workflow，最终保留 macOS/Linux 支持
> 和其他平台的 Unsupported fail-closed 行为。

## 当前状态

**Completed / Preserve current implementation / NO-GO for Windows backend.** 当前代码已经把 macOS `sandbox-exec`、Linux `bwrap`
和其他平台 `Unsupported` 分开；release matrix 只覆盖 macOS/Linux。Windows backend 需要
先证明安全原语、runner、负向测试和发布边界，不能由“本地命令能运行”推导出 restricted
execution 已成立。

## Task 0 inventory 结果

- `runtime/rust/src/restricted_executor.rs` 的 `RestrictedExecutor::run` 只在 macOS/Linux
  编译出真实 backend；其他平台分支直接返回 `RestrictedError::Unsupported`，不会调用内部
  `LocalExecutor` 执行命令。
- `runtime/rust/src/sandbox_executor.rs` 保留 Unsupported error mapping，
  `runtime/rust/src/bin/dev-agent-executor.rs` 将它编码为 `SANDBOX_UNSUPPORTED`。
- `packages/executor/src/index.ts` 在没有 Rust binary 配置时显式创建普通 `LocalExecutor`；
  `apps/cli/src/doctor.ts` 将该模式报告为 “without the sandbox”。这与 restricted path
  的 unsupported 返回是两条不同的配置路径，不应在 Windows 方案中混为 fallback。
- `.github/workflows/ci.yml` 的 live integration 是 Linux/macOS 分工，
  `.github/workflows/release.yml` 只有两个 macOS target 和两个 Linux target；README、
  `docs/architecture.md`、`runtime/rust/README.md` 的 active 声明与这些 evidence 一致。
- 当前 proof gap：没有 Windows runner、Windows security primitive 选择、target-specific
  negative tests 或 Windows artifact/release 方案。因此本轮只记录边界，不添加兼容 shim。

## Task 1 初步 threat model

- [x] 在 `docs/windows-sandbox-feasibility-v61.md` 固化资产、攻击者能力、信任边界和安全
  目标。
- [x] 对 AppContainer、Job Objects、restricted token 和 Windows Sandbox 做候选能力/限制
  记录；没有把任何单一原语解释为完整 sandbox proof。
- [x] 列出 filesystem、network、process、resource、timeout/cancel、stdio、Starlark 和
  Unsupported 的 proof-gap matrix。
- [x] 暂定 Preserve current macOS/Linux implementation / NO-GO for Windows backend，直到
  runner、negative tests、端到端 evidence 和 release boundary 齐备。

## 已完成

- [x] v60 roadmap/documentation slice 完成，作为 v61 的 source-of-truth 前置记录。
- [x] 建立 v61 bounded scope：平台 inventory、threat model、feasibility gate，默认不写
  Windows backend。
- [x] 明确 fail-closed 约束：不把 `LocalExecutor` 作为 restricted fallback，不新增
  Windows release target，不把模拟环境当作 live evidence。
- [x] 没有发现 fail-open 或明确用户需求；因此不写 Windows RED implementation contract，
  维持 Preserve/NO-GO。
- [x] focused documentation contract **2/2**；commit `17bfa7a` 的普通 CI run
  [34815029965](https://github.com/LJH-snow/dev-agent/actions/runs/34815029965) 的 Rust、
  TypeScript 和 macOS integration jobs 全部成功。

## 待完成

- [x] 盘点 Rust platform branches、错误映射、CI/release matrix 和用户可见支持声明。
- [x] 证明 unsupported restricted path 不会静默调用 `LocalExecutor`；区分显式 LocalExecutor
  模式与 restricted execution 失败。
- [x] 建立 Windows 资产/边界 threat model，列出 filesystem、network、cwd、resource、
  timeout/cancel 和可观测性 proof gaps。
- [x] 根据证据选择 Preserve/NO-GO：当前没有 Windows runner、primitive、negative tests、
  端到端 evidence 或 release 需求，因此保留 Unsupported，不扩大 runtime、依赖、schema
  或 release authority。

## 最终决策

**Preserve current macOS/Linux implementation / NO-GO for Windows backend.** v61 的目标是
判断是否具备实现条件，而不是承诺 Windows 支持。若未来出现稳定 runner、可审计 primitive、
完整 negative tests 和明确发布需求，再另建 code plan；在此之前 `Unsupported` 是正确的
安全结果。

## 下一阶段触发条件

1. 出现真实 Windows 用户需求或可维护者明确的 target commitment。
2. 能获得稳定 Windows runner、可审计安全 primitive、negative-test fixture 和完整 release
   boundary evidence。
3. 满足前两项后，另建独立 code plan；否则不写 Windows compatibility shim。

下一阶段的候选方向已集中记录在
`docs/next-roadmap-plans-v62-plus.md`，当前推荐先执行 Linux `bwrap` hosted live integration。
