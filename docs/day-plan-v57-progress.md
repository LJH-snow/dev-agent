# v57 开发进度：验证 fresh-checkout verification artifact contract 与文档一致性

> 最后更新：2026-09-14

> v56 已由 hosted run **34808757733** 收尾；v57 的隔离 workspace inventory 已完成，
> 结果为修复测试路径可移植性、补全文档边界，并对 gate 自动预备 artifact 维持 Preserve/NO-GO。

## 最终状态

v56 的最终 CI 已证明 macOS live integration 真实执行并通过，但前三次 run 逐项暴露了
artifact 建立顺序：Rust unit/doc gate 不等于 production binary build，Rust binary build 也
不等于 `packages/executor/dist` 已存在。CI 目前已显式建立这两项 artifact，并在 prerequisites
后运行固定 integration entrypoint。

v57 的隔离 inventory 得到三项本地证据：

- clean checkout 直接运行 `pnpm verify:integration` 会因 executor `dist` 尚未生成而失败；
- clean checkout 运行完整 `pnpm verify` 在 TypeScript build 后可继续，但 macOS integration
  的 10 个 case 会因 Rust binary 未构建而显示 **10 skipped**，不能作为 live coverage；
- warmed workspace 构建好 Rust binary 后，完整 `pnpm verify` 的 integration 为 **10/10**。

这说明 artifact 前置条件应被明确记录，但不证明需要把构建步骤复制进固定 gate：macOS hosted
job 已经是 live evidence 的权威入口，Ubuntu/非 macOS gate 仍需保留 platform-specific skip
语义。v57 因此修复测试的绝对路径假设并更新文档，gate 自动预备 artifact 维持 Preserve/NO-GO。

## 已完成

- [x] 建立 `docs/day-plan-v57.md`，限定为 verification artifact contract 与文档一致性。
- [x] 在隔离 clean checkout 中验证 install、单独 integration 和完整 verify 的真实行为。
- [x] 修复 release-gate contract 对 `/dev-agent` 绝对目录后缀的假设，改为根据测试文件位置
  解析 repository root；clean checkout 的 contract suite 由 11/12 恢复为 12/12。
- [x] 更新根 README 的 CI/本地前置条件说明：macOS job 显式构建 Rust binary、executor `dist`，
  再执行 fail-closed prerequisites 与 integration。
- [x] 更新 `docs/README.md`，不再声称 `verify:rust` 单独会生成 production binary，并说明
  fresh checkout 的 artifact 顺序与非 macOS skip 语义。
- [x] 修正 `docs/architecture.md` 中 Linux bwrap 已处于 planned 状态的过时描述。
- [x] 保留 v56 的最终 hosted evidence、runner pin、独立 prerequisite steps 和固定
  `verify:integration` entrypoint。
- [x] 运行当前 warmed workspace 的 `pnpm verify`：所有 fixed stages 通过，integration 10/10。

## 最终决策

**Preserve / NO-GO for automatic artifact preparation inside the fixed gate。** 真实 evidence
证明 macOS hosted job 需要显式构建与 fail-closed checks；但 root gate 同时服务 Ubuntu/非 macOS
平台，而 platform-specific integration skip 是既有语义。把构建/preflight 复制进固定 gate 会
改变跨平台执行顺序并重复 CI authority；当前以 README、docs/README 和 CI workflow 明确记录
前置条件，等待未来有明确 consumer 或更强的 fresh-checkout contract 再重新评估。

## 发布状态

- [x] focused workflow contract **12/12**。
- [x] current warmed workspace `pnpm verify` 全部通过；macOS integration **10/10**。
- [x] clean checkout evidence、test portability fix、README/architecture/verification docs
  已记录。
- [x] 建立下一阶段入口：`docs/day-plan-v58.md`。
