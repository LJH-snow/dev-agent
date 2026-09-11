# dev-agent 开发计划 v17：测试迁移到 TypeScript

> 目标：把 73 个 `.mjs` 测试逐步迁成 `.test.ts`：每个包/应用用自带的
> `tsconfig.test.json` 编译到同级的 `tests-dist/`，再交给 `node --test` 运行。
> 不引入新的运行时依赖，迁移期间保持测试全绿。完成后测试本身就是 TypeScript，
> `.gitattributes` 里「tests 不计入语言统计」的规则就可以撤掉。

当前基线（v16 + 语言统计调整后）：

- TypeScript 407 个测试 + Rust 46 个 + 真实二进制集成 10 个，全部通过
- GitHub 语言条：TypeScript 74.4% / Rust 20.4% / HTML 4.5% / JavaScript 0%
  （tests 与 scripts 目前被 `linguist-detectable=false` 排除）
- 每个包/应用的 test 脚本都是 `tsc -p tsconfig.json && node --test tests/*.test.mjs`
- 3 个 `.mjs` fixture：`packages/mcp/tests/fake-mcp-server.mjs`、
  `flaky-mcp-server.mjs`、`packages/executor/tests/mock-executor-binary.mjs`

## 迁移管线（阶段 0 建立，后续阶段复用）

1. 每个包/应用新增 `tsconfig.test.json`：
   - 继承 `configs/tsconfig.base.json`；`rootDir: "tests"`、`outDir: "tests-dist"`
   - `declaration: false`、`declarationMap: false`、`sourceMap: false`
   - `strict: false`、`noUncheckedIndexedAccess: false`（测试代码放宽，不牵动源码）
   - `include: ["tests/**/*.ts"]`
2. `package.json`：
   - `test` 改为 `tsc -p tsconfig.test.json && node --test tests-dist/*.test.js`
   - `test:integration` 同理改用 `tests-dist/real-rust-integration.test.js`
   - `clean` 追加 `tests-dist`
3. 根 `.gitignore` 增加 `tests-dist/`。
4. 测试文件 `tests/*.test.mjs` -> `tests/*.test.ts`；相对导入
   `../dist/index.js` 在编译后仍指向包自己的 `dist`，不需要改。
5. fixture 保持 `.mjs`（独立子进程脚本）：测试里的路径从
   `./fixture.mjs` 改成 `../tests/fixture.mjs`（编译产物在 `tests-dist/`）。

## 阶段 0：管线 + `packages/model` 试点（~1 小时）

**任务**：建立上面的管线，先把 `packages/model` 的 5 个测试迁完。

**验收**：

- `packages/model` 54 个测试全绿；`tests/` 下不再有 `.test.mjs`
- `pnpm build` / `pnpm typecheck` / `pnpm test` 全绿（其余包此时仍是 `.mjs`）

## 阶段 1：`packages/agent-core` + `packages/tools` + `packages/code-intelligence`（~1.5 小时）

**任务**：三个包套用同一管线并改名；按需修类型错误（model stub 的
`id: "openai"` 之类需要 `as const`）。

**验收**：三个包的测试全绿，总计仍是 407（不含 Rust/集成），无 `.test.mjs` 残留。

## 阶段 2：`packages/mcp` + `packages/executor`（~1.5 小时）

**任务**：迁移含 fixture 的两个包；修正 fixture 路径；`test:integration`
改为运行编译后的集成测试。

**验收**：mcp 33 + executor 单测/集成全绿；fixture 仍以子进程方式工作。

## 阶段 3：`apps/cli` + `apps/desktop`（~1.5 小时）

**任务**：迁移两个应用的 18 + 6 个测试（它们 spawn `dist/index.js`）。

**验收**：全部应用测试全绿；`tests-dist/` 已被 git 忽略。

## 阶段 4：文档、语言统计与全量回归（~1 小时）

1. 更新根 `README.md`（测试管线说明 + Current Status / Roadmap）
2. 更新 `docs/architecture.md` 与各包 README 中「测试用 `node --test` 跑
   `.mjs`」的描述
3. 更新 `docs/CHANGELOG.md`
4. `.gitattributes`：移除 `apps/*/tests/**` 与 `packages/*/tests/**` 两条
   （测试已是 TypeScript），保留 `scripts/**`
5. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、
   `pnpm test`、`pnpm --filter @dev-agent/executor test:integration`、
   `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、`cargo test`
6. 用 `gh api repos/LJH-snow/dev-agent/languages` 复核语言占比
7. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v17-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 不引入新的运行时依赖；迁移期间每个阶段结束时 `pnpm test` 必须全绿；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1 > 阶段 2 > 阶段 3 > 阶段 4
