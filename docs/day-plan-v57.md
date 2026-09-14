# Day plan v57：验证 fresh-checkout verification artifact contract 与文档一致性

**建立日期：2026-09-14**

**当前状态：已完成；clean/warmed inventory 已记录，测试路径已修复，gate 自动预备 artifact 维持 Preserve/NO-GO。**

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
- [x] 在隔离的 clean checkout 中运行 bounded checks：直接 integration 因 executor `dist`
  缺失而失败；完整 verify 在 TypeScript build 后会显示 Rust integration **10 skipped**，
  因 Rust binary 尚未构建。
- [x] 在当前 warmed workspace 复核相同命令：构建好 Rust binary 后完整 `pnpm verify` 的
  integration 为 **10/10**。

## Task 1：RED contract 与决策

- [x] 记录 clean checkout 的 release-gate contract failure：测试硬编码 `/dev-agent` 后缀，
  在隔离路径下为 11/12。
- [x] 先写最小 RED 修复并改为从 `import.meta.url` 解析 repository root。
- [x] 评估 gate preflight：保留 platform-specific skip 和 hosted macOS 专用 authority，
  对固定 gate 自动预备 artifact 记录 Preserve/NO-GO。

## Task 2：最小实现

- [x] 修复 release-gate contract 的路径可移植性，不改变 gate 命令、runtime 或 API。
- [x] 更新 README、`docs/README.md` 和 architecture 的前置条件/状态描述。
- [x] 保持 macOS hosted live integration 的显式 build 与 fail-closed checks，不削弱现有
  coverage。
- [x] 不把 Ubuntu 的 platform-specific skip 改写成 macOS enforcement 成功。

## Task 3：验证、文档与下一阶段

- [x] 运行 focused contract **12/12**、当前 warmed `pnpm verify`、structure/diff checks。
- [x] clean/warmed evidence、Preserve/NO-GO decision 和相关文档均已记录并推送。
- [x] 建立下一阶段计划 `docs/day-plan-v58.md`。

## Acceptance checklist

- [x] clean 与 warmed workspace 的 artifact 前置条件有可复现记录。
- [x] integration 缺少必要 artifact 时的失败/skip 行为已明确记录，不被误报为 live coverage。
- [x] fixed gate 的命令 authority、fail-fast 和 metadata-only report 边界保持不变。
- [x] 没有无证据扩展 runtime/API/schema/CI 复杂度。
