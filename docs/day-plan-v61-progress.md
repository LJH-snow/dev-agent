# v61 开发进度：Windows restricted execution feasibility 与 fail-closed 平台边界

> 最后更新：2026-09-14

> v60 已完成并通过 hosted CI。v61 已完成 Task 0 的平台路径 inventory，尚未修改 runtime、
> 公开 schema、CI 或 release workflow；默认保留 macOS/Linux 支持和其他平台的 Unsupported
> fail-closed 行为。

## 当前状态

**Task 0 complete / threat model next.** 当前代码已经把 macOS `sandbox-exec`、Linux `bwrap`
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

## 已完成

- [x] v60 roadmap/documentation slice 完成，作为 v61 的 source-of-truth 前置记录。
- [x] 建立 v61 bounded scope：平台 inventory、threat model、feasibility gate，默认不写
  Windows backend。
- [x] 明确 fail-closed 约束：不把 `LocalExecutor` 作为 restricted fallback，不新增
  Windows release target，不把模拟环境当作 live evidence。

## 待完成

- [x] 盘点 Rust platform branches、错误映射、CI/release matrix 和用户可见支持声明。
- [x] 证明 unsupported restricted path 不会静默调用 `LocalExecutor`；区分显式 LocalExecutor
  模式与 restricted execution 失败。
- [ ] 建立 Windows 资产/边界 threat model，列出 filesystem、network、cwd、resource、
  timeout/cancel 和可观测性 proof gaps。
- [ ] 根据证据选择 Preserve/NO-GO，或建立独立的 Windows 实现计划；没有 trigger 时不扩大
  runtime、依赖、schema 或 release authority。

## 下一步

1. 先完成 Task 0 inventory，不写 Windows compatibility shim。
2. 只有发现具体 fail-open 或真实用户需求，才进入 RED contract；否则记录 Preserve/NO-GO。
3. 保持 v60 的 roadmap/documentation contract 与普通 CI 证据不变。
