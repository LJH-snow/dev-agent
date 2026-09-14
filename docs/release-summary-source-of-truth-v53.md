# Release summary source-of-truth decision（v53）

**日期：2026-09-14**

## Scope

本 decision 只处理 evergreen release summary 的测试计数漂移，不改变 runtime、测试 runner、
fixed release gate、公开 report、Evidence v1 或任何 session/Undo authority。

## Inventory

| Surface | 当前验证来源 | 当前结果 | 稳定性判断 |
| --- | --- | ---: | --- |
| TypeScript workspace | fixed gate 的 `pnpm test`；八个 package 各自执行 `node --test` | 614/614 | 结果权威，但总数会随测试增删变化 |
| Preview contract | `tests/evidence-preview-benchmark.test.mjs` + `tests/evidence-preview-parity.test.mjs` | 8/8 | 独立 contract suite，计数仍会变化 |
| Release-gate contract | `tests/release-gate.test.mjs` | 11/11 | gate 结构 contract，计数仍会变化 |
| Rust unit/doc | `cargo test` | 43 + 3 + 0 = 46/46 | cargo 输出权威，计数随 Rust tests 变化 |
| Real integration | `@dev-agent/executor` `test:integration` | 10/10 | 独立真实二进制 suite，计数随场景变化 |

TypeScript workspace 的当前 package breakdown 为：model 54、code-intelligence 30、MCP 49、
executor 48、agent-core 118、tools 121、Desktop 76、CLI 118，合计 614。

## Drift evidence

- 旧 README 写的是 543 TypeScript tests。
- v52 初始文档修正写成了 612，依据是当时已有的 gate 记录。
- v53 fresh `pnpm test` 逐 package 读取 Node test summary，得到 614；fresh `pnpm verify` 也
  全部通过。因此 612 仍不足以作为当前 evergreen 数字。
- 历史 day-plan/changelog 的计数是日期化验证记录，不是当前 README 的 source-of-truth。

## Report and security boundary

`scripts/release-gate.mjs` 的 `--report` 仍只产生 metadata-only 结果：schema version、生成时间、
选中的 modes、整体 status、失败 step（如有）以及每个 step 的 id/status/timing/exit code。
当前 release-gate contract 明确固定该 allowlist；它不包含测试 stdout、命令、args、cwd、环境值、
路径、文件 bytes 或 test count。

直接解析 `pnpm`/Node/cargo stdout 可能受并发、skip/todo、动态 tests、workspace 包边界、Node/cargo
版本和 reporter 格式影响；静态扫描 `test()` 只能得到近似值；为了生成计数再包一层完整 gate 会
重复执行测试并改变 fail-fast/副作用边界。对本轮文档维护来说，这些风险超过收益。

## Decision

**Preserve / NO-GO for automatic public test-count generation.**

采取更小的稳定化措施：当前 `README.md` 只描述 fixed release gate 覆盖的 suite 类别，不再
写会漂移的 hardcoded totals；精确计数只写入带日期的 validation/progress/decision 文档，并以
fresh gate evidence 为依据。

## Reconsideration trigger

只有出现以下任一情况，才在 v54 或之后重新评估自动化：

- CI、仪表板或发布工具明确需要机器可读的测试计数；
- 维护者再次报告同一类当前文档漂移，即使 README 已去除总数；
- 有明确的 reporter/contract 方案，能在不泄露 stdout/命令/环境、不重复运行 gate、且不扩展
  现有公开 report allowlist 的情况下提供计数。
