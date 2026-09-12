# day-plan v26 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v26.md`；结束前追加日志。

## 当前状态

- 当前阶段：已完成（阶段 0 + 阶段 1）
- 已完成阶段：阶段 0、阶段 1
- 最近一次运行：运行 2（2026-09-12 16:1x-16:4x）
- 工作区：全部已提交并推送

## 日志

### 运行 1 — 2026-09-12 15:2x-16:1x

- 阶段/工作项：阶段 0（符号链接边界判断）完成
- 做了什么：
  - `packages/agent-core/src/approval.ts`：
    - `outsideWorkingDirectoryWrite()` 现在同时做「字符串前缀判断」与
      「真实路径判断」，两者都通过才放行
    - 新增 `resolveForBoundaryCheck(root, target)`：`realpathSync` 解析工作目录，
      再对目标路径逐级向上找到**最深的已存在祖先**并解析，把不存在的那一段拼回去
      ——这样 `write` 新文件、`mkdir` 新目录也能覆盖
    - 真实路径逃逸时错误信息同时给出请求路径与解析后的真实路径
    - 工作目录本身不存在时（例如测试里的虚拟路径 `/workspace/project`）回退到
      字符串判断：此时里面不可能有符号链接，保守拒绝反而会误伤合法写入
  - 新增 `packages/agent-core/tests/approval-symlink.test.ts`（5 个用例）
- 验证命令与结果：
  - 修复前后对照（工作目录内符号链接指向外部）：
    - 文件符号链接 `link.txt` -> 外部 `secret.txt`：修复前策略 **allow** 且
      实际把外部文件覆盖成写入内容；现在 **deny**，外部文件仍是 `ORIGINAL`
    - 目录符号链接 `outdir/` -> 外部目录：`write` 与 `mkdir` 修复前都 allow
      并在外部真的建了文件/目录；现在都 **deny**
    - 外部符号链接下更深的新路径 `outdir/nested/deep.txt`：现在也 **deny**
    - 指向工作目录**内部**的符号链接：仍然 allow（合法用法未受影响）
    - 普通目录内路径与相对路径：仍然 allow（回归保护）
  - 端到端（真实 `AgentLoop` + `FilesystemTool` + `denyDangerousPolicy`）：
    模型调用被拒并收到 `[denied by policy] filesystem write outside the working
    directory: …`，外部文件保持 `CLASSIFIED`
  - 首轮全量回归暴露 3 个既有用例失败（它们用不存在的 `/workspace/project`
    作为工作目录，被保守拒绝误伤），据此补上"root 不存在则回退字符串判断"，
    随后 agent-core 67 passed、全量 **446 passed / 0 failed**
- 提交：见阶段 0 的 fix 提交
- 下一步：阶段 1 — 文档、完整回归矩阵、提交推送

### 运行 2 — 2026-09-12 16:1x-16:4x

- 阶段/工作项：阶段 1（文档 + 全量回归）完成
- 做了什么：
  - `packages/agent-core/README.md`：说明边界检查会解析符号链接、
    目标可能不存在时如何逐级解析、以及工作目录不存在时的回退规则
  - 根 README：Current Status 增加该行为；Roadmap 增加第 56 项
  - `docs/CHANGELOG.md`：新增 v26 条目（含修复前后对照与首轮回归误伤说明）
- 验证命令与结果：
  - `node scripts/check.mjs`：Structure check passed
  - `pnpm build` / `pnpm typecheck`：通过
  - `pnpm test`：**446 passed / 0 failed**
  - `pnpm --filter @dev-agent/executor test:integration`：10 passed
  - `cargo fmt --check` / `cargo clippy --all-targets -- -D warnings`：通过
  - `cargo test`：46 passed（43 lib + 3 bin）
- 提交：见 v26 的 fix / docs 提交
- 下一步：v26 计划已收尾

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | -    |
