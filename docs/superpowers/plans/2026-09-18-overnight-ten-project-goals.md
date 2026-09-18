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

### Follow-up 目标 11：把 runtime release 选择能力写进文档

**建立时间：** 2026-09-18；目标 1–10 完成并进入最终审计后追加。

**范围：**

- 只补文档，不修改 CLI/runtime-manager 实现；
- 说明 `--runtime-release <version>` 的用途：选择承载 runtime manifest 与 archive
  的 GitHub release，允许它与 `--runtime-version` 表达的 runtime identity 不同；
- 说明当前默认 release 是 `0.1.6`，runtime identity 仍是 `0.2.0`；
- 说明 `pnpm runtime:smoke` 是额外的本地验证路径，不把它当作发布授权；
- 更新 CLI README、CHANGELOG、roadmap baseline 与 v0.1.7 candidate checklist。

**RED contract：**

- 扩展 `tests/documentation-contract.test.mjs`，要求 CLI README 包含
  `--runtime-release` 与 manifest/archive release 的说明；
- 要求 CHANGELOG 或 candidate checklist 区分 workspace-only candidate 与已发布的
  `v0.1.6` release artifacts；
- 先运行新增文档契约，确认缺少文档时为 RED，再补文档。

**验收命令：**

```sh
node --test tests/documentation-contract.test.mjs
pnpm --filter @dev-agent/runtime-manager run test
pnpm --filter @agent_cli/cli run test
pnpm --filter @dev-agent/desktop run test
```

**边界：**

- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`；
- 不改动另一个窗口正在维护的 CLI/runtime implementation 文件；
- 验证通过前不把该能力描述为已发布。

### Follow-up 目标 12：运行 runtime install 隔离 smoke

**建立时间：** 2026-09-18；Follow-up 目标 11 文档收口通过后追加。

**范围：**

- 从仓库根目录执行 `pnpm runtime:smoke`；
- 该脚本会本地构建、打包 CLI tarball，并在独立 npm prefix 与临时 runtime 目录中
  验证 status/install/path/doctor/remove 生命周期；
- 只允许下载已知 `v0.1.6` release manifest 与对应 runtime archive；
- 不修改发布状态、用户 runtime cache 或任何实现文件。

**Contract：**

- `pnpm runtime:smoke` 必须以退出码 0 完成；
- 脚本最终输出 `Runtime install smoke passed`；
- 若失败，记录失败步骤与 sanitized 元数据，不重试超过三次，也不扩大范围。

**边界：**

- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`；
- 失败时不把该路径描述为可发布或已验证。

### Follow-up 目标 13：补强候选 release gates

**建立时间：** 2026-09-18；Follow-up 目标 12 smoke 通过后追加。

**范围：**

- 运行 `pnpm verify:rust` 和 `pnpm verify:integration`；
- 把 Rust 静态/单元 gate 与真实 Rust integration 的结果写入 v0.1.7 candidate
  checklist；
- 不修改 runtime implementation、release state 或发布动作。

**Contract：**

- Rust format/clippy 和 Rust unit/doc tests 必须通过；
- real Rust integration 必须覆盖 sandbox policy、readonly/network 边界、
  timeout/resource/output limit、abort、cancel 和 concurrency；
- 通过前不把候选描述为 release ready。

**边界：**

- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`。

### Follow-up 目标 14：只读 release preflight 证据

**建立时间：** 2026-09-18；Follow-up 目标 13 gate 补齐后追加。

**范围：**

- 运行 `pnpm release:preflight`，它只做 metadata-only 检查，不发布；
- 记录 candidate metadata、auth、registry published version 和 tarball allowlist
  的验证结果；
- 明确 `nextAction: publish_candidate` 只是技术下一步，不是维护者授权。

**Contract：**

- preflight 必须以退出码 0 完成，candidate 为 `0.1.7`，published 为 `0.1.6`；
- artifact allowlist 为五个期望文件；
- 候选文档必须继续写明 no-publish/no-tag/no-release。

**边界：**

- 不创建 tag、不 push、不执行 `pnpm release:publish`、不创建 GitHub Release、
  不修改 `~/.npmrc`。

### Follow-up 目标 15：索引 2026-09-18 计划与 v0.1.7 candidate

**建立时间：** 2026-09-18；Rust/integration/preflight 证据补齐后追加。

**范围：**

- 只更新文档导航，不改变行为；
- 在根 README 与 docs README 的当前交付索引中加入 2026-09-18 overnight plan、
  其 progress record 和 v0.1.7 Desktop candidate checklist；
- 在根 README Roadmap 追加第 81 项，记录当前 workspace 完成且 release 仍需授权；
- 保持历史文档链接不变。

**RED contract：**

- 在 documentation contract 中新增测试，断言三份 2026-09-18/v0.1.7 文档在两个
  索引中可发现，且 Roadmap 第 81 项存在；
- 先运行契约确认 RED，再补文档，直到 **12/12**。

**边界：**

- 不修改 CLI/runtime implementation；
- 不发布、不 push、不创建 tag、不创建 GitHub Release、不修改 `~/.npmrc`。

### Follow-up 目标 16：说明 runtime smoke 的 proxy 环境条件

**建立时间：** 2026-09-18；Follow-up 目标 12 发现 proxy 环境差异后追加。

**范围：**

- 在 CLI runtime 说明与 v0.1.7 candidate checklist 中明确：proxy 环境下需要
  `NODE_USE_ENV_PROXY=1` 才能让 Node fetch 走已配置的 HTTP/HTTPS proxy；
- 说明 smoke 默认命令和 `--skip-build` 变体的区别；
- 不修改 runtime downloader、smoke script 或 `NODE_USE_ENV_PROXY` 的运行时行为。

**RED contract：**

- 在 documentation contract 中断言 CLI README 与 candidate checklist 都包含
  `NODE_USE_ENV_PROXY=1`；
- 要求 candidate checklist 的 smoke gate 写成显式 proxy-aware 命令；
- 先运行契约确认 RED，再补文档。

**边界：**

- 不修改 CLI/runtime implementation；
- 不发布、不 push、不创建 tag、不创建 GitHub Release、不修改 `~/.npmrc`。

### Follow-up 目标 17：在最终文档状态上运行完整 verify

**建立时间：** 2026-09-18；Follow-up 目标 16 文档契约通过后追加。

**范围：**

- 从仓库根目录运行完整 `pnpm verify`，覆盖 TypeScript、Rust 和 real integration
  的固定顺序；
- 在同一轮最终工作树上验证最新 documentation contract，而不是只依赖先前分别
  通过的 phase gate；
- 把结果写入 progress 与 v0.1.7 candidate checklist；
- 不修改实现、发布状态、tag、remote 或 `~/.npmrc`。

**Contract：**

- `pnpm verify` 必须以退出码 0 完成，最终输出 `all selected gates passed`；
- 记录三类 gate 都通过；
- 完整 verify 的通过不改变 release authorization 边界。

**边界：**

- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`。

### Follow-up 目标 18：锁定 CLI runtime release 契约

**建立时间：** 2026-09-18；完整 verify 通过后追加。

**范围：**

- 只新增 CLI 层回归契约，不修改 runtime/CLI 实现；
- 测试 `readRuntimeManifestRelease` 的显式值、空白值回退和默认值；
- 测试 `runtime status --runtime-release` 被接受、不启动 provider、不把 release/
  manifest metadata 泄漏进 JSON；
- 不通过 CLI 测试执行真实 runtime install，完整安装路径继续由
  `pnpm runtime:smoke` 和 runtime-manager tests 验证。

**Contract：**

- 默认 release 是 `0.1.6`；
- 显式非空白 release 会被使用，空白值回退到默认；
- runtime status payload 不包含 `release`、`manifestRelease`、
  `manifestReleaseVersion` 或本地路径。

**边界：**

- 不修改 CLI/runtime implementation；
- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`。

### Follow-up 目标 19：审计 Desktop executor-mode 显示契约

**建立时间：** 2026-09-18；post-goal-18 最终审计通过后追加。

**范围：**

- 只做 v65 的 bounded audit，验证 `/api/status` 的 allowlisted `executor.mode`
  会被状态面板渲染为用户可见值，并在 session 缺少 executor metadata 时回退为
  `unknown`；
- 不新增 panel、快捷键、通知、导出入口，也不做 Desktop 视觉重设计；
- 不修改 CLI、runtime-manager、release state 或另一个窗口正在维护的暂存文件。

**RED contract：**

- 在 Desktop status contract 中新增测试：HTML 必须声明 `renderDesktopStatus`
  会把 `payload.executor.mode` 渲染到 Executor value/state 元素；
- 新增测试：legacy fake session 没有 executor metadata 时，`/api/status` 仍然
  返回 `executor: { mode: "unknown" }` 且不包含绝对路径或敏感诊断；
- 先运行新契约确认当前覆盖状态，再决定 Preserve 或最小实现。

**验收命令：**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
git diff --check
```

**边界：**

- 不改变 executor 执行语义、公开 schema、approval、validation 或 managed-runtime
  卫生规则；
- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`；
- 没有 evidence-backed 状态缺口时，结论必须是 `PRESERVE`，不为了让变更集变大而
  添加功能。

### Follow-up 目标 20：补齐 v0.1.7 维护者 review handoff

**建立时间：** 2026-09-18；Goal 19 与 release preflight/runtime smoke 刷新通过
后追加。

**范围：**

- 只更新文档，不修改代码、release state、tag 或 remote；
- 在 v0.1.7 candidate checklist 中补充当前工作树的 review 边界：另一个窗口的
  staged runtime-release slice、本窗口的 Desktop hardening slice、共享文档契约
  和 2026-09-18 evidence；
- 说明本地 commit 必须按已审阅边界拆分或经拥有者协调，不能为了方便把 staged 和
  unstaged 两个 slice 捆成一个未审阅 commit；
- 明确 release preflight 与 runtime smoke 都只是技术 readiness，不等于发布授权。

**RED contract：**

- 在 `tests/documentation-contract.test.mjs` 新增断言，要求 candidate checklist
  有 `Candidate review handoff`；
- 要求它区分 staged runtime-release slice 和 Desktop hardening slice；
- 要求它写明共享 staging index 的 commit 风险与需要维护者决策的事项；
- 先运行新契约确认 RED，再补文档。

**验收命令：**

```sh
node --test tests/documentation-contract.test.mjs
git diff --check
```

**边界：**

- 不提交、不 push、不创建 tag、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`；
- 不修改另一个窗口的暂存实现文件；
- 不把 review packet 当作完成发布。

### Follow-up 目标 21：澄清 doctor 的 managed-state 合并语义

**建立时间：** 2026-09-18；Goal 20 文档收口通过后追加。

**范围：**

- 只做 v65 的 bounded audit 和 candidate 文档澄清，不修改 CLI、runtime-manager 或
  另一个窗口的暂存实现；
- 说明 doctor 在显式 runtime probe 存在时如何区分 selected runtime 的
  `runtimeVersion/protocolVersion` 与 managed runtime status 的 `state/target`；
- 说明 selected binary 的契约不匹配仍会体现在 `rust runtime` check 与 summary fail
  中，不能因 managed cache 状态为 `installed` 而误判通过；
- 不新增 API 字段，不改变 doctor schema 或执行语义。

**RED contract：**

- 在 documentation contract 中新增断言，要求 v0.1.7 Desktop candidate checklist
  同时说明 `selected runtime probe identity` 和 `managed cache state`；
- 先运行新增契约确认 RED，再补文档，直到 **15/15**。

**验收命令：**

```sh
node --test tests/documentation-contract.test.mjs
git diff --check
```

**边界：**

- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`；
- 不修改另一个窗口的暂存实现文件；
- 没有 evidence-backed 实现缺口时，不改 doctor 代码。

### Follow-up 目标 22：修正 project-state 的首次发布版本记录

**建立时间：** 2026-09-18；post-goal-21 审计中发现 roadmap 的版本归属与
CHANGELOG 历史不一致后追加。

**范围：**

- 只修正 `docs/next-roadmap-plans-v62-plus.md` 中 `--project-state` 的首次发布
  版本归属，不改实现、release state 或另一个窗口的 staged 文件；
- 以 `docs/CHANGELOG.md` 的 `0.1.3` 记录为准，避免把它误记为随 `0.1.5`
  发布；
- 在 progress 记录中记录 RED contract 与最终验证结果。

**RED contract：**

- 在 documentation contract 中新增测试，要求 roadmap 明确 `--project-state`
  已随已发布的 npm `@agent_cli/cli@0.1.3` 提供；
- 先运行新增契约确认 RED，再修正 roadmap，直到契约通过。

**验收命令：**

```sh
node --test tests/documentation-contract.test.mjs
git diff --check
```

**边界：**

- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`；
- 不修改另一个窗口的暂存实现文件；
- 不在文档契约中重新解释 `0.1.6` 的发布历史。

### Follow-up 目标 23：收口 Desktop 服务的内部错误边界

**建立时间：** 2026-09-18；post-goal-22 审计后检查 Desktop server 的错误
边界时追加。

**范围：**

- 先写 RED contract，证明 `/api/status` 的 uncaught handler 错误会把原始
  `error.message` 返回给客户端；
- 将顶层 HTTP catch 的用户响应收敛为稳定的 `request failed`，避免路径、
  secrets 或 raw stack 进入状态 API；
- 不改变各个 endpoint 已有的稳定 400/404/409/413/501 错误语义；
- 不修改另一个窗口的 staged runtime-release 文件。

**RED contract：**

- 在 Desktop server contract 中新增测试：自定义 session 的 `getStatus` 抛出
  包含路径和 secret 的错误时，`/api/status` 必须返回 `500` 且 body 只包含
  `error: "request failed"`；
- 先运行该测试确认 RED，再做最小实现，直到 Desktop tests 全部通过。

**验收命令：**

```sh
pnpm --filter @dev-agent/desktop run test
git diff --check
```

**边界：**

- 不改变 Desktop 状态 schema、metadata allowlist、session 执行语义、审批或
  validation 行为；
- 不新增面板、导出入口或视觉重设计；
- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`。

### Follow-up 目标 24：刷新 candidate 的 handoff provenance

**建立时间：** 2026-09-18；post-goal-23 收口后审计发现 checklist 仍描述
runtime-release 和 Desktop hardening slice 为未提交，而它们实际已分别进入
提交历史。

**范围：**

- 只更新 candidate review handoff 和 progress 记录，不修改实现、release state
  或 Git remotes；
- 将 runtime-release slice 记录为已由拥有者窗口提交并 push；
- 将 Desktop hardening/evidence/docs slice 记录为本地 commit；
- 明确当前没有新的共享 staging index，也不把任何内容描述为已发布或已授权。

**RED contract：**

- 在 documentation contract 中新增断言，要求 candidate handoff 说明两个 slice
  的最终 Git 状态，并禁止继续把 focused work 描述为 `still uncommitted`；
- 先运行新增契约确认 RED，再补文档。

**验收命令：**

```sh
node --test tests/documentation-contract.test.mjs
git diff --check
```

**边界：**

- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`；
- 不改写已有历史验证记录；
- 不做 release 授权。

### Follow-up 目标 25：加固 Desktop status 的过时响应边界

**Status:** DONE

**建立时间：** 2026-09-18；Goal 24 收口后继续审计 Goal 2 时发现快速切换
session 的 status 请求缺少 stale guard。

**范围：**

- 为 Desktop status 请求补 request id 和 AbortController；
- 新 status 请求 abort 旧 status 请求；
- stale request 或 stale session 的 response 不渲染状态面板；
- 保持 `/api/status` schema、metadata allowlist 和 managed-runtime 清洗不变；
- 更新 Desktop README 与 v0.1.7 candidate checklist。

**RED contract：**

- 先在 Desktop UI contract 中断言 `desktopStatusRequestId`、abort controller、
  stale/session guard 和 signal 存在；
- 再在 documentation contract 中断言 Desktop README 与 candidate checklist 说明
  stale-safe 语义；
- 先分别确认 RED，再补最小实现与文档。

**验收命令：**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
git diff --check
```

**边界：**

- 不新增 panel、导出入口、绝对路径、原始错误或视觉重设计；
- 不改变 `/api/status` 公开 schema；
- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`。

**完成记录：**

- 已添加 request ID、AbortController、signal、stale request/session guard，
  并只清理当前请求的 finally 状态；
- Desktop UI contract 先确认 RED，随后实现后通过；
- Desktop focused tests **99/99**；
- `pnpm verify` 通过并输出 `all selected gates passed`，相关计数为
  runtime-manager **15/15**、CLI **314/314**、documentation contract
  **17/17**、Rust unit/doc **54/54**、real Rust integration **11/11**；
- 未创建 tag、未 push、未发布 npm package、未创建 GitHub Release、未修改
  `~/.npmrc`。

## 六、最终交接要求

夜跑结束时必须留下：

- 每个目标的状态（`DONE`、`PRESERVE`、`DONE + DEFERRED` 或 `BLOCKED`）；
- 修改文件和验证命令；
- 通过/失败/跳过的测试数量；
- 仍未解决的产品或安全问题；
- 当前 Git 工作树状态，包括本地 commits 和未提交内容；
- 明确说明没有创建 tag、没有 push、没有发布 npm package、没有修改 `~/.npmrc`。
