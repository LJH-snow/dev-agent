# npm 与 GitHub 发布状态同步

## 目标

把仓库发布状态单一来源、README、发行说明和文档契约同步到已核实的现实状态：npm latest 为 0.2.0，最新正式 GitHub Release 仍为 v0.1.8；不创建 tag 或 GitHub Release。

## 阶段

- [x] 先更新发布状态契约测试并确认 RED。
- [x] 同步 docs/release-state.json、安装文档和 next-roadmap 状态说明。
- [x] 记录 v0.2.0 的 npm 发布与 GitHub Release 差异，修复旧错误条目。
- [x] 运行文档契约、release preflight metadata contract 和 scoped checks。

## 约束

- npm registry 显示 @agent_cli/cli@0.2.0 于 2026-09-30 发布并为 latest。
- GitHub Releases API 显示最新正式 release/tag 为 v0.1.8；v0.2.0 查询 404，且本地没有 v0.2.0 tag。
- 只同步文档、release-state 和对应契约测试；不更改 package version，不发布、不打 tag、不创建 release。
- 保留并行窗口 apps/desktop/src/autofix.ts、apps/desktop/tests/autofix-loop.test.ts 和 .mimosa/ 变更。
