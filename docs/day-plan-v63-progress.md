# v63 开发进度：Executor 模式与沙箱状态显式化

> 最后更新：2026-09-14
>
> 当前阶段：executor 与 CLI 切片已完成，Desktop health metadata 和最终 hosted CI 待完成。
>
> 本阶段不改变执行权限、不增加 Windows backend、不创建 release tag。

## 当前状态

- [x] v63 implementation plan 已建立：`docs/superpowers/plans/2026-09-14-v63-executor-mode.md`。
- [x] `packages/executor` mode metadata 已实现：`local`、平台 sandbox、`unsupported`、`unknown`。
- [x] CLI doctor 已输出 `executorMode`，human/JSON 两种模式均覆盖。
- [ ] Desktop `/health` mode metadata 待整合。
- [ ] 文档导航、最终 gates 和 hosted CI 待完成。

## RED-to-GREEN 记录

### Task 1：executor

- RED：新增 mode tests 在实现前因 `getExecutorMode`、`resolveExecutorMode` 和 `.mode` 不存在而
  编译失败。
- GREEN：实现 optional `Executor.mode`、resolver 和两个 concrete executor metadata；
  executor suite 当前 **51 passed / 0 failed**。
- Commit：`acb6e04` (`feat: expose executor mode metadata`)。

### Task 2：CLI doctor

- RED：新增 doctor assertions 在实现前因 `DoctorReport.executorMode` 不存在而编译失败。
- GREEN：doctor JSON 增加 `executorMode`，human output 增加 `executor mode: ...`；CLI suite
  当前 **119 passed / 0 failed**。
- Commit：`6873cc0` (`feat: show executor mode in doctor`)。

### Task 3：Desktop

- 状态：待实现；范围限定为 `ChatSession` 与 `/health` metadata，不修改 UI 和执行路径。

## 当前边界证据

- `LocalExecutor` 在没有 Rust binary 时仍是显式 `local`，不是 restricted fallback。
- `RustExecutor` 的 mode 由配置路径和当前平台解析，不启动子进程，不读取命令输出。
- mode metadata 与 doctor health check 分离：binary 缺失或 probe 失败仍保持原有 fail/warn。
- unsupported platform 只返回 `unsupported` metadata，现有 runtime `Unsupported` 行为保持不变。

## 验证矩阵

| 检查 | 当前状态 |
|---|---|
| executor focused suite | **51/51** |
| CLI focused suite | **119/119** |
| Desktop focused suite | 待 Desktop slice |
| documentation contract | 待 v63 links/docs |
| `pnpm verify:typescript` | 待最终变更 |
| `pnpm verify:rust` | 待最终变更 |
| `pnpm verify:integration` | 待最终变更 |
| hosted CI | 待最终推送 |
| release tag / GitHub Release | 不创建 |

## 当前决策

**GO for metadata-only mode visibility; Preserve execution semantics.** v63 不能因为显示 mode
而改变 executor selection、policy、approval、Evidence、Undo、session schema 或 release
matrix。若 Desktop integration 暴露出额外 capability 需求，记录为 v65 trigger，不在本阶段
扩大实现。
