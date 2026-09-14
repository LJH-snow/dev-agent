# v61 开发进度：Windows restricted execution feasibility 与 fail-closed 平台边界

> 最后更新：2026-09-14

> v60 已完成并通过 hosted CI。v61 只建立了 evidence-first 的平台评估入口，尚未修改
> runtime、公开 schema、CI 或 release workflow；默认保留 macOS/Linux 支持和其他平台的
> Unsupported fail-closed 行为。

## 当前状态

**Proposed / inventory not started.** 当前代码已经把 macOS `sandbox-exec`、Linux `bwrap`
和其他平台 `Unsupported` 分开；release matrix 只覆盖 macOS/Linux。Windows backend 需要
先证明安全原语、runner、负向测试和发布边界，不能由“本地命令能运行”推导出 restricted
execution 已成立。

## 已完成

- [x] v60 roadmap/documentation slice 完成，作为 v61 的 source-of-truth 前置记录。
- [x] 建立 v61 bounded scope：平台 inventory、threat model、feasibility gate，默认不写
  Windows backend。
- [x] 明确 fail-closed 约束：不把 `LocalExecutor` 作为 restricted fallback，不新增
  Windows release target，不把模拟环境当作 live evidence。

## 待完成

- [ ] 盘点 Rust platform branches、错误映射、CI/release matrix 和用户可见支持声明。
- [ ] 建立 Windows 资产/边界 threat model，列出 filesystem、network、cwd、resource、
  timeout/cancel 和可观测性 proof gaps。
- [ ] 根据证据选择 Preserve/NO-GO，或建立独立的 Windows 实现计划；没有 trigger 时不扩大
  runtime、依赖、schema 或 release authority。

## 下一步

1. 先完成 Task 0 inventory，不写 Windows compatibility shim。
2. 只有发现具体 fail-open 或真实用户需求，才进入 RED contract；否则记录 Preserve/NO-GO。
3. 保持 v60 的 roadmap/documentation contract 与普通 CI 证据不变。
