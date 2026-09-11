# day-plan v17 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v17.md`；结束前追加日志。

## 当前状态

- 当前阶段：阶段 3（`apps/cli` + `apps/desktop`）未开始
- 已完成阶段：阶段 0、阶段 1、阶段 2
- 最近一次运行：运行 3（2026-09-12 04:3x-05:0x）
- 工作区：阶段 2 的改动待提交

## 日志

### 运行 3 — 2026-09-12 04:3x-05:0x

- 阶段/工作项：阶段 2（`mcp` + `executor`，含 fixture）完成
- 做了什么：
  - 两个包新增 `tsconfig.test.json`；mcp 的 `test` 改为编译后跑
    `tests-dist/*.test.js`；executor 的 `test` / `test:integration` 改成
    指向 `tests-dist/` 下的对应文件（单元与集成仍分离）
  - 10 + 9 个测试文件改为 `.test.ts`；3 个 `.mjs` fixture 保持原样
  - fixture 路径修正：mcp 测试引用改为 `../tests/fake-mcp-server.mjs` /
    `../tests/flaky-mcp-server.mjs`；executor 的 `mockBinary` 改为
    `join(here, "..", "tests", "mock-executor-binary.mjs")`
  - 类型修复：`sendAndReceive` 返回 `Promise<any>` 且 behavior 有默认值、
    mock 二进制解码结果对象标 `any`、`Object.entries` 的 env 标
    `Record<string, string>`、`(error as Error).message`、
    `(client as any).request(...)`（测试访问私有方法）
- 验证命令与结果：
  - 两个包 `tsc -p tsconfig.test.json`：0 error
  - `packages/mcp`：33 passed；`packages/executor`（单元）：40 passed；
    `test:integration`：10 passed（真实 Rust 二进制）
  - `pnpm test`：全绿（407 个测试）
  - 两个包 tests 下已无 `.test.mjs`
- 提交：见阶段 2 的 test 提交
- 下一步：阶段 3 — `apps/cli`（18 个）与 `apps/desktop`（6 个）迁移

### 运行 2 — 2026-09-12 04:0x-04:3x

- 阶段/工作项：阶段 1（`agent-core` + `tools` + `code-intelligence`）完成
- 做了什么：
  - 三个包新增 `tsconfig.test.json`，`test` 脚本切到
    `tsc -p tsconfig.test.json && node --test tests-dist/*.test.js`，
    `clean` 追加 `tests-dist`
  - 11 + 6 + 6 个测试文件改为 `.test.ts`（git mv 保留历史）
  - 类型修复：24 处 model stub `id: "openai" as const`；69 处工具构造加
    `: any`（`Tool.execute` 返回 `unknown`，测试按 JS 习惯读结果字段）；
    approval 测试的 `decide` 辅助函数与 `runOnce` 参数补类型；
    4 处工具入参按 `{ name/path/a/b }` 窄化
- 验证命令与结果：
  - 三个包 `tsc -p tsconfig.test.json`：0 error
  - `packages/agent-core`：62 passed；`packages/tools`：70 passed；
    `packages/code-intelligence`：30 passed
  - `pnpm typecheck`：通过
  - `pnpm test`：全绿（407 个测试）
  - `git ls-files` 检查：三个包 tests 下已无 `.test.mjs`
- 提交：见阶段 1 的 test 提交
- 下一步：阶段 2 — `packages/mcp`（fake/flaky server fixture）与
  `packages/executor`（mock-executor-binary fixture、集成测试）

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
