# Day plan v41：audit export fail-closed 限额实现

**建立日期：2026-09-14**

> 本计划承接 `docs/day-plan-v40.md`。v40 已完成 metadata-only gate report 和 audit export 限额/版本设计；v41 只实现“不静默截断”的拒绝式限额，暂不实现分页、schema v2 或 before-image。

## Goal

为 agent-core 的 v1 audit projection 增加显式的 record/file/UTF-8 byte 限额检查，并将超限映射为 CLI/Desktop 的只读结构化错误；超限必须在返回部分结果前 fail closed，不得改变当前 allowlist、session 隔离或 workspace 安全边界。

## Architecture

- `createEvidenceAuditExport()` 接收可选的 `EvidenceAuditLimits`，先完成完整 allowlist projection、过滤和稳定排序，再检查 record count、file count 和 canonical UTF-8 JSON byte budget。
- 超限抛出可识别的 `EvidenceAuditLimitError`，包含限制类别、上限和实际计数，不包含命令、args、cwd、输出、绝对路径、文件内容或 before-image；没有显式限额时保持 v40 的 v1 完整快照行为。
- CLI/Desktop 只传递经过正整数/上限校验的限额并把超限映射为确定的非零/HTTP 4xx 结果；v1 不增加 `partial`、`hasMore` 或 cursor 字段。分页和 schema negotiation 仍按 `docs/evidence-audit-limits-v40.md` 另行评审。
- 当前代码定义的请求上限为 `maxValidations=10,000`、`maxChangeSets=10,000`、`maxFiles=100,000` 和 `maxBytes=10,485,760`（10 MiB）；这些 cap 同时约束核心 API、CLI 和 Desktop。

## Global Constraints

- 不持久化 before-image、patch、diff、文件字节、命令、args、cwd 或绝对 working directory；不实现跨进程 Undo。
- v1 超限只返回结构化错误，不静默截断、不修改 summary 伪装成完整快照、不 fallback 到 workspace 读取。
- byte budget 使用完整 canonical UTF-8 JSON 的 `Buffer.byteLength(..., "utf8")` 语义；上限检查在返回或写入前完成。
- 限额参数使用固定正整数和代码定义的最大请求值；不接受模型输出或任意 shell/路径作为参数。
- 新增行为遵循 TDD：先写测试并确认 RED，再写最小实现，先跑 agent-core/CLI/Desktop 聚焦回归，再跑完整门禁。

## Task 0：v40 基线和限额实现边界

**Produces:** v41 可执行的 v1 rejection-only contract。

- [x] **Step 1: 复核 v40。** 固定 gate report、v1 compatibility matrix 和 before-image NO-GO 已发布到 `origin/main`。
- [x] **Step 2: 选择 rejection-only 语义。** v1 只支持完整快照或明确错误，不引入 partial/pagination 字段。
- [x] **Step 3: 写 v41 计划与进度文档。** 本计划和 `docs/day-plan-v41-progress.md` 记录实现边界和后续路线。

## Task 1：Agent-core audit limit contract

**Produces:** 可复用的限额类型、结构化错误和 UTF-8 byte budget 检查。

**Files:**

- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/evidence.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/index.ts`
- Test: `/Users/Admin/Desktop/dev-agent/packages/agent-core/tests/memory.test.ts`

- [x] **Step 1: 写 RED 测试。** 覆盖 validations/changeSets/files 超限、UTF-8 多字节 byte budget、无显式限额保持兼容、错误 allowlist 和输入不变性。
- [x] **Step 2: 运行聚焦测试确认 RED。** 首轮 `pnpm --filter @dev-agent/agent-core test` 按预期因限额 API 尚不存在而失败。
- [x] **Step 3: 写最小实现。** 添加有限的正整数 limits、固定错误 code/kind、完整投影后检查 count/file/byte；不返回 partial snapshot，不读写 workspace。
- [x] **Step 4: 运行聚焦回归。** agent-core 测试 **116/116** 通过，且 limits 失败不会产生副作用。
- [x] **Step 5: 提交。** agent-core rejection-only limit contract 已包含在 `458e4a1`。

## Task 2：CLI/Desktop 超限映射

**Produces:** 两个宿主表面能显式请求限额并得到同一语义的只读错误。

**Files:**

- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/index.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/src/server.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/validation.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/desktop/tests/multi-session.test.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/README.md`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/README.md`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/README.md`

- [x] **Step 1: 写 RED 测试。** CLI/HTTP 接受正整数限额、拒绝 0/负数/非数字/超过代码上限；超限不加载 provider、不进入 chat 队列、不访问 workspace。
- [x] **Step 2: 写最小实现。** CLI 增加显式 export limit flags；Desktop evidence API 接受对应 query 参数；两者共享 agent-core 校验与错误字段。
- [x] **Step 3: 运行聚焦回归。** agent-core **116/116**、CLI **115/115**、Desktop **73/73** 通过，v1 成功响应字段不变，超限只返回 4xx/非零结果。
- [x] **Step 4: 更新使用文档。** 根 README、`docs/README.md`、CLI 和 Desktop README 已说明完整快照/超限错误差异和 v1 暂不分页。
- [x] **Step 5: 提交。** CLI/Desktop rejection-only limit mapping 已包含在 `458e4a1`。

## Task 3：全量验证、发布和下一阶段计划

**Produces:** v41 限额实现可交付，分页和 before-image 继续留在文档闸门之后。

- [x] **Step 1: 运行完整 `pnpm verify`，并单独复跑 TypeScript/Rust gate。** 完整门禁和分阶段 gate 均通过；记录限额成功/错误路径和所有通过计数。
- [x] **Step 2: 运行 report smoke、结构检查、diff check 和人工 review。** 报告和错误均未包含敏感字段，默认行为不产生副作用。
- [x] **Step 3: 更新 CHANGELOG、v41 进度和使用文档。** 已记录限额语义、schema 保持 v1 和验证结果。
- [x] **Step 4: Commit and push。** v41 实现和文档已发布到 `origin/main`。
- [x] **Step 5: 新建 v42 计划。** 仅评估 keyset pagination/schema v2 和 before-image 独立评审，不默认承诺跨进程 Undo。

## Acceptance Checklist

- [x] agent-core 对 record/file/byte 超限 fail closed，不返回部分 v1 快照。
- [x] UTF-8 byte budget 与 canonical JSON 顺序稳定，多字节内容按字节而非字符计数。
- [x] CLI/Desktop 对限额输入和超限错误具有相同语义，保持 session 隔离和无 workspace side effect。
- [x] v1 成功响应不增加 partial/pagination/cursor 字段；无显式限额时保持兼容。
- [x] 错误不包含命令、args、cwd、stdout、stderr、绝对路径、文件内容、session evidence 或 before-image。
- [x] v40 fixed release gate、MCP、no-auto-rollback、active guard 和 Rust sandbox 回归继续通过。

## v41 完成后的后续路线

1. 若 rejection-only 限额稳定，再独立评审分页和 schema v2，不把 page 当完整 snapshot。
2. 继续用 metadata-only report 关联门禁结果，只使用稳定 phase id/status/timing。
3. before-image 七项安全闸门未全部具备可验证证据前，保持 production NO-GO。
