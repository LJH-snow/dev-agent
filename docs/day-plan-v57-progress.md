# v57 开发进度：验证 fresh-checkout verification artifact contract 与文档一致性

> 最后更新：2026-09-14

> v56 已由 hosted run **34808757733** 收尾；v57 先做隔离 workspace inventory，不预设需要
> 修改 gate 或 runtime。

## 当前状态

v56 的最终 CI 已证明 macOS live integration 真实执行并通过，但前三次 run 逐项暴露了
artifact 建立顺序：Rust unit/doc gate 不等于 production binary build，Rust binary build 也
不等于 `packages/executor/dist` 已存在。CI 目前已显式建立这两项 artifact，并在 prerequisites
后运行固定 integration entrypoint。

v57 要回答的是一个更窄的问题：本地 `pnpm verify`、单独的 `pnpm verify:rust` 和单独的
`pnpm verify:integration` 在 clean/warmed workspace 下的真实前置条件，是否已经被 README、
architecture 和 verification 文档准确表达。若没有具体行为缺口，不增加新的自动化层。

## 已完成

- [x] 建立 `docs/day-plan-v57.md`，限定为 verification artifact contract 与文档一致性。
- [x] 更新根 README 的 CI 说明：macOS job 显式构建 Rust binary、executor `dist`，再执行
  fail-closed prerequisites 与 integration。
- [x] 更新 `docs/README.md`，不再声称 `verify:rust` 单独会生成 production binary。
- [x] 修正 `docs/architecture.md` 中 Linux bwrap 已处于 planned 状态的过时描述。
- [x] 保留 v56 的最终 hosted evidence、runner pin、独立 prerequisite steps 和固定
  `verify:integration` entrypoint。

## 待完成

- [ ] 在隔离 clean checkout 中验证 artifact 缺失时的真实行为。
- [ ] 在当前 warmed workspace 中复核并与 clean evidence 对比。
- [ ] 若有可复现 mismatch，先写 RED contract，再做最小修复；否则记录 Preserve/NO-GO。
- [ ] 通过验证后更新 CHANGELOG 和本进度文档，并决定是否需要 v58。

## 当前决策

**Inventory first / no speculative gate change。** v56 的 CI 已是绿色；v57 不把新的计划当作
已有 bug，也不把本地历史构建产物当作 clean evidence。

## 下一步

1. 创建不会污染当前 checkout 的隔离验证目录。
2. 明确记录依赖安装、executor `dist`、Rust binary 和 platform prerequisites 的顺序。
3. 只在真实输出证明必要时修改代码或 gate；否则完成文档化 decision。
