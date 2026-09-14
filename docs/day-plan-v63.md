# Day plan v63：Executor 模式与沙箱状态显式化

**建立日期：2026-09-14**

**当前状态：已完成；只增加 metadata，不改变执行语义。**

> v62 已经补齐 macOS/Linux sandbox live evidence，v64 已经完成四平台 release candidate
> audit。v63 处理另一个容易误解的边界：用户需要知道当前工具到底走的是本地执行器、哪种
> Rust sandbox，还是一个明确的 unsupported/unknown 状态；这个状态本身不是权限控制，也不
> 能把 LocalExecutor 当成 restricted fallback。

## Goal

让 CLI doctor 和 Desktop health metadata 明确表达当前 executor mode，同时保持：

- `Executor.run`、`SandboxExecutor.runSandboxed`、protobuf 和 Rust runtime 不变；
- 现有 LocalExecutor 与 RustExecutor 的执行行为不变；
- health failure、missing binary、unsupported platform 与 mode metadata 分开表达；
- injected test executor 没有 mode 时显示 `unknown`，不猜测或泄露实现细节。

## Mode vocabulary

- `local`：未配置 Rust binary，工具使用 `LocalExecutor`；这不是 sandbox。
- `sandboxed-macos`：已选择 Rust executor，目标平台为 macOS；是否可用仍由 doctor health check
  决定。
- `sandboxed-linux`：已选择 Rust executor，目标平台为 Linux；是否可用仍由 doctor health check
  决定。
- `unsupported`：已配置 Rust path，但当前平台没有 active Rust backend；继续保持现有
  `Unsupported` 行为。
- `unknown`：外部注入的 executor 没有提供 mode metadata；不得推断为 sandboxed 或 local。

## Scope

### Included

- `packages/executor` 的 optional mode metadata 和平台 resolver；
- CLI doctor 的 JSON 与 human-readable mode 输出；
- Desktop `ChatSession` 与 `GET /health` 的 metadata-only mode；
- RED-to-GREEN executor、CLI、Desktop 和 documentation contracts；
- 本地 fixed gates、hosted CI 和本 progress 记录。

### Explicitly excluded

- 不修改命令执行、审批、policy、filesystem/network/resource limits 或 cancellation；
- 不修改 protobuf、session memory schema、Evidence、Undo 或 export；
- 不新增 Desktop panel、通知、快捷键或 mode-based permission control；
- 不添加 Windows backend、Windows release target 或无沙箱 fallback；
- 不把 mode metadata 解释为 runtime health proof。

## Task 0：contract 与边界

- [x] 盘点 executor、CLI doctor、Desktop server 的现有 mode/health 入口。
- [x] 写入 v63 implementation plan：`docs/superpowers/plans/2026-09-14-v63-executor-mode.md`。
- [x] 先加入 documentation contract expectation，并验证缺少 v63 文档时 RED。

## Task 1：executor mode metadata

- [x] 为 LocalExecutor、RustExecutor 和 injected executor 定义 mode contract。
- [x] 用 platform resolver 区分 `local`、`sandboxed-macos`、`sandboxed-linux`、`unsupported`、`unknown`。
- [x] 保持执行方法签名和行为不变；executor focused suite **51/51** 通过。

## Task 2：CLI doctor

- [x] doctor JSON 报告 `executorMode`。
- [x] doctor human output 显示 `executor mode`。
- [x] mode 与 Rust health check 分离；binary 缺失仍然是 fail，不被 mode metadata 掩盖。
- [x] CLI focused suite **119/119** 通过。

## Task 3：Desktop health metadata

- [x] `ChatSession` 暴露 mode metadata，server-facing fake session 保持 `unknown` fallback。
- [x] `GET /health` 返回 `status` 和 `executorMode`。
- [x] Desktop focused suite **79/79** 通过，且 `/api/chat`、Evidence、session memory 和 UI 不变。

## Task 4：文档与验证

- [ ] 更新 README、docs index、CHANGELOG 和 documentation contract。
- [ ] 运行 TypeScript、Rust、real-Rust integration、structure、YAML 和 diff checks。
- [x] 推送后确认 Rust、TypeScript、macOS integration、Linux integration hosted CI 全部通过。
- [ ] 不创建 release tag 或 GitHub Release。

## Acceptance checklist

- [x] mode metadata 对 LocalExecutor/RustExecutor 正确；未知注入实现不被误标。
- [x] CLI doctor JSON 与 human output 都能看到 mode，health 状态仍独立。
- [x] Desktop `/health` 只暴露 mode，不泄露路径、命令、环境或原始 runtime 输出。
- [x] unsupported platform 仍 fail-closed，没有 Windows backend 或 release target。
- [x] 所有 fixed gates 和 hosted CI 通过；没有修改执行权限语义。

## Decision boundary

本地 fixed gates 与 hosted CI 均已通过，mode metadata 已在 executor、CLI doctor 和 Desktop
`/health` 中稳定表达；v63 只代表状态可见性改善，不改变执行权限。更丰富的 Desktop UX
和 capability readiness 继续留给 v65 的真实反馈触发条件。
