# Day plan v60：统一 roadmap 编号与项目文档 source of truth

**建立日期：2026-09-14**

**当前状态：已完成；roadmap 已归一化，bounded 文档 contract 已进入 fixed TypeScript gate。**

> 本计划承接 `docs/day-plan-v59.md`。v59 已完成 release artifact 的单 target 手工 smoke，并
> 对永久自动化作 Preserve/NO-GO。v60 的 inventory 发现根 README 的 Roadmap 原本在第 63 项
> 后重新出现 47–54 的编号；本轮只做可验证的文档 source-of-truth 修复，不改变 runtime、API
> 或 release authority。

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

- [x] 列出 README Roadmap 的全部条目，识别重复编号、缺失编号和重复描述。
- [x] 对照近期 v56–v59 day-plan、CHANGELOG、README 和 architecture 的完成状态。
- [x] 确认 source of truth：README 负责用户可见状态/roadmap，architecture 负责结构边界，
  day-plan/progress 负责决策与验证过程，CHANGELOG 负责时间顺序；workflow、fixed gate 和
  contract tests 负责可执行行为。

**Inventory result：** Roadmap 共 71 项。第 1–63 项连续，原第 64–71 项错误地重复使用
47–54；没有发现需要改写 runtime、sandbox 或 release workflow 的状态冲突。近期记录的
macOS hosted integration、Linux `bwrap` active 状态、artifact 前置条件、release static
contract 和 packaging smoke decision 均保留原有 source-of-truth。

## Task 1：RED documentation contract

- [x] 新增 bounded `tests/documentation-contract.test.mjs`，只锁定 roadmap 编号和文档导航，
  不扩张为全文语法或自然语言 lint。
- [x] 先记录 RED：contract 在修复前明确失败，观察到 `[1..63, 47..54]` 与期望的连续编号
  不一致。
- [x] 将 documentation contract 作为 fixed TypeScript gate 的独立 step，保持 fail-fast 和
  固定命令数组。

## Task 2：最小修复

- [x] 保留原有八条 roadmap 描述，只将重复的 47–54 重编号为 64–71。
- [x] 在根 README 与 `docs/README.md` 增加有限、明确的 source-of-truth 导航，指向
  architecture、CHANGELOG、v60 plan 和 progress；没有新增 generator、依赖或发布入口。
- [x] 复核近期 CI/release/sandbox 表述；没有新的具体 mismatch，因此不做 speculative
  runtime、workflow 或状态改写。

## Task 3：验证、文档与下一阶段

- [x] focused documentation contract **2/2**；release-gate contract 保持 **12/12**。
- [x] 运行完整 `pnpm verify`、structure/check 脚本、workflow YAML parse 和 `git diff --check`。
- [x] 本地验证通过后准备提交并推送；只触发普通 CI，不创建 tag、不上传 artifact、不发布
  GitHub Release。
- [ ] 记录 hosted CI run，并决定 v61 是否只建立在新的、具体的证据或需求上。

## Acceptance checklist

- [x] roadmap 编号/分组不再产生歧义。
- [x] 近期状态与对应 day-plan/decision 文档可追溯。
- [x] 历史事实、NO-GO/deferred 边界和 release authority 未被删除或改变。
- [x] 没有无证据增加 runtime、workflow、依赖或自动化复杂度。
- [x] 本地 fixed gate 与 structure/YAML/diff checks 均通过。
- [ ] 普通 hosted CI 通过并完成远端 evidence 记录。

## Decision boundary

**GO for roadmap normalization and bounded documentation navigation; Preserve history.** 不新增
自动编号生成器，不改变 release authority，也不把文档 contract 解释成 runtime 或跨平台
release coverage。v61 只有在出现新的具体文档漂移、release candidate evidence 或用户导航
需求时才扩大范围。
