# v64 开发进度：发布前 Release Candidate 审计

> 最后更新：2026-09-14
>
> 当前阶段：本地 contract 已完成；四平台 hosted `workflow_dispatch` 验证待执行。
> 本阶段不创建 tag、不发布 GitHub Release。

## 当前状态

- [x] 建立 `docs/day-plan-v64.md`，明确四平台审计范围和正式发布边界。
- [x] 工作区初始基线为 `main`，此前 v62 Linux/macOS hosted sandbox evidence 已关闭。
- [x] release matrix 保持四个 target：两个 macOS、两个 Linux；没有 Windows target。
- [ ] 等待同一 commit 的 hosted manual run 完成四个 build jobs 和 artifact 复核。

## RED-to-GREEN 记录

### RED

在修改 workflow 前，新增的 release contract 明确复现了两个风险：

- publish job 仅判断 `refs/tags/`，如果手动运行时选择 tag-shaped ref，静态条件无法证明
  “manual dispatch 永不发布”；
- package step 没有在上传前明确验证 binary executable bit、README、archive 内容和 checksum。

本地 `node --test tests/release-workflow.test.mjs` 的 RED 结果为 **2 passed / 2 failed**，
失败点分别对应上述两个缺口。

### GREEN

已完成最小 workflow 修复，并重新运行 release contract：

- publish 条件改为 `github.event_name == 'push' && startsWith(github.ref, 'refs/tags/')`；
- 每个 target 上传前检查 binary、README、archive entries 和 checksum；
- release contract 当前为 **4/4 passed**。

## 已完成的本地审计项

- `workflow_dispatch` 仍然存在，matrix 明确列出四个平台 target；
- artifact 名称继续使用 `dev-agent-executor-${{ matrix.target }}`；
- archive 与 checksum 仍是每个 target 独立上传，不混用构建目录路径；
- 正式 tag push 的 publish authority 没有被移除，只把 manual run 的入口收窄为 build-only。

## Hosted evidence（待填写）

| 项目 | 结果 |
|---|---|
| Commit SHA | 待 hosted run |
| Workflow run | 待 hosted run |
| `aarch64-apple-darwin` | 待验证 |
| `x86_64-apple-darwin` | 待验证 |
| `x86_64-unknown-linux-gnu` | 待验证 |
| `aarch64-unknown-linux-gnu` | 待验证 |
| Archive / checksum / README / executable | 待验证 |
| Publish job | 必须为 `skipped` |
| GitHub Release / tag | 必须为“未创建” |

## 本地验证（待最终变更后重跑）

- [x] `node --test tests/release-workflow.test.mjs`：4/4。
- [ ] `pnpm verify:typescript`。
- [ ] `pnpm verify:rust`。
- [ ] `pnpm verify:integration`。
- [ ] workflow YAML parse、structure check、`git diff --check`。

## 当前决策

**GO for hosted release-candidate audit only; NO-GO for formal release.** 在 hosted run 证明四个
target、artifact 内容、checksum 和 publish skipped 之前，不创建 tag；即使审计全部通过，也
只代表 release candidate readiness evidence 可用，不代表已经授权发布。
