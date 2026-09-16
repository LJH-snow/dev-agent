# 8 小时开发目标进度记录

**对应计划：** [8 小时安全的无人值守并行开发闭环](2026-09-15-eight-hour-unattended-development-goal.md)

**开始记录：2026-09-15 13:28（Asia/Shanghai）**

**当前状态：已完成（核心验收提前满足）；保持 no-tag/no-push/no-release。**

## 当前阶段

### 0:00–0:30：基线冻结 — 已完成

- 已检查当前分支、工作区状态和现有计划文档。
- 当前工作区仍包含上一轮 RC/TUI 变更，未将其误判为干净基线。
- 已确认没有本地 `v*` tag；本轮没有执行发布、部署或外部写入。
- 已明确当前仓库最多并行 3 个子代理，并优先使用只读审计代理。

### 集成工作：文档 source-of-truth — 已完成

已完成：

- 新建 8 小时开发目标计划；
- 将计划链接加入根 README 和 `docs/README.md`；
- 将 `docs/next-roadmap-plans-v62-plus.md` 中过时的 v62“推荐下一步”改为已完成；
- 将当前推荐切换到 8 小时计划；
- 将 v63 day plan 中已经完成的 Task 4 勾选并修正文案；
- 为上述状态增加 documentation contract；
- 补充 release provenance 审计记录，区分 readiness audit 与 formal release。

验证：

- `node --test tests/documentation-contract.test.mjs`：**7/7 通过**；
- `node --test tests/release-workflow.test.mjs tests/ci-workflow.test.mjs`：**7/7 通过**；
- `git diff --check`：通过；
- 计划、进度和审计文档无尾随空格，关键章节和人工闸门存在。

## 轨道结果

### Track A：Release provenance 与发布前置条件 — 只读审计完成

已完成本地 workflow/package metadata 审计，记录在
`docs/superpowers/plans/2026-09-15-release-provenance-audit.md`。当前明确的剩余问题是
SemVer/tag 策略、required checks 治理和 action immutable SHA；这些需要维护者决定，
本轮不猜测、不执行发布。

### Track B：Executor cancellation 与进程树证据 — 只读审计完成

审计记录在 `docs/superpowers/plans/2026-09-15-cancellation-boundary-audit.md`。当前
Rust Unix runtime 已有 process-group 终止意图；Node fixed gate 的完整跨平台进程树
清理仍未证明，因此保持 Preserve，不做投机性 process-group 重构。

### Track C：CLI/Desktop operator observability — CLI machine-error slice 已完成

只在明确的文件 allowlist 和 TDD contract 下进行，不能改变 provider、tool、approval、
session schema 或执行权限语义。本轮先完成 CLI machine-error 边界：

- `--json` 的参数校验、provider 启动失败和 agent run 失败现在输出单个
  `{ "error": "..." }` 文档到 stdout，并以状态码 `1` 退出；这同时覆盖 AgentLoop
  返回 `status: "error"` 和在产生结果前抛出的异常，人类可读路径仍写 stderr。
- session rename 冲突/缺失和无效 compact 参数接入同一边界；evidence preview/export
  保持 stderr 错误，以免污染可重定向的 JSON artifact。
- 已增加 JSON error、CLI 参数、session rename 和 evidence preview/export 边界回归测试；
  没有改变成功 JSON、provider 协议、工具执行、审批、验证或 session schema。

已验证：

- `node --test --test-name-pattern='next flag' apps/cli/tests-dist/cli-args.test.js`：**1/1**；
- `node --test --test-name-pattern='refuses to overwrite' apps/cli/tests-dist/session-rename.test.js`：**1/1**；
- `node --test --test-name-pattern='startup fails' apps/cli/tests-dist/json-output.test.js`：**1/1**；
- `node --test --test-name-pattern='provider run error' apps/cli/tests-dist/json-output.test.js`：**1/1**；
- `node --test --test-name-pattern='JSON evidence option errors' apps/cli/tests-dist/validation.test.js`：**1/1**；
- `pnpm --filter @dev-agent/cli test`：**159/159**；
- `pnpm verify:typescript`：全部选定 gate 通过（workspace build/typecheck、CLI **159/159**、
  preview **8/8**、release gate **15/15**、release workflow **6/6**、CI workflow **1/1**、
  documentation **7/7**）；
- CLI build/typecheck 编译步骤通过，`git diff --check` 通过。

随后补充 provider 错误响应 hardening：模型层在生成 `ModelRequestError` 前会脱敏明显的
credential-shaped 字段并限制响应 body 长度，避免错误响应原样进入 agent memory、CLI JSON
或 Desktop 错误事件。新增模型层回归测试覆盖凭据脱敏和 10,000 字符 body 的上限；CLI
新增 `--once` 人类模式 provider 失败退出码回归测试。

补充验证：

- `packages/model/tests/retry.test.ts` 的 provider error body 测试：**2/2**；
- `--once human mode returns a non-zero`：**1/1**；
- 最新 `pnpm verify:typescript`：全部选定 gate 通过，CLI **159/159**、documentation **7/7**。

随后补充运行状态输出 hardening：人类可读模式的 `[runtime]` 行现在也会清理不可信的
provider/model 文本，新增 machine-output 回归测试覆盖带 ANSI 控制序列的配置模型名。
这不会改变 JSON 成功内容，也不会改变 provider 解析或请求协议。

随后继续完成 CLI 人类可读边界收口：`--index`、`--session-list` 和无效 memory 文件错误会
清理配置路径中的终端控制序列，通用参数错误也通过同一安全出口；`--tools` 同时清理
MCP 服务器前缀和工具描述，`--metadata` 还清理持久化的 session id、时间字段和 evidence
reason；evidence export/cleanup 和交互式 `:cleanup`、`:validate` 的人类错误路径也统一
经过 terminal-safe 出口。对应新增 6 个回归测试，覆盖索引路径、session 目录、memory 路径、
不可信参数文本、MCP 元数据和持久化 metadata。CLI 全量测试更新为 **159/159**。

Desktop observability 暂不做投机性 UI 扩展；Rust 与 real integration 已在受控环境通过。
Track C 的 machine-error slice 已具备完整 TypeScript 证据，并已同步到 Release Candidate
checklist。

## 当前工作区复核（2026-09-15）

在继续完成 MCP 工具元数据输出清理和 README 路线图收口后，使用当前工作区重新执行固定
gate，避免把历史结果当作现状证据：

- `pnpm verify`：TypeScript、Rust 和 real-Rust integration 三个阶段按固定顺序全部通过；
- `pnpm verify:typescript`：全部选定 gate 通过，CLI **159/159**、preview **8/8**、
  release gate **15/15**、release workflow **6/6**、CI workflow **1/1**、documentation
  **7/7**；
- `pnpm verify:rust`：Rust 库 **43/43**、二进制 **3/3**、doc **0**，无失败；
- `pnpm verify:integration`：real-Rust integration **10/10**，无 skipped；
- `node --test tests/documentation-contract.test.mjs`：**7/7**；`git diff --check`：通过；
- CLI smoke：`node apps/cli/dist/index.js --version` 返回 `dev-agent 0.1.0`，
  `--tools` 正常列出内置工具。

这些复核只证明当前工作区满足 merge-preparation gate，不构成 commit、tag、push 或正式
GitHub Release 授权。

## Rust 与 real integration 验证

- 直接在当前受限 shell 运行 `pnpm verify:rust` 时，Rust sandbox 相关测试出现 **36 passed / 7 failed**，
  失败均为 macOS `sandbox-exec` 返回退出码 `71`；同一环境的直接 probe 也返回
  `sandbox_apply: Operation not permitted`。这证明是外层执行沙箱能力限制，而不是先行修改
  runtime 的理由。
- 在允许本地 sandbox backend 的受控验证环境中重新运行 `pnpm verify:rust`：Rust unit/doc
  **43/43 + binary 3/3 + doc 0**，全部通过。
- 在同一受控环境运行 `pnpm verify:integration`：real-Rust integration **10/10**，覆盖
  Starlark policy、只读/可写路径、网络禁用/loopback、timeout、resource limit、output
  truncation、cancel 和 concurrency，全部通过。
- 没有修改 Rust 代码，也没有改变 sandbox、取消、权限或发布边界。

## Release Candidate checklist 收口

- 发现 checklist 中 CLI 全量测试和 documentation contract 的历史计数分别仍为 **146/146**
  和 **2/2**；先用 documentation contract 固化当前计数要求，再将清单更新为 CLI **159/159**
  和 documentation **7/7**。
- Checklist 的机器输出边界补充了 `--json` 参数校验、provider 启动失败和 agent run 失败的
  单 JSON error 文档要求，并明确 `status: "error"` 与异常抛出两条路径。
- Checklist 新增 JSON 输出契约行：`apps/cli/tests/json-output.test.ts` **7/7**；并补充
  `status: "error"` run 失败、human `--once` 非零退出码和 evidence preview/export stderr 边界。
- Checklist 增加 provider error-body boundary 行：`packages/model/tests/retry.test.ts` **2/2**，
  覆盖 credential-shaped 字段脱敏和诊断 body 长度上限。
- `node --test tests/documentation-contract.test.mjs`：**7/7**；`git diff --check`：通过。

## 时间盒收口

核心验收在 8 小时窗口结束前已满足，因此没有为了填满时间盒而扩大功能范围；剩余时间用于
回归、文档同步和人工闸门核对。

| 时间盒 | 状态 | 结果 |
| --- | --- | --- |
| 0:00–0:30 | 已完成 | 基线、分支、未提交范围和 no-tag/no-push/no-release 边界已冻结 |
| 0:30–2:30 | 已完成 | Track A/B 只读审计、Track C 机器输出轨道完成并记录 proof gap |
| 2:30–5:30 | 已完成 | CLI JSON error contract 与两项 P1 边界修复完成，均有回归测试 |
| 5:30–6:45 | 已完成 | checklist、README、CLI 文档和 progress source-of-truth 已同步 |
| 6:45–7:45 | 已完成 | TypeScript、Rust、real integration、workflow、preview、documentation gates 通过 |
| 7:45–8:00 | 已完成 | 交接摘要和人工决策清单完成；正式发布仍为 NO-GO |

## 当前人工闸门

以下操作仍必须等待维护者明确授权：

- `git commit`、`git push`、创建/移动 tag；
- GitHub Release、release asset、部署或外部 SaaS 写入；
- 修改仓库/组织权限或引入发布凭据；
- 删除、强制覆盖或恢复不属于当前轨道的文件。

## 下一步

本计划的开发窗口已收口。后续只剩维护者决策：确认版本/tag 策略、required CI checks、
GitHub Actions immutable SHA、发布说明与回滚责任人；在这些决策和明确授权之前，不修改发布
策略、不创建 tag、不 push、不创建 GitHub Release，也不写入外部 SaaS。
