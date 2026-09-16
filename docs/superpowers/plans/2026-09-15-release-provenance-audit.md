# Release provenance 审计记录

**日期：2026-09-15**

**状态：只读审计完成；实现和正式发布仍受人工决策闸门约束。**

**关联计划：**
- [8 小时安全无人值守并行开发目标](2026-09-15-eight-hour-unattended-development-goal.md)
- [v0.1.0 Release Candidate 清单](../../release-candidate-checklist-v0.1.0.md)

> 本记录只基于当前本地工作区的 workflow、package metadata、contract tests 和 Git 状态。
> 没有执行 `git push`、tag、GitHub Release、部署、联网发布或凭据操作。

## 一、当前已经成立的发布边界

本地静态检查确认：

- `.github/workflows/release.yml` 仅对 `v*` tag push 和 `workflow_dispatch` 触发；
- publish job 进一步要求真实 `push` 事件和 `refs/tags/`，manual dispatch 不发布；
- workflow 默认权限为 `contents: read`，只有 publish job 声明 `contents: write`；
- build/release checkout 均设置 `persist-credentials: false`；
- publish 前验证 tag commit 等于 `GITHUB_SHA`；
- publish 前精确验证四个平台 archive、checksum、checksum 内容和额外文件；
- `gh release create` 使用 `--verify-tag`；
- release workflow contract 当前为 **6/6**，没有执行真实发布。

当前 package metadata 中，根 package、CLI 和 executor 均为版本 `0.1.0`；这只是事实记录，
不自动等于已经获得创建 `v0.1.0` tag 的授权。

## 二、仍需维护者决定的事项

### 1. 正式 tag 版本策略

当前 workflow 的 `v*` 过滤器没有独立执行 SemVer、项目版本一致性或 tag 来源策略。需要
维护者明确：

- 是否只允许 `vMAJOR.MINOR.PATCH`；
- tag 是否必须等于根 package version；
- 是否允许 hotfix、preview 或其他 tag 命名；
- tag commit 是否必须来自 `main` 的已通过 CI commit。

在策略未确认前，不擅自把这些规则硬编码到发布 workflow，避免把维护者未决定的策略
伪装成实现细节。

### 2. required CI checks

当前 release job 依赖 build matrix 成功，但 release workflow 本身没有查询目标 commit 的
required status checks。维护者需要决定依赖：

- GitHub branch/tag ruleset 的 required checks；还是
- 在 release workflow 增加独立的 verification job；还是
- 两者同时使用。

此项属于发布授权策略，不在本地无人值守窗口内猜测实现。

### 3. GitHub Actions 不可变引用

当前 workflow 使用仓库既有的 major/tag 引用。若要求供应链不可变性，应由维护者按更新
流程核验每个 action 的准确 commit SHA，再一次性修改并更新 contract；本轮不猜测 SHA。

### 4. RC readiness 与实际发布物

当前证明的是 **release-candidate readiness audit**：构建、打包、checksum 和权限边界
可复核；当前没有 `v0.1.0` tag、GitHub Release 或公开 release asset。文档和命令示例
必须保持这两个概念分开。

## 三、风险等级与处理决定

| 事项 | 当前状态 | 本轮处理 |
| --- | --- | --- |
| manual dispatch 误发布 | 已有 fail-closed contract | 保持并回归 |
| publish 权限过宽 | 已按 job 分层 | 保持并回归 |
| tag 被删除/移动后发布错误 commit | 已有 tag SHA 与 `--verify-tag` 检查 | 保持并回归 |
| artifact 被额外文件污染 | 已有精确 allowlist/checksum | 保持并回归 |
| `v*` 过宽 | 策略未定 | 记录为人工决策，不猜测 |
| action ref 可变 | 需维护者确认 SHA | 记录 follow-up，不猜测 |
| required checks 未在 workflow 内验证 | 需维护者选择治理方案 | 记录 follow-up，不重复执行全部 gate |
| 进程树清理 | 跨平台 proof gap | 保持 Preserve，另立实现计划 |

## 四、可复现证据

本地已运行：

```bash
node --test tests/release-workflow.test.mjs tests/ci-workflow.test.mjs
node --test tests/documentation-contract.test.mjs
git diff --check
git tag --list 'v*'
```

当前证据：

- release workflow contract：**6/6**；
- CI workflow contract：**1/1**；
- documentation contract：**6/6**；
- `git diff --check`：通过；
- 本地 `v*` tag：无；
- 本次没有执行发布或远程写入。

## 五、下一步

在维护者确认版本/tag、required checks、action SHA 和发布责任前，继续只做本地代码、
测试、文档和 proof-gap 工作。正式 release 仍保持：

```text
NO-GO for publish
```
