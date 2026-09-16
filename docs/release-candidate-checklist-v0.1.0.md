# dev-agent v0.1.0 Release Candidate Checklist

**建立日期：2026-09-15**

**当前状态：npm package publish complete；GO for merge preparation；NO-GO for formal GitHub release**

这份清单用于把当前工作区整理成可合并的 Release Candidate 基线。npm 包
`@agent_cli/cli@0.1.0` 已在 2026-09-15 经明确授权发布；本清单仍不等同于正式
GitHub release 授权：没有单独授权，不创建 `v0.1.0` tag、不 push、不创建 GitHub Release，
也不上传 release artifact。

## 1. 固定不变量

- [x] provider、tool、approval、validation、MCP stdio 和 session schema 不变。
- [x] rich presentation 只在真实 stdin/stdout TTY 且不是 `--json`、`--once`、
  `--mcp-server` 时启用。
- [x] pipe、CI、JSON 和 `--once` 保持稳定的行式/机器可读输出。
- [x] 人类可读输出会清理模型和工具文本中的终端控制序列，并对明显的 credential-shaped
  值做 `[redacted]` 处理；`--json` 保留原始模型内容并只通过 JSON 转义输出。
- [x] release workflow 默认只有 `contents: read`；publish job 单独声明
  `contents: write`，并关闭 checkout credential persistence。
- [x] release workflow 仍只允许真实 tag push 进入 publish job；publish 前会校验 tag
  commit、四个平台 artifact 数量和 checksum，GitHub CLI 使用 `--verify-tag`。
- [x] npm 包 `@agent_cli/cli@0.1.0` 已发布。
- [x] 没有创建 tag、GitHub Release 或 release asset。

## 2. 本地代码与测试证据

| 检查 | 当前证据 | 状态 |
| --- | --- | --- |
| 结构检查 | `pnpm check`；13 个目录、34 个预期文件 | 已通过 |
| CLI 全量测试 | `pnpm --filter @agent_cli/cli test`；159/159 | 已通过 |
| 机器输出回归 | `apps/cli/tests/machine-output.test.ts`；5/5 | 已通过 |
| JSON 输出契约 | `apps/cli/tests/json-output.test.ts`；7/7 | 已通过 |
| Provider error-body boundary | `packages/model/tests/retry.test.ts`；2/2（脱敏、长度上限） | 已通过 |
| Rich TTY / PTY | `interactive.test.ts`；rich TTY 2/2，相关交互无 skip | 已通过 |
| Rust 固定 gate | `pnpm verify:rust`；库 43/43、二进制 3/3、doc 0 | 已通过 |
| Rust real integration | `pnpm verify:integration`；10/10 | 已通过 |
| TypeScript 固定 gate | `pnpm verify:typescript`；所有固定步骤通过 | 已通过 |
| release-gate contract | `tests/release-gate.test.mjs`；15/15，默认 step timeout 30 分钟、kill grace 5 秒 | 已通过 |
| release workflow contract | `tests/release-workflow.test.mjs`；6/6 | 已通过 |
| CI workflow contract | `tests/ci-workflow.test.mjs`；1/1 | 已通过 |
| documentation contract | `tests/documentation-contract.test.mjs`；7/7 | 已通过 |
| 手工 CLI smoke | `pnpm cli`，验证 `:model`、`:help`、`:clear`、`:quit` | 已通过 |
| diff whitespace | `git diff --check` | 已通过 |

## 3. 机器输出边界

`apps/cli/tests/machine-output.test.ts` 固定覆盖以下边界：

- pipe 交互 + `--no-stream`：不出现 rich 欢迎屏、`Thinking…` 或控制序列；
- `--once --no-stream`：最终人类文本经过终端控制清理；
- `--once` 流式 tool 输出：保持行式输出、无 ANSI，并对明显凭据做 `[redacted]`；
- `--once --json`：stdout 是单一可解析 JSON 值，原始模型控制字符只以 JSON 转义存在，
  不混入欢迎屏或 `Thinking…`；
- 人类模式的 `[runtime]` 行会清理配置中的 provider/model 文本，不允许控制序列污染终端；
- `--index`、`--session-list`、`--metadata` 的人类可读路径，以及通用 CLI 参数错误，都会
  清理不可信路径/参数中的终端控制序列；JSON 错误文档仍保持可解析。
- `--tools` 对 MCP 服务器前缀和工具描述也经过同一清理，避免远端工具元数据直接注入终端。
- `--metadata` 还会清理从持久化 session 读取的 session id、时间字段和 evidence reason。
- evidence export/cleanup 以及交互式 `:cleanup`、`:validate` 的人类错误路径也通过同一
  terminal-safe 出口；JSON 错误仍保留结构化内容。
- `--json` 参数校验、provider 启动失败和 agent run 失败（包括 `status: "error"` 结果与
  未产生结果前抛出的异常）：stdout 是单一 `{ "error": "..." }` 文档，退出状态为 `1`，
  stderr 保持为空；
- evidence preview/export 的选项错误仍只写 stderr，避免污染可重定向的 JSON artifact；
- provider 错误响应在进入 memory、CLI JSON 或 Desktop 错误事件前会脱敏明显凭据并限制
  body 长度；成功模型内容的 JSON 语义不变；
- `--mcp-server`：既有 `mcp-server.test.ts` 验证 stdio JSON-RPC framing、工具/资源/提示
  响应与日志通道边界。

缺少 `expect`/`pgrep` 的本地环境仍会让 rich PTY 场景显式 skip；Ubuntu CI 在运行
TypeScript gate 前显式安装 `expect` 和 `procps`，并由 `tests/ci-workflow.test.mjs`
锁定该顺序，避免 CI 把未执行误报为通过。

## 4. 发布工作流边界

- [x] `.github/workflows/release.yml` 的 publish job 要求 `push` 事件和 `refs/tags/*`。
- [x] manual dispatch 不进入 publish job。
- [x] 默认权限是 `contents: read`，只有 publish job 使用 `contents: write`。
- [x] build/release checkout 设置 `persist-credentials: false`。
- [x] publish 前校验当前 tag commit 等于 `GITHUB_SHA`，并精确检查四个平台 archive、
  checksum 和 checksum 内容；额外 artifact 会 fail closed。
- [x] `gh release create` 使用 `--verify-tag`，不会在远程 tag 缺失时隐式创建替代 tag。
- [x] 四个平台 release matrix、archive、README、executable bit 和 checksum 检查已有
  workflow contract 覆盖。
- [x] v64 的四平台 Release Candidate 审计记录在 `docs/day-plan-v64-progress.md`；该
  记录不等于本次发布授权。
- [ ] 若准备正式发布，先由维护者确认版本、tag 名称、发布说明和回滚责任人。

## 5. 当前决策

当前结论为 **npm package publish complete / NO-GO for formal GitHub release / GO for merge preparation**：

1. 本轮机器输出、终端安全、TUI、release gate、workflow 和文档 contract 已通过；
2. 合并前可以创建一次普通提交，但不创建 release tag；
3. 正式发布前仍需维护者确认 SemVer/tag 与项目版本策略、required CI checks、发布说明、
   回滚责任人，并决定是否将 GitHub Actions 引用固定到不可变 commit SHA；
4. npm 包发布已完成；只有在另行明确授权后，才进入 tag、hosted release build 和 GitHub Release。

## 6. 后续风险与非目标

以下事项已记录为后续独立工作，不阻塞本轮合并准备，但会阻塞正式发布授权：

- GitHub Actions 当前仍使用仓库约定的 major/tag 引用，尚未在本轮猜测或写入 commit SHA；
  后续应由维护者按供应链更新流程固定并维护。
- `v*` tag 过滤仍由仓库维护者和 protected tags/rulesets 共同约束；本轮没有擅自规定
  SemVer、`main` 祖先关系或 hotfix 规则。
- release gate 目前保证直接子进程的 timeout escalation；跨平台进程树清理需要独立设计，
  不在本轮投机实现。
- 本轮不执行 tag、push、hosted release build、签名/attestation 或 GitHub Release。

## 7. 最终执行顺序

```text
machine-output tests
  -> CLI/typecheck/documentation/release-workflow/CI contracts
  -> Rust + real integration gates
  -> diff review and git diff --check
  -> maintainer approval
  -> optional tag/release (not part of this task)
```
