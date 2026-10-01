# Findings — npm/GitHub 发布状态

## 核验事实

- npm registry 的 dist-tag latest 和包版本均为 0.2.0，发布时间为 2026-09-30。
- GitHub 最新正式 release/tag 是 v0.1.8；查询 tag v0.2.0 返回 404，本地也没有该 tag。
- docs/release-state.json 和部分 README 把 0.1.8 同时记为 latest published 与 package candidate；apps/cli/package.json 已是 0.2.0。
- 当前文档契约失败源于把 npm 当前包版本、历史 v0.1.8 GitHub release 和未来候选版本混成同一版本。

## 设计决定

- release-state 表示 npm publishedVersion/candidateVersion 当前都为 0.2.0、status 为 published；下一候选版本准备时再同时提升 package 和 candidateVersion。
- 文档明确 npm 0.2.0 已发布，但它尚无对应 GitHub tag/release；不暗示 npm publish 自动产生 GitHub release。
- v0.1.8 的历史资产、workflow run 和 GitHub release 证据保留为历史记录。
