# v63 开发进度：Executor 模式与沙箱状态显式化

> 最后更新：2026-09-14
>
> 当前阶段：v63 已完成 executor、CLI、Desktop、fixed gates 与 hosted CI 验证。
>
> 本阶段不改变执行权限、不增加 Windows backend、不创建 release tag。

## 当前状态

- [x] v63 implementation plan 已建立：`docs/superpowers/plans/2026-09-14-v63-executor-mode.md`。
- [x] `packages/executor` mode metadata 已实现：`local`、平台 sandbox、`unsupported`、`unknown`。
- [x] CLI doctor 已输出 `executorMode`，human/JSON 两种模式均覆盖。
- [x] Desktop `/health` mode metadata 已整合并通过 focused suite。
- [x] 文档导航、本地 fixed gates 和 hosted CI 均已完成。

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

- RED：Desktop focused suite 在实现前为 **75 passed / 4 failed**，失败均指向缺失的 mode
  metadata、fake fallback 或 health response 字段。
- GREEN：`ChatSession.executorMode`、`DesktopChatSession.executorMode?` 和 `/health` response
  已实现；Desktop suite 当前 **79 passed / 0 failed / 0 skipped**。
- Commit：`b9a2de7` (`feat: expose executor mode in desktop health`)。
- 范围保持 metadata-only；没有修改 `/api/chat`、Evidence、session memory、UI 或执行逻辑。

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
| Desktop focused suite | **79/79** |
| documentation contract | **2/2** |
| `pnpm verify:typescript` | **通过**：preview 8/8、release-gate 13/13、release-workflow 4/4、documentation 2/2；CLI 119、Desktop 79、executor 51 tests 均通过 |
| `pnpm verify:rust` | **46/46**：43 library + 3 binary，0 failed |
| `pnpm verify:integration` | **10/10**，0 skipped |
| hosted CI | [34856545896](https://github.com/LJH-snow/dev-agent/actions/runs/34856545896)：Rust、TypeScript、macOS integration、Linux integration 全部 success |
| release tag / GitHub Release | 不创建 |

## Hosted CI evidence

- Commit: `e1f1efb59fa5047a9a51c3f0426786faf6517a45`
- Run: [34856545896](https://github.com/LJH-snow/dev-agent/actions/runs/34856545896)
- Event/ref: `push` on `main`
- Rust：success
- TypeScript：success（包含 documentation、release-workflow 和 executor/CLI/Desktop tests）
- macOS integration：success
- Linux integration：success（live `bwrap` prerequisites 与 real-Rust integration 通过）

## 当前决策

**GO for metadata-only mode visibility; Preserve execution semantics.** 本地与 hosted 证据已经证明
v63 没有改变 executor selection、policy、approval、Evidence、Undo、session schema 或 release
matrix。若未来需要额外 capability UX，记录为 v65 trigger，不在本阶段扩大实现。
