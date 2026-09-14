# Day plan v64：发布前 Release Candidate 审计

**建立日期：2026-09-14**

**当前状态：已完成；已验证 release workflow，不创建 tag、不发布 GitHub Release。**

> v62 已经补齐 macOS 与 Linux 的 hosted sandbox live evidence；v64 不再扩大 runtime、
> protobuf、公开 schema 或平台支持范围，而是把正式发布前最容易被误读的 release 边界
> 变成可复核的检查清单。四个平台的构建、打包和 checksum 必须由同一次
> `workflow_dispatch` 产生证据；手动运行只能验证构建，不能进入发布 job。

## Goal

在真正创建版本 tag 之前，建立并执行一份可复核的 release candidate 审计：

- 确认 release matrix 仍然只有四个已支持 target；
- 让每个 target 的 archive、checksum、可执行文件权限和 README 在上传前被 workflow 自己检查；
- 确认 artifact 名称与 target 一致；
- 确认 manual dispatch 即使选择 tag-shaped ref 也不会创建 GitHub Release；
- 保存 hosted run、四个平台 artifact 和 publish job skipped 的证据，但不正式发布。

## Scope

### Included

- `.github/workflows/release.yml` 的四 target matrix、package verification 和 publish boundary；
- `tests/release-workflow.test.mjs` 的 RED-to-GREEN static contract；
- 本地 fixed TypeScript/release/documentation gate；
- GitHub Actions `workflow_dispatch` 的真实 hosted build；
- `docs/day-plan-v64-progress.md` 和 `docs/CHANGELOG.md` 的证据记录。

### Explicitly excluded

- 不创建或推送 `v*` tag；
- 不调用 `gh release create`，不创建 GitHub Release；
- 不修改 target matrix 以外的平台支持，不加入 Windows target；
- 不在每次普通 fixed gate 中构建 release archive；
- 不引入签名系统、安装器、发布服务或回滚流程；这些留到真正的发布需求。

## Task 0：baseline inventory

- [x] 盘点当前 workflow 的四个 target、runner、交叉编译边界和 artifact 命名。
- [x] 确认现有 workflow 已提供 `workflow_dispatch`，但 publish 条件需要同时约束事件类型和 tag ref。
- [x] 记录 release job 的权限边界：只有 tag push 才允许进入 publish job。

## Task 1：RED contract

- [x] 为“manual dispatch 永不发布”加入失败优先的静态 contract。
- [x] 为 archive 内容、checksum、binary executable bit 和 README 加入失败优先的静态 contract。
- [x] 保留四 target matrix 与 artifact naming 的既有 contract，不以单 target smoke 代替四平台证明。

## Task 2：最小 workflow hardening

- [x] 将 publish 条件收紧为 `push` 事件且 ref 以 `refs/tags/` 开头；手动运行即使选中 tag ref 也只能完成 build。
- [x] 在上传 artifact 前检查 binary 可执行、README 存在、archive 内容完整和 checksum 可验证。
- [x] 不改变正式 tag push 的 release authority，不改变 archive 文件名和 target matrix。

## Task 3：四平台 hosted validation

- [x] 将当前 commit 推送到远端后，通过 `workflow_dispatch` 运行 Release workflow。
- [x] 四个 build jobs 全部成功：
  - [x] `aarch64-apple-darwin`
  - [x] `x86_64-apple-darwin`
  - [x] `x86_64-unknown-linux-gnu`
  - [x] `aarch64-unknown-linux-gnu`
- [x] 下载并逐一检查四组 `.tar.gz` 与 `.sha256`，确认 artifact 名称包含对应 target。
- [x] 确认 release/publish job 为 `skipped`，且远端没有新增 GitHub Release。

## Task 4：审计记录与决策

- [x] 把 hosted run URL、commit SHA、job 状态、artifact 名称和 release skipped 结果写入 progress。
- [x] 更新 CHANGELOG 与文档导航，确保审计文档成为当前 source of truth。
- [x] 运行本地 fixed gate、workflow YAML parse、documentation contract、`git diff --check`。
- [x] 明确结论为“可进入正式发布准备”或记录阻塞项；本计划本身不授权正式发布。

## Acceptance checklist

- [x] 静态 release-workflow contract 全部通过。
- [x] 四个平台 build job 同一次 hosted `workflow_dispatch` 全部成功。
- [x] 每个 archive 的 binary、README、executable bit 和 checksum 都有 workflow 检查并通过。
- [x] 四个 artifact 名称与 target 一致，未混入 Windows 或其他未审计 target。
- [x] manual dispatch 的 publish job 明确 skipped；没有 tag、GitHub Release 或 release asset 被创建。
- [x] README、docs index、CHANGELOG、day-plan/progress 的边界一致。

## Decision boundary

四平台 build 与 package verification 均已通过，结论为 **Release Candidate readiness
evidence available / formal release still deferred**。真正的 tag、签名、发布说明和回滚演练
仍需要另一个明确授权的发布步骤；本次审计没有创建 tag 或 GitHub Release。
