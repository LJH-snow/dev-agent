# day-plan v17 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v17.md`；结束前追加日志。

## 当前状态

- 当前阶段：阶段 1（`agent-core` + `tools` + `code-intelligence`）未开始
- 已完成阶段：阶段 0
- 最近一次运行：运行 1（2026-09-12 03:4x-04:0x）
- 工作区：阶段 0 的改动待提交

## 日志

### 运行 1 — 2026-09-12 03:4x-04:0x

- 阶段/工作项：阶段 0（测试管线 + `packages/model` 试点）完成
- 做了什么：
  - 新增 `packages/model/tsconfig.test.json`：继承基础配置，
    `rootDir: tests` / `outDir: tests-dist`、关闭 declaration/sourceMap、
    `strict: false`、`noUncheckedIndexedAccess: false`
  - `packages/model/package.json`：`test` 改为
    `tsc -p tsconfig.test.json && node --test tests-dist/*.test.js`；
    `clean` 追加 `tests-dist`
  - 根 `.gitignore` 增加 `tests-dist/`（实测 `git check-ignore` 命中）
  - 5 个测试 `*.test.mjs` -> `*.test.ts`（git mv 保留历史），
    修掉 8 个类型错误：故意畸形的价格表用 `as unknown as` 转型、
    `ToolCall.input`（unknown）取值处加窄化、`fetch` 回调里的
    `url`/`init.body` 用 `String(...)` 归一化
- 验证命令与结果：
  - `packages/model`（新管线）：54 passed
  - `node scripts/check.mjs`：Structure check passed
  - `pnpm build` / `pnpm typecheck`：通过
  - `pnpm test`：全绿（407 个测试；其余包此时仍是 `.mjs`，混合期通过）
  - `git ls-files 'packages/model/tests/*.mjs'` = 0
- 提交：见阶段 0 的 test 提交
- 下一步：阶段 1 — 把同一管线套到 `packages/agent-core`、`packages/tools`、
  `packages/code-intelligence`

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | - |
