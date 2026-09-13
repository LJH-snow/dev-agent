# day-plan v33 进度账本

> 按 `/Users/Admin/Desktop/dev-agent/docs/day-plan-v33.md` 执行；每个 Task 完成后记录 focused test、提交和实际失败原因。

## 当前状态

- 当前阶段：Task 2，FilesystemTool preview/apply/rollback 和原子写入
- 已完成阶段：Task 0、Task 1、Task 2；v32 已完成并推送到 `origin/main`
- 工作区基线：`bd05586 docs: record v32 release verification`
- 最近一次 v32 验证：TypeScript 477/477、Rust 46/46、真实运行时集成 10/10 通过

## 阶段目标

- filesystem preview 只读返回真实统一 diff、SHA-256 before/after hash 和增删统计。
- `review-writes` 在 write/edit/patch/mkdir/apply 前生成稳定 change set，并在批准后才原子写盘。
- 多文件 change set 预检和应用全有或全无；hash conflict、拒绝、超时、断开均保持字节不变。
- CLI 展示 diff，`--json` 返回结构化 review；Desktop 通过 SSE 展示 diff、批准/拒绝并提供 guarded rollback。
- v32 的取消、进度、审批兼容性和 Rust 安全边界不回归。

## Task 日志

### Task 0：建立进度账本和工作区基线（已完成）

- 基线状态：`## main...origin/main`，工作区仅包含本计划与进度账本两个未跟踪文档。
- 基线提交：`bd05586 docs: record v32 release verification`（`HEAD` 与 `origin/main` 一致）。
- `pnpm --filter @dev-agent/tools test`：75/75 通过。
- `pnpm --filter @dev-agent/agent-core test`：72/72 通过。
- 失败原因：无。
- 提交：`docs: add v33 write review plan`。

## Task 记录

| Task | 状态 | 实际结果 | 提交 |
|------|------|----------|------|
| Task 0 | 已完成 | tools 75/75；agent-core 72/72；基线与远端一致 | `docs: add v33 write review plan` |
| Task 1 | 已完成 | 首次 focused test 按预期因公共导出不存在而失败；随后 tools 全套 80/80 通过 | `feat(tools): add change-set diff and hash model` |

### Task 1：建立 change-set 数据模型、哈希和统一 diff（已完成）

- RED：`pnpm --filter @dev-agent/tools test -- --test-name-pattern="change set|change-set|UnifiedDiff|hashBytes"` 首次因 `dist/index.d.ts` 尚无 5 个新导出而失败，确认失败来自待实现功能。
- GREEN：`pnpm --filter @dev-agent/tools build` 后运行 `pnpm --filter @dev-agent/tools test`，tools **80/80** 通过（基线 75 + 新增 5）。
- 覆盖：新文件、修改、空文件、全量删除、无变化、UTF-8、稳定 SHA-256、UUID change-set id、多文件增删汇总。
- 实现：`packages/tools/src/change-set.ts` 使用 Node 内置 crypto、TextEncoder/TextDecoder 和按行 LCS；无运行时依赖、无工作区写入。
- 提交：待本账本同步后提交 `feat(tools): add change-set diff and hash model`。

### Task 2：FilesystemTool preview/apply/rollback 和原子写入（已完成）

- RED（preview）：`pnpm --filter @dev-agent/tools test -- --test-name-pattern="preview|apply|rollback|atomic"` 首次按预期失败：filesystem 尚不认识新 action，且 `prepareChangeSet` 不存在。
- RED（边界）：新增“文件列在 mkdir 之前”测试后再次失败，确认 change set 需要先规划目录依赖。
- GREEN：`pnpm --filter @dev-agent/tools build` 后运行 `pnpm --filter @dev-agent/tools test`，tools **90/90** 通过（基线 75 + Task 1 的 5 + Task 2 的 10）。
- 覆盖：只读 preview、write/edit/patch/mkdir、缺失/重复 hunk、目录/文件冲突、单文件 apply、全量 preimage 预检、多文件冲突全不写、原子替换、existing/new file rollback、mkdir rollback、postimage 冲突、目录依赖无序。
- 实现：`FilesystemTool` 维护最多 64 个 change set；preview 只读记录 bytes/hash/diff，apply 统一预检后先建目录再同目录临时文件 rename，rollback 校验 postimage 后恢复或删除并清理本次创建的空目录。
- 额外修正：保持旧 read 的 working-directory 解析行为；将 edit/patch 的纯计算与写盘拆开；apply/rollback 错误包含 change-set id 和冲突路径。
- 提交：待本账本同步后提交 `feat(filesystem): preview atomically apply and rollback changes`。

## 错误与卡点

| 时间 | Task | 问题 | 处理 |
|------|------|------|------|
| - | - | 暂无 | - |

## 后续路线

- v33 完成后执行 v34：根据 change set 计算最小验证集合，把 typecheck/test/真实运行时结果反馈给模型和 Desktop。
