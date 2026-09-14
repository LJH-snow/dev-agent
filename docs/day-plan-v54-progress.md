# v54 开发进度：按需定义机器可读测试指标契约

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v54.md` 为准。v54 已完成 inventory 和 Preserve/NO-GO
> 决策，没有添加 metrics reporter、脚本或 release-report 字段。

## 当前状态

v53 fresh gate 证明当前 TypeScript workspace 为 614/614，但也证明把总数手工写进 evergreen
README 会产生 543→612→614 漂移。v54 检查了 CI、package scripts、gate report 和 docs，没有
找到需要 machine-readable counts 的消费者，因此继续保持 category-only README。

inventory 期间另外确认：`.github/workflows/ci.yml` 只有 TypeScript 与 Ubuntu Rust jobs，没有
在 macOS sandbox runner 上运行 live Rust integration。这个 coverage gap 不属于 metrics 方案，
已转入 v55。

## 已完成

- [x] 检查 `.github/workflows/ci.yml`、`scripts/release-gate.mjs`、root package scripts 和
  report contract，确认没有 metrics consumer。
- [x] 评估 stdout parsing、静态 `test()` 扫描、report 扩展和重复 gate wrapper；全部保持
  Preserve/NO-GO。
- [x] 保留 README suite-category-only 文案和 metadata-only report boundary。
- [x] 记录独立的 macOS live integration CI trigger，并建立 `docs/day-plan-v55.md`。

## Validation

- [x] `pnpm verify`：当前 fixed gate 通过；计数证据为 workspace 614/614、preview 8/8、
  release-gate 11/11、Rust unit/doc 46/46、real-Rust integration 10/10。
- [x] `node scripts/check.mjs` 通过。
- [x] `git diff --check` 通过。
- [x] 未引入 metrics code、dependency、API、schema 或 report allowlist 变化。

## Decision

**Preserve / NO-GO for automatic test-count generation.** v54 已收束；下一步不是继续猜测
metrics，而是验证 v55 的 CI live integration coverage。

## 发布状态

- [x] v54 decision/progress/changelog 已更新。
- [x] v55 plan 与 progress 已建立。
- [x] v55 的 RED contract 已开始，并已发现预期失败。
