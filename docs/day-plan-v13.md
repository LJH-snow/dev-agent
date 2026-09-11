# dev-agent 开发计划 v13

> 目标：继续用「先复现、再修」的方式收口三处实测确认的缺陷——危险命令表对长选项
> 与短参数的漏检；Python 扫描器漏 `async def`；窄 `maxDepth` 的 `code-search`
> 会把索引里更深处的文件从磁盘上裁掉。

当前基线（v12 完成时已验证）：

- TypeScript 389 个测试 + Rust 46 个测试全部通过；真实二进制集成 10 个
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：补齐危险命令表的覆盖（~1 小时）

**证据**（2026-09-11 实测 `denyDangerousPolicy`）：

| 命令 | 现状 |
|------|------|
| `rm -rf /tmp/x` | DENY（正确） |
| `rm --recursive --force /tmp/x` | **ALLOW** |
| `git push --force origin main` | DENY（正确） |
| `git push --force-with-lease origin main` | DENY（正确） |
| `git push -f origin main` | **ALLOW** |
| `git push origin +main` | **ALLOW** |

**任务**：

1. 「recursive delete」模式同时识别短选项与长选项（`-r` / `-rf` / `-fr` /
   `--recursive`）；`rm --force file` 这类不带递归的调用保持放行。
2. 「force push」模式覆盖 `-f`、`--force`、`--force-with-lease`、
   `--force-if-includes` 与 `+refspec`；普通 `git push origin main` 保持放行。
3. `approval.allow` 白名单优先级不变，长选项写法也要能被白名单豁免。

**验收**：

- agent-core 新增 >= 5 个用例：三种新变体 DENY、`rm --force file` 与
  `git push origin main` 仍 ALLOW、白名单命中长选项写法后放行
- 既有 approval 用例保持全绿
- `pnpm test` 全绿

---

## 阶段 1：Python 扫描器支持 `async def`（~45 分钟）

**证据**（2026-09-11 实测 `scanFile`）：`async def fetch(url):` 与类内
`async def get(self):` 都产出 0 个符号，而普通 `def`、`class` 与同步方法正常。

**任务**：

1. 扫描器识别 `async def`（含带装饰器的行）；顶层 async 函数映射为
   `function`，类内 async 方法映射为 `method` 并带 `containerName`。
2. 不把 `await ...` 之类的行误判成声明。

**验收**：

- code-intelligence 新增 >= 3 个用例：顶层 async 函数、类内 async 方法、
  装饰器 + async 方法
- 既有 Python 扫描用例保持全绿
- `pnpm test` 全绿

---

## 阶段 2：`code-search` 不再裁剪扫描范围之外的索引条目（~1 小时）

**证据**（2026-09-11 实测）：索引同时包含 `shallow.ts` 与
`deep/nested/deep.ts`，用 `maxDepth: 1` 搜索后 `persisted: 1`，磁盘索引只剩
`shallow.ts`——更深的文件被当成「已删除」写回了。

**任务**：

1. 增量比对只在本次扫描覆盖的深度内判定删除；深处、超出 `maxDepth` 的已索引
   文件保留在缓存与磁盘索引中，不因窄扫描被删除。
2. 深处文件真的从磁盘上消失时，宽 `maxDepth`（覆盖它的）扫描仍要移除它。

**验收**：

- tools 新增 >= 2 个用例：窄 `maxDepth` 搜索后深层文件仍在磁盘索引中；
  深层文件确实被删除后，覆盖该深度的扫描会把它移除
- 既有 code-search 用例保持全绿
- `pnpm test` 全绿

---

## 阶段 3：文档、全量回归与提交（~1 小时）

1. 更新根 `README.md`（Current Status / Roadmap）
2. 更新受影响的 README 与 `docs/architecture.md`
3. 更新 `docs/CHANGELOG.md`
4. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
5. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v13-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1 > 阶段 2 > 阶段 3
