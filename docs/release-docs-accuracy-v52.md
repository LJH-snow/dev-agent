# Release documentation accuracy decision（v52）

**日期：2026-09-14**

## Trigger

`README.md` 的项目状态仍写着 **543 TypeScript tests**，但 v52 开始时可用的固定 release
 gate 记录已经明显高于这个历史数字，另有独立的 preview-contract 和 release-gate contract
阶段。这个差异会让读者低估当前验证覆盖，因此构成一个具体、可验证的 release-documentation
correctness trigger。

## Initial minimal slice

v52 先做了一个最小文档修正：把 README 的旧 543 摘要换成当时记录的 gate 口径（TypeScript
workspace 612、preview-contract 8、release-gate contract 11、Rust unit/doc 46、real-binary
integration 10）。没有修改测试 runner、测试逻辑、门禁顺序、API、schema 或产品行为。

## Revalidation note

v53 的 source-of-truth inventory 对同一工作区做了新一轮验证，发现 **612 也不是稳定的当前
数字**：

- `pnpm test` 的八个 workspace package 当前分别为 54、30、49、48、118、121、76、118，
  合计 **614/614**；
- `pnpm verify` 通过，preview-contract **8/8**、release-gate contract **11/11**、Rust
  unit/doc **46/46**、real-Rust integration **10/10**；
- 因此 v52 的 612 修正被 v53 的新证据 supersede，不能继续作为 README 的 evergreen 当前
  计数。

历史 changelog 和 day-plan 中的数字保留其各自日期的验证记录，不回写成当前状态。

## Final boundary

v52 没有 runtime code 变更。v53 将 README 当前摘要改为只描述 fixed release gate 覆盖的
suite 类别，不再硬编码会漂移的总数；精确计数只进入带日期的 release notes/source-of-truth
decision doc。这样既修复 543 的明显错误，也避免用第二套手工计数制造新的错误。

Desktop preview/accessibility、Evidence schema/export、limits、session memory、fixed release
gate、provider/workspace side effects 和 Undo boundary 均保持不变。
