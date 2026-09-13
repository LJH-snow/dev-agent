# v39 开发进度：evidence 发布门禁自动化与 before-image 可行性闸门

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v39.md` 为准。本文件记录每一步的实现、验证和后续路线。

## 当前状态

v38 已在 `9084db1` 完成全量验证并推送到 `origin/main`。当前开始 v39：先把固定 release gate runner 的契约写成 RED 测试，再接入根脚本和 CI；before-image 仍不进入运行时实现。

## 已完成

### v38 交付基线

- [x] v38 metadata-only audit projection、CLI/Desktop 只读导出和 evidence lifecycle matrix 已完成。
- [x] v38 全量 TypeScript **600/600**、Executor real-Rust integration **10/10**、Rust unit/doc **46/46**、结构检查、build、typecheck、fmt/clippy、`git diff --check` 通过。
- [x] 发布提交 `9084db1` 已推送到 `origin/main`，工作区在 v39 变更前保持干净。

### v39 计划与边界

- [x] 新建 `docs/day-plan-v39.md`，明确 release gate、CI 接入、before-image 闸门和 v40 路线。
- [x] 继承 `docs/evidence-audit-design-v38.md` 的禁止项：不持久化 before-image，不实现跨进程 Undo。

## 已完成

### Task 1：固定 release gate runner

- [x] 先写 RED 测试并确认缺少 runner 时按预期失败。
- [x] 新增 `scripts/release-gate.mjs`：固定 argv、固定 cwd、无 shell、canonical phase order、fail-fast 和明确退出码。
- [x] 新增 `verify`、`verify:typescript`、`verify:rust` 根脚本；TypeScript gate 也会运行 release-gate 契约测试；聚焦契约测试 **5/5** 通过，`--help` 和未知参数行为通过。
- [x] 固定 runner 提交：`d212cb0`。

### Task 2：CI 复用固定门禁

- [x] CI TypeScript job 切换到 `pnpm verify:typescript`，Rust job 切换到 `pnpm verify:rust`。
- [x] README 和 `docs/README.md` 已记录完整/分阶段门禁、固定 cwd、fail-fast 和无 shell 输入边界。
- [x] workflow 文本检查通过：CI 不再重复维护门禁命令。
- [ ] 提交 CI 与文档同步。

## 后续任务

- [x] Task 1：固定 release gate runner。
- [ ] Task 2：CI 复用固定门禁。
- [ ] Task 3：before-image 可行性闸门记录。
- [ ] Task 4：全量验证、发布和下一阶段计划。

## 设计原则

- release gate 只执行仓库内固定 argv 和固定工作目录，不拼接 shell，不接受模型输出或历史 evidence 作为命令输入。
- 完整门禁固定为 TypeScript → Rust → real-Rust integration；任何阶段失败立即停止并保留失败结果。
- audit export 仍是 metadata-only allowlist projection；任何新增字段必须逐字段评审并增加兼容性测试。
- before-image 不进入 memory schema、audit export、CLI/Desktop API 或 Undo 路径；未通过全部安全闸门前不得研究 production 恢复路径。
