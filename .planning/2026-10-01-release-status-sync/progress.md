# Progress — npm 与 GitHub 发布状态同步

## 2026-10-01

- 已核实 npm latest 为 0.2.0（2026-09-30），GitHub 最新正式 release 仍为 v0.1.8，v0.2.0 尚无 tag/release。
- 先更新 documentation-contract tests，明确区分当前 npm 发布和历史 GitHub release，再运行 RED。
- RED 已确认旧断言错误地要求 npm、candidate 和 GitHub release 版本完全相同。
- 已将 release-state published/candidate 同步为 0.2.0；README、npm 发布说明、next-roadmap、changelog 和契约测试现区分 npm latest 与 GitHub v0.1.8。
- documentation-contract 和 npm-release-preflight 测试通过；当前 pnpm release:preflight 按设计返回 candidate_not_newer，需下次 bump package 与 candidateVersion 后再预检。
