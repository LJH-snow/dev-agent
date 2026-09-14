# v48 开发进度：preview contract tests 接入固定 TypeScript release gate

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v48.md` 为准。v48 将 v45/v46 的 root contract tests
> 接入固定门禁，但不把重 benchmark 或任何 runtime authority 带入 CI。

## 当前状态

v47 已完成 canonical digest consumer inventory，结论为 design-only/NO-GO；v48 已建立
计划，下一步先核对 release gate 的固定 phase 和 root test 运行边界。

## v47 baseline

- [x] 当前仓库没有真实 digest/cache/signature consumer，不增加 digest 字段或 schema。
- [x] hash/signature misuse、key trust、session/filter/schema binding 和 authority boundaries
  已记录。
- [x] v1 export、preview、v41 caps、pagination/schema v2、before-image/cross-process Undo
  boundaries 未改变。

## 进行中

### Task 0：冻结现有 gate 与 root test baseline

- [ ] inventory TypeScript release gate phases、argv/cwd、report 和 fail-fast。
- [ ] 选择 8 个轻量 preview contract tests 的固定 phase；full benchmark 保持 dev-only。
- [ ] 写 gate coverage matrix 与稳定 phase id。

### Task 1：root preview tests 接入 TypeScript gate

- [ ] 先写 RED gate coverage tests。
- [ ] 运行 benchmark contract 5 tests 与 parity contract 3 tests。
- [ ] 保持 report metadata-only、固定命令和固定 cwd。

### Task 2：边界与性能回归

- [ ] 验证日期、路径、provider、workspace 和 env 隔离。
- [ ] 确认默认 gate 不运行 100,000-file full benchmark。
- [ ] 记录 root phase 与 package/Rust/integration counts 分层。

### Task 3：验证与发布

- [ ] full gates、docs、commit/push 和 v49 计划。

## 设计原则

- root contract phase 是测试覆盖，不是新的 runtime surface。
- full benchmark 只在 `pnpm benchmark:evidence` 显式执行，不隐式增加 CI resource budget。
- 所有 gate command/argv/cwd 固定，不执行 model output 或历史 evidence。
- release report 只输出稳定 metadata，不包含命令、路径、fixture 内容或 provider details。
