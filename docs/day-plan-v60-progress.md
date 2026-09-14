# v60 开发进度：统一 roadmap 编号与项目文档 source of truth

> 最后更新：2026-09-14

> v59 已完成并推送；v60 已建立，当前先盘点 README/文档中的 roadmap 与近期状态冲突，
> 不改变 runtime、API 或 release authority。

## 当前状态

根 README 的 Roadmap 在第 63 项后重新出现 47–54 的编号，近期 v-plan 与 CHANGELOG 也有
历史条目混排现象。v60 要先区分“历史事实保留”与“当前导航清晰”这两个目标，再决定是否
做最小文档修复；不为文档问题新增 generator 或依赖。

## 已完成

- [x] 建立 `docs/day-plan-v60.md`，限定为 roadmap/documentation source-of-truth inventory。
- [x] 保留 v59 的 packaging smoke decision、v58 release contract 和 v56 hosted evidence。

## 待完成

- [ ] 盘点 roadmap 全部编号、重复项和近期计划链接。
- [ ] 对照 README、docs/README、architecture、CHANGELOG 与 progress 文档。
- [ ] 写 bounded 文档 contract 或审计清单，并做最小修复（若有具体 mismatch）。
- [ ] 验证、更新 CHANGELOG，并决定是否建立 v61。

## 当前决策

**Inventory first / preserve history.** 先确认文档冲突的范围；不删除历史条目、不改变
功能状态、不把文档清理扩张成新的自动化系统。

## 下一步

1. 读取 README Roadmap 的完整编号和对应描述。
2. 找到近期 day-plan/decision 文档的 source-of-truth 关系。
3. 只在审计证明必要时修正导航或编号。
