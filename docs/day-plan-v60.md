# Day plan v60：统一 roadmap 编号与项目文档 source of truth

**建立日期：2026-09-14**

**当前状态：已建立；先盘点文档结构，不改变 runtime、API 或 release authority。**

> 本计划承接 `docs/day-plan-v59.md`。v59 已完成 release artifact 的单 target 手工 smoke，并
> 对永久自动化作 Preserve/NO-GO。当前根 README 的 Roadmap 在第 63 项后重新出现 47–54 的
> 编号，`docs/CHANGELOG.md` 也混合了不同阶段的历史条目；这会降低用户判断项目当前状态的
> 可靠性。v60 只处理可验证的文档 source-of-truth，不借机新增功能。

## Goal

让 README、`docs/README.md`、architecture、day-plan progress 和 CHANGELOG 对以下事实表达
一致：

- roadmap 每个条目有唯一、稳定的编号或明确的历史分组；
- 已完成项目、当前状态和 deferred/NO-GO 边界可追溯到对应计划/decision 文档；
- release/CI/sandbox 状态不由重复或过时的文字决定；
- 历史记录保留，不删除事实，只修正导航、编号和 source-of-truth 指向。

## Global constraints

- 不修改 Rust/TypeScript runtime、protobuf、Evidence、session、Undo、公开 API/schema 或
  workflow behavior。
- 不重新解释历史测试 counts，不把文档清理伪装成新的功能完成。
- 保留历史 changelog 内容；必要时用标题、日期或链接分组，不大段重写历史叙述。
- 没有明确 mismatch 时不新增 doc generator、依赖或自动编号脚本。

## Task 0：inventory

- [ ] 列出 README Roadmap 的全部条目，识别重复编号、缺失编号和重复描述。
- [ ] 对照每个近期 v-plan 的完成状态、CHANGELOG 和 Current Status，标出冲突文本。
- [ ] 确认哪些文件是事实 source of truth，哪些只应作为导航/摘要。

## Task 1：RED documentation contract

- [ ] 写一个 bounded 文档 contract 或可审计清单，锁定唯一编号/链接与近期状态一致性。
- [ ] 记录实现前的具体 mismatch，不扩张到全文语法或自然语言 lint。

## Task 2：最小修复

- [ ] 修正 roadmap 编号和导航链接，保留历史项目与已记录的 NO-GO/deferred 决策。
- [ ] 修正近期 CI/release/sandbox 状态的过时表述；不改变 workflow 或 gate。
- [ ] 若 contract 没有证明稳定 consumer，保留人工审阅，不新增自动生成器。

## Task 3：验证、文档与下一阶段

- [ ] 运行文档 contract、structure/diff checks 和必要的 fixed gate。
- [ ] 如只修改文档，提交并推送，不触发 tag release；如发现代码 mismatch，另立具体计划。
- [ ] 更新 v60 progress、CHANGELOG，并决定是否需要 v61。

## Acceptance checklist

- [ ] roadmap 编号/分组不再产生歧义。
- [ ] 近期状态与对应 day-plan/decision 文档可追溯。
- [ ] 历史事实、NO-GO/deferred 边界和 release authority 未被删除或改变。
- [ ] 没有无证据增加 runtime、workflow、依赖或自动化复杂度。
