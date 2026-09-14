# Day plan v57：验证 fresh-checkout verification artifact contract 与文档一致性

**建立日期：2026-09-14**

**当前状态：已建立；先做隔离 workspace inventory，再决定是否需要最小 gate/harness 修复。**

> 本计划承接 `docs/day-plan-v56.md`。v56 已通过最终 hosted run：Ubuntu Rust、TypeScript 和
> macOS live integration 均成功，macOS integration 为 10/10、0 skipped。前三次失败说明
> verification 依赖的 production Rust binary 与 executor `dist` artifact 必须被显式建立；
> v57 不重新打开已通过的 sandbox runtime 行为，只验证本地命令、fresh checkout 与文档是否
> 对这项边界表达一致。

## Goal

在不改变 runtime/API/schema 的前提下，确认以下命令在 clean workspace、已有 artifact 的
workspace 和缺少 artifact 的 workspace 中的行为与文档一致：

- `pnpm verify`
- `pnpm verify:rust`
- `pnpm verify:integration`

如果发现 macOS 上 artifact 缺失会让 integration 静默 skip，先写针对真实输出的 RED contract，
再选择最小的 preflight、脚本边界或文档修复；如果没有稳定的新增 consumer，则 Preserve/NO-GO，
不为追求更自动化而扩张 release gate authority。

## Global constraints

- 复用 `scripts/release-gate.mjs` 的固定 argv、cwd、`shell=false` 和 fail-fast 语义；不把
  任意 shell 链接塞进 root gate。
- 不把 skipped tests 解释为 live sandbox coverage；CI 的 macOS prerequisite 继续 fail-closed。
- 不改变 Rust/TypeScript runtime、protobuf、Evidence、session、Undo、公开 API/schema 或
  release report。
- 不新增第三方运行时依赖；隔离 workspace 的清理与验证不能修改当前 checkout 的用户文件。
- 没有可复现行为差异时不写 speculative code；优先维护精确文档和边界说明。

## Task 0：inventory 与边界确认

- [x] 记录 v56 最终 hosted run 及 artifact 建立顺序。
- [x] 对照 `README.md`、`docs/README.md`、`docs/architecture.md`、workflow 和固定 gate，
  修正文档中“Rust gate 会生成 production binary”及 Linux bwrap 状态的过时表述。
- [ ] 在隔离的 clean checkout 中运行必要的 bounded checks，记录哪些命令需要先安装依赖、
  构建 executor `dist` 或构建 Rust binary。
- [ ] 在当前 warmed workspace 复核相同命令，避免把历史 build artifact 当作 clean evidence。

## Task 1：RED contract 与决策

- [ ] 若 clean/warmed 行为与文档不一致，先写最小 RED contract，锁定错误/skip 的具体输出。
- [ ] 评估是否需要 gate preflight；优先选择不改变固定命令 authority 的方案。
- [ ] 若只需文档即可清楚表达边界，记录 Preserve/NO-GO，不增加 wrapper、计数解析或重复
  runner。

## Task 2：最小实现（仅在 Task 1 有证据时）

- [ ] 实现并测试选定的 preflight、artifact preparation 或文档修复。
- [ ] 保持 macOS hosted live integration 的显式 build 与 fail-closed checks，不削弱现有
  coverage。
- [ ] 不把 Ubuntu 的 platform-specific skip 改写成 macOS enforcement 成功。

## Task 3：验证、文档与下一阶段

- [ ] 运行 focused contract、必要的本地 gate、structure/diff checks。
- [ ] 如有代码或 workflow 变更，推送并观察真实 CI；否则仅提交文档 decision。
- [ ] 更新 v57 progress、CHANGELOG 和相关 README；完成后再建立下一个具体计划。

## Acceptance checklist

- [ ] clean 与 warmed workspace 的 artifact 前置条件有可复现记录。
- [ ] integration 缺少必要 artifact 时不会被误报为 live coverage。
- [ ] fixed gate 的命令 authority、fail-fast 和 metadata-only report 边界保持不变。
- [ ] 没有无证据扩展 runtime/API/schema/CI 复杂度。
