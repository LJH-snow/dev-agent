# dev-agent 2026-09-18 夜跑：十个共享项目面目标

**建立日期：** 2026-09-18

**执行窗口：** 2026-09-18 00:10–08:10（Asia/Shanghai），总计 8 小时。若所有
目标提前完成，剩余时间用于全量验证、变更审计、文档收口，或开启下一批有边界
的 follow-up 目标；不得把剩余时间用于无依据的重构。

**当前基线：** 本地工作区包含已验证的 Desktop managed runtime status 变更。
`pnpm build`、`pnpm verify:typescript`、Desktop focused tests（88/88）和
runtime-manager tests（14/14）均通过。当前工作区尚未提交，也没有进行发布、
打 tag、push 或开启新的 npm release。

## 一、执行边界

1. **项目面优先：** 本轮重点放在 Desktop、runtime status、evidence、approval 和
   validation 等共享项目面；不继续做 CLI TUI/输出格式的打磨。
2. **先测试后实现：** 每个目标先补 RED contract，再最小实现；不能只靠“看起来合理”
   就改 UI 或 API。
3. **不做发布：** 不创建 Git tag、不 push、不创建 GitHub Release、不执行
   `npm publish`、不修改 release-state 表示已发布的字段。若 v0.1.7 candidate 完成，
   只更新 candidate checklist 和 release readiness 记录。
4. **不碰凭据：** 不读取、输出、复制或重新写入 token/API key；不修改
   `~/.npmrc`，不把任何凭据写入仓库。
5. **保留用户/其他窗口变更：** 现有 docs、release-state、CLI package 版本和
   Desktop managed-runtime 变更都视为已完成工作；只能基于它们继续，不能回滚。
6. **安全状态仍为 metadata-only：** 状态、evidence、review、doctor 和 UI 不新增
   绝对路径、原始错误、命令输出、文件内容、before-image 或凭据。
7. **无权限审批：** 自动运行环境不得绕过 sandbox、approval、validation 或
   change-set guard。任何需要真实产品决策的事项记为 blocked/human decision。
8. **失败协议：** 同一目标失败三次仍无明确进展时，停止该目标，写 proof gap，转向
   下一个独立目标；不要反复重复同一个失败动作。
9. **提交边界：** 每完成一个目标可以创建一个本地 commit；禁止 push。提交信息只
   描述已验证行为，不把未完成或未验证内容混入。
10. **时间盒优先：** 一个目标超过 60 分钟仍未形成稳定最小闭环时，降级为 proof-gap
   记录，不再扩大范围。

## 二、十个目标（按顺序执行）

### 目标 1：把 Managed runtime 状态翻译成用户可判断的动作

**范围：**

- 为 `unsupported / missing / installed / corrupt / unavailable` 建立稳定 UI 语义；
- 每种状态显示一句安全的用户说明和建议动作；
- `missing` 建议 `dev-agent runtime install`，`corrupt/unavailable` 只建议重新检查
  或修复，不展示路径、错误体或命令参数；
- 保持 API schema 兼容，UI row 仍是 metadata-only。

**验收：**

- `apps/desktop/src/status.ts` 或对应 UI helper 有状态映射 contract tests；
- `apps/desktop/public/index.html` 有 Managed runtime 各状态的展示测试；
- `pnpm --filter @dev-agent/desktop run test` 通过；
- 文档说明每种状态的含义，不暴露敏感诊断。

### 目标 2：统一 Desktop status 的“运行中 / 空闲 / 不可用”语义

**范围：**

- audit 当前 Executor、Runtime、Managed runtime、Provider、Model、Approval、Validation
  各字段在 session running、idle、unknown session 和 fetch failure 时的表现；
- 只为真实缺口添加最小修复或测试；
- 保证 refresh 按钮在 loading、success、failure 时都有清晰的 disabled/aria 状态；
- 不做视觉重设计，不新增新面板。

**验收：**

- UI contract tests 覆盖 loading、ready、unknown session 和 refresh failure；
- `/api/status` API tests 保持 schema v1 且新增字段必须兼容；
- `pnpm --filter @dev-agent/desktop run test` 通过。

### 目标 3：给 Desktop session 列表补充健康摘要

**范围：**

- 检查 `/api/sessions` 已有 summary 的字段，评估是否缺少可扫描的健康信号；
- 只使用 metadata-only 数据：最后活动时间、validation count、protected/rolled-back
  guard count、evidence retention 状态；
- 不展示 cwd、provider key、模型 secret、session file 绝对路径或原始命令；
- UI 只做紧凑摘要，不改变 session 历史 schema。

**验收：**

- API snapshot test 锁定新增 summary 字段；
- UI 有至少一条 session summary 渲染/降级测试；
- 空列表、损坏 summary、unknown evidence schema 都不会崩溃；
- `pnpm --filter @dev-agent/desktop run test` 通过。

### 目标 4：加固 Evidence preview 的加载状态与错误语义

**范围：**

- audit evidence preview 的 request ID guard、abort controller 和 stale response
  处理；
- 确保快速刷新、切换 session、unknown session、413 和网络失败不会互相覆盖；
- 状态文案保持元数据边界，不回显原始错误；
- 如果现有实现已完整，补 contract 测试并标记 Preserve。

**验收：**

- 新增并发/过时响应/413/未知 session 回归测试；
- preview DOM 的 `aria-busy` 和 visible state 与请求状态一致；
- Desktop tests 通过。

### 目标 5：统一 validation card 的 passed/failed/skipped/blocked 展示

**范围：**

- audit validation card 对四种状态、rerun 请求、rerun busy、rerun failure 的语义；
- 保证 blocked 和 failed 有不同的可读含义；
- rerun 失败不覆盖原始 validation evidence；
- 不改变 validation DTO 或 session schema。

**验收：**

- UI contract tests 覆盖四种状态；
- rerun 返回 409/404/501 时状态文案不误报成功；
- validation endpoint tests 继续通过。

### 目标 6：把 approval review 的空差异和受限文件边界讲清楚

**范围：**

- 测试 `review-writes` 中空 diff、多文件 diff、hash mismatch、deny、timeout 和
  client disconnect 的表现；
- 如果发现 UI 可能暗示“没有变化”，增加明确文案或状态；
- 保持真正的 filesystem diff、hash guard 和 deny-safe fallback 不变。

**验收：**

- 空差异、deny、disconnect、partial review 均有测试；
- deny 后目标文件不变；
- approval timeout 和 disconnect 的保守 deny 语义保持；
- Desktop tests 通过。

### 目标 7：补齐 Desktop MCP 状态摘要

**范围：**

- 盘点 MCP lifecycle 数据是否已经能以 metadata-only 形式进入 `/api/status` 或
  `/health`；
- 若已有信息足够，只在 UI/文档中同步说明 Preserve；
- 只有存在明确缺口时，才新增 server name、connected/degraded/error、tool count、
  timeout 等安全摘要；
- 不展示 command、args、env、绝对路径或 raw stderr。

**验收：**

- 先写 contract 证明当前缺口或证明 Preserve；
- 新增字段有 allowlist、redaction 和 unknown/timeout 测试；
- `/api/status` 和 UI contract tests 通过。

### 目标 8：让 external project 使用状态在 Desktop 可见

**范围：**

- 检查 Desktop session 如何表达工作目录或项目范围，找到是否已有 metadata-only
  方案；
- 如有必要，增加一个安全的 workspace label，例如 basename 或显式项目名，不暴露
  绝对路径或文件树；
- 明确 `--cwd`/项目 state 与 Desktop session 的关系；没有证据时保留现状。

**验收：**

- 任何新增字段不包含绝对路径、用户名、环境变量或可枚举文件名；
- session/document contract tests 通过；
- Desktop README 说明显示边界。

### 目标 9：增强 evidence retention 的用户可审计性

**范围：**

- audit `/evidence/preview`、`/evidence`、cleanup 和 rollback 的保护计数；
- 如 UI 只显示数字但没有说明保留原因，补充固定的安全说明；
- 明确 applied guard 为什么不能被 cleanup 移除；
- 不添加 before-image、diff 或 pagination authority。

**验收：**

- cleanup/preview/evidence endpoint tests 保持通过；
- UI 状态和文档说明只使用 metadata-only 字段；
- protected guards 的行为不被削弱。

### 目标 10：建立 v0.1.7 Desktop candidate 的 release checklist

**范围：**

- 把已完成目标汇总为 v0.1.7 candidate 变更清单；
- 记录每个目标对应的测试命令和结果；
- 明确哪些内容属于 workspace-only candidate，哪些已随 0.1.6 发布；
- 保持 `@agent_cli/cli@0.1.7` 为候选状态，除非用户之后明确授权发布。

**验收：**

- checklist 包含 no-tag/no-push/no-release 的当前状态；
- documentation contract tests 通过；
- 最后运行一次 `pnpm build`、`pnpm verify:typescript`、Desktop focused tests 和
  runtime-manager tests；
- progress 记录中列出未完成目标和需要用户决策的事项。

## 三、时间盒建议

| 窗口 | 阶段 | 交付 |
| --- | --- | --- |
| 00:10–00:30 | 基线冻结 | 检查工作区、当前 diff、已有 gate 记录；不覆盖其他窗口变更 |
| 00:30–03:30 | 目标 1–5 | Desktop runtime/status/evidence/validation 的小步闭环 |
| 03:30–05:30 | 目标 6–9 | approval、MCP、external project、evidence audit 检查与实现 |
| 05:30–06:30 | 集成复核 | diff 审查、补漏、文档同步、必要时局部提交 |
| 06:30–07:30 | 全量验证 | TypeScript release gate 和 focused package tests |
| 07:30–08:10 | 目标 10 + 交接 | v0.1.7 candidate checklist、progress、remaining decisions |

## 四、提前完成的规则

1. 十个目标都达到 `DONE`、`PRESERVE` 或 `DONE + DEFERRED` 后，先做最终审计，不要
   临时塞新功能。
2. 最终审计通过后，如果 8 小时窗口未结束，可以按相同边界新开 follow-up 目标。
3. 新 follow-up 必须先写入本计划的 `## 五、提前完成后新增目标`，再开始代码。
4. 优先继续同一主题：Desktop 项目面、runtime visibility、evidence audit 和
   release readiness。
5. 仍然禁止发布、push、tag、下载未知依赖或扩大平台支持。

## 五、提前完成后新增的目标

**待补充。** 只有在目标 1–10 和最终审计完成后才写入这里；每条必须包含范围、RED
contract、验收命令和明确的 no-release 边界。

## 六、最终交接要求

夜跑结束时必须留下：

- 每个目标的状态（`DONE`、`PRESERVE`、`DONE + DEFERRED` 或 `BLOCKED`）；
- 修改文件和验证命令；
- 通过/失败/跳过的测试数量；
- 仍未解决的产品或安全问题；
- 当前 Git 工作树状态，包括本地 commits 和未提交内容；
- 明确说明没有创建 tag、没有 push、没有发布 npm package、没有修改 `~/.npmrc`。

