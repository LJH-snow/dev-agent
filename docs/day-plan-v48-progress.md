# v48 开发进度：preview contract tests 接入固定 TypeScript release gate

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v48.md` 为准。v48 将 v45/v46 的 root contract tests
> 接入固定门禁，但不把重 benchmark 或任何 runtime authority 带入 CI。

## 当前状态

v47 已完成 canonical digest consumer inventory，结论为 design-only/NO-GO；v48 已完成
Task 0--2 与最终验证。`preview-contract` phase 已进入 TypeScript fixed gate，默认 gate
不会运行重 benchmark，下一步是提交并进入 v49。

## v47 baseline

- [x] 当前仓库没有真实 digest/cache/signature consumer，不增加 digest 字段或 schema。
- [x] hash/signature misuse、key trust、session/filter/schema binding 和 authority boundaries
  已记录。
- [x] v1 export、preview、v41 caps、pagination/schema v2、before-image/cross-process Undo
  boundaries 未改变。

## 已完成

### Task 0：冻结现有 gate 与 root test baseline

- [x] 固定 TypeScript phases、argv/cwd、report 和 fail-fast 顺序。
- [x] 选择合并的 `preview-contract` phase；full benchmark 保持 dev-only。
- [x] gate coverage matrix 与稳定 phase id 已记录于 `docs/preview-contract-gate-v48.md`。

### Task 1：root preview tests 接入 TypeScript gate

- [x] release-gate tests 先 RED，随后 exact phase/command/position/fail-fast/report regression GREEN。
- [x] `preview-contract` 运行 benchmark contract 5 tests 与 parity contract 3 tests，合计 8/8。
- [x] report 保持 metadata-only，复用 build 产物和固定 repository cwd。

### Task 2：边界与性能回归

- [x] root tests 不依赖当前日期、机器路径或外部 provider；临时 fixture 与 env 清理通过。
- [x] 默认 gate 不运行 100,000-file full benchmark。
- [x] package/Rust/integration 与 root phase counts 分层记录。

### Task 3：验证与发布

- [x] `pnpm verify`：TypeScript workspace 612/612、preview contract 8/8、release-gate contract
  11/11、Rust unit/doc 46/46、real-Rust integration 10/10。
- [x] 独立 TypeScript/Rust gate、report allowlist smoke、structure check 和 `git diff --check`
  通过。
- [x] docs、gate matrix 和 v49 计划已更新。
- [x] v48 commit/push（最终 diff review 后执行；提交前检查已通过）。

## Evidence

- `pnpm verify:typescript`：workspace 612/612、preview contract 8/8、release-gate contract 11/11。
- `pnpm verify`：Rust unit/doc 46/46、real-Rust integration 10/10。
- gate coverage matrix：`docs/preview-contract-gate-v48.md`。

## 设计原则

- root contract phase 是测试覆盖，不是新的 runtime surface。
- full benchmark 只在 `pnpm benchmark:evidence` 显式执行，不隐式增加 CI resource budget。
- 所有 gate command/argv/cwd 固定，不执行 model output 或历史 evidence。
- release report 只输出稳定 metadata，不包含命令、路径、fixture 内容或 provider details。
