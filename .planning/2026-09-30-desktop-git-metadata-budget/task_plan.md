# Desktop Git 元数据预算降级

## 目标

当工作区的 Git porcelain 输出超过 16 KiB 上限时，Desktop capability metadata 不应因为无关的大量未跟踪文件直接降级为 `invalid`。在不返回路径/内容、保持 bounded 和只读的前提下，保留 `ready`、`dirty`，并在无法可靠计数时省略 `changedFiles`。

## 范围

- 只修改 `apps/desktop/src/capabilities.ts` 与 `apps/desktop/tests/capabilities.test.ts`。
- 不触碰其他窗口的 CLI、`.mimosa/`、`.zcode*` 或未跟踪 planning 产物。
- 不放宽 GitHub/CI mutation 边界，不返回 raw Git output。

## 阶段

- [deferred] 另一窗口已接手同一 Desktop capability 修复；本窗口撤回了重复测试，不再触碰这些文件。
- [deferred] 由并行窗口完成，避免重复实现或混入提交。
- [deferred] 由并行窗口完成。
- [deferred] 本窗口不提交 Desktop capability 文件。
