# dev-agent 开发计划 v19

> 目标：`filesystem read` 的**行数统计对最常见的文件形态是错的**。实测
> `"one\ntwo\nthree\n"`（结尾有换行，也就是真实文件的常态）报告
> `totalLines: 4`，而它只有 3 行；`offset: 99` 时还会返回
> `startLine: 99, endLine: 98`，范围倒挂。模型靠 `totalLines` 决定下一页读哪里，
> 这个 off-by-one 会让它对文件长度的判断始终偏一行。

当前基线（v18 完成时已验证）：

- TypeScript 413 个测试 + Rust 46 个测试全部通过；真实二进制集成 10 个
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：修正 read 的行语义（~45 分钟）

**任务**：

1. 行拆分改为「结尾换行是终止符，不是新行」：
   - `""` -> 0 行；`"a\n"` -> 1 行；`"\n"` -> 1 行；`"a\nb"` -> 2 行；
     `"a\n\n"` -> 2 行（`a` 加一个空行）。
   - 等价性质：`lines.join("\n")` 能还原原文（最多差一个结尾换行）。
2. `offset` 超出文件时把报告的位置**收敛到文件内**：
   - 3 行文件 `offset: 99` -> `startLine: 4`、`endLine: 3`、
     `content: ""`、`totalLines: 3`（而不是倒挂的 99/98）。
3. 其余行为不变：`offset`/`limit` 仍须是正整数，`truncated` 语义不变。

**验收**：

- `packages/tools` 新增 >= 5 个用例：结尾换行的行数、无结尾换行的行数、
  只含一个换行的文件、空文件、越界 offset 的范围收敛
- 既有 `read returns a line range and marks truncation` 用例保持通过
- `pnpm test` 全绿

---

## 阶段 1：文档、全量回归与提交（~45 分钟）

1. 更新 `packages/tools/README.md`（写明行语义与越界行为）
2. 更新根 `README.md` 的 Current Status / Roadmap 与 `docs/CHANGELOG.md`
3. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
4. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v19-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1
