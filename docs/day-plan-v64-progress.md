# v64 开发进度：发布前 Release Candidate 审计

> 最后更新：2026-09-14
>
> 当前阶段：已完成本地 contract 与四平台 hosted `workflow_dispatch` 验证。
> 本阶段不创建 tag、不发布 GitHub Release。

## 当前状态

- [x] 建立 `docs/day-plan-v64.md`，明确四平台审计范围和正式发布边界。
- [x] 工作区初始基线为 `main`，此前 v62 Linux/macOS hosted sandbox evidence 已关闭。
- [x] release matrix 保持四个 target：两个 macOS、两个 Linux；没有 Windows target。
- [x] 同一 commit 的 hosted manual run 已完成四个 build jobs 和 artifact 复核。

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

## Hosted evidence

- Commit: `972a229a50171805ad85bd45d53e1b06c01ebb9d`
- Workflow run: [34844424584](https://github.com/LJH-snow/dev-agent/actions/runs/34844424584)
- Event/ref: `workflow_dispatch` on `main`; run conclusion: **success**。

| Target | Build job | Artifact | Package audit |
|---|---|---|---|
| `aarch64-apple-darwin` | success | `dev-agent-executor-aarch64-apple-darwin` | checksum OK；binary `-rwxr-xr-x`；README 与 archive entries OK |
| `x86_64-apple-darwin` | success | `dev-agent-executor-x86_64-apple-darwin` | checksum OK；binary `-rwxr-xr-x`；README 与 archive entries OK |
| `x86_64-unknown-linux-gnu` | success | `dev-agent-executor-x86_64-unknown-linux-gnu` | checksum OK；binary `-rwxr-xr-x`；README 与 archive entries OK |
| `aarch64-unknown-linux-gnu` | success | `dev-agent-executor-aarch64-unknown-linux-gnu` | checksum OK；binary `-rwxr-xr-x`；README 与 archive entries OK |

- 四个 artifact 均已从 run 下载并逐一复核；GitHub artifact API 返回 `expired=false`。
- `Publish release` job：**skipped**，因为 run event 是 `workflow_dispatch` 而不是 tag push。
- hosted run 后 `gh release list` 为空，远端 `refs/tags/v*` 为空；没有创建 GitHub Release、tag
  或 release asset。

## 本地验证

- [x] `node --test tests/release-workflow.test.mjs`：4/4。
- [x] `pnpm verify:typescript`：workspace、preview、release-gate、release-workflow 和 documentation contracts 全部通过。
- [x] `pnpm verify:rust`：Rust unit/doc tests **46 passed / 0 failed**。
- [x] `pnpm verify:integration`：real-Rust integration **10/10 passed / 0 skipped**。
- [x] workflow YAML parse、structure check、`git diff --check`。

## 当前决策

**GO for release-candidate readiness evidence; NO-GO for formal release.** hosted run 已证明四个
target、artifact 内容、checksum 和 publish skipped；这只代表 release candidate readiness
evidence 可用，不代表已经授权发布。
