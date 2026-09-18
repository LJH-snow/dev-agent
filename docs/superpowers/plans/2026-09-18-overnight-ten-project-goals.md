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

### Follow-up 目标 30：让 rollback 加入 active session lifecycle 追踪

**Status:** DONE

**建立时间：** 2026-09-18；Goal 29 收口后审计 mutation lifecycle，发现
rollback 会拒绝其他 active request，但自身没有加入 `inFlight`，因此并发的
rollback、DELETE 或 rename 缺少统一 fail-closed 边界。

**范围：**

- rollback 运行中加入 `inFlight`，结束后只清理本请求；
- 同一 session 的第二个 rollback 返回 `409`，不重复执行；
- rollback 运行中 DELETE 和 rename 返回 `409`，且不删除或移动文件；
- 统一 active-lifecycle 错误语义为 chat、validation、cleanup 或 rollback；
- 更新 Desktop README 与 v0.1.7 candidate checklist。

**RED contract：**

- 新增 server contract 测试：并发 rollback 返回 `409` 且释放后可再次 rollback；
- 新增 server contract 测试：active rollback 时 DELETE 和 rename 返回 `409`；
- 先确认 RED，再做最小 fail-closed 实现。
- RED proof：临时移除 rollback 的 `inFlight.add` 后，两条新契约都返回 `200`
  而非 `409`，聚焦运行为 **19 passed / 2 failed**；随后恢复实现。
- 测试 helper 使用 Node 内置 `http.request`，并由测试显式阻塞和放行 rollback，
  避免并发请求的进程/毫秒级调度竞态。

**验收命令：**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
git diff --check
```

**边界：**

- 不改变 rollback DTO、postimage hash guard、错误映射或 approval 语义；
- 不新增 panel、导出入口、绝对路径、原始错误或视觉重设计；
- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`。

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

### Follow-up 目标 41：约束 Desktop root static 边界

**Status:** DONE

**建立时间：** 2026-09-18 Goal 40 收口后继续审计 static 入口，发现
`GET /` 直接读取 `join(publicDir, "index.html")`，没有经过 Goal 40 的
real-path containment。如果 `public/index.html` 本身被 symlink 指向父目录，
root 页面仍可能绕过 `/public/` 防护。

**范围：**

- `GET /` 读取的 index asset 必须解析 real path 并保持在真实 public 目录内；
- 逃逸或断链的 index symlink 返回稳定 `404`，不返回目标文件内容；
- `/public/`、普通 static asset、响应上限和桌面 UI 行为不变；
- 更新 Desktop README 与 v0.1.7 candidate checklist。

**RED contract：**

- 新增 server contract：将 `public/index.html` 临时替换为父目录
  `package.json` 的 symlink 时，`GET /` 返回 `404` 且不包含 package 元数据；
- 在 documentation contract 中断言 README 与 checklist 记录 root static
  containment；
- 先确认 RED，再做最小实现。
- RED proof：`public/index.html` 临时替换为父目录 `package.json` 的 symlink
  时，当前实现返回 `200`；聚焦运行为 **18 passed / 1 failed**。文档契约为
  **31 passed / 1 failed**。

**完成记录：**

- `GET /` 已复用 static real-path resolver；
- root index 越界或断链 symlink 返回稳定 `404`，不返回目标内容；
- `/public/` 的 containment、普通 static asset 与 `1 MiB` response limit 保持
  不变；
- RED 后聚焦 static 边界测试 **18/18，1 failed**；实现后 **19/19**；
- documentation contract 实现后为 **32/32**；`pnpm verify` 输出
  `all selected gates passed`，相关计数为 Desktop **120/120**、runtime-manager
  **15/15**、CLI **314/314**、Rust unit/doc tests **54/54**、real Rust
  integration **11/11**；
- 未创建 tag、未 push、未发布 npm package、未创建 GitHub Release、未修改
  `~/.npmrc`。

### Follow-up 目标 29：让运行中的 Desktop session lifecycle fail-closed

**Status:** DONE

**建立时间：** 2026-09-18；Goal 28 收口后审计 session lifecycle，发现
DELETE 和 rename 允许作用于 active run，可能造成运行 session 的半删除或
路径切换。

**范围：**

- `DELETE /api/sessions/<id>` 在 chat/validation/cleanup 运行中返回 `409`；
- `POST /api/sessions/<id>/rename` 在同一运行状态下返回 `409`；
- 请求不删除文件、不切换内存路径、不中断当前 run；
- 保留 idle session 的删除、幂等 rename 和冲突行为；
- 更新 Desktop README 与 v0.1.7 candidate checklist。

**RED contract：**

- 新增 server contract 测试：active run 时 DELETE 与 rename 返回 `409`；
- 确认 RED 后，再做最小 fail-closed 实现。

**验收命令：**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
git diff --check
```

**边界：**

- 不新增 panel、导出入口、绝对路径、原始错误或视觉重设计；
- 不改变 chat/validation/cleanup/rollback 的公开 schema；
- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`。

**完成记录：**

- 已为 active session 的 DELETE 和 rename 添加 `inFlight` fail-closed guard，
  稳定返回 `409` 且先于文件删除、路径切换和 registry mutation；
- 新增 active DELETE/rename server contract，并确认 RED 后恢复最小实现；
  RED 期间 focused 结果为 **2 failed / 102 passed**；
- Desktop focused tests **104/104**，documentation contract **20/20**；
- `pnpm verify` 通过并输出 `all selected gates passed`，相关计数为
  runtime-manager **15/15**、CLI **314/314**、Rust unit/doc **54/54**、
  real Rust integration **11/11**；
- 未创建 tag、未 push、未发布 npm package、未创建 GitHub Release、未修改
  `~/.npmrc`。

### Follow-up 目标 28：加固 Desktop undo rollback 的过时响应边界

**Status:** DONE

**建立时间：** 2026-09-18；Goal 27 收口后审计 approval/Undo 请求，发现旧
session 的 rollback 响应可在切换 session 后触发 `markEvidencePreviewStale()`。

**范围：**

- 为 undo rollback 请求补 request ID、AbortController 和 signal；
- stale request 或 stale session 的 rollback 响应不更新 undo 状态、不标记
  evidence preview 过时；
- 保持 `/api/changesets/rollback` schema、409/404/501 文案和 postimage guard
  行为不变。

**RED contract：**

- 先在 Desktop UI contract 中断言 `desktopUndoRequestId`、abort controller、
  stale/session guard 和 signal 存在；
- 确认 RED 后，再做最小实现并更新文档。

**验收命令：**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
git diff --check
```

**边界：**

- 不新增 panel、导出入口、绝对路径、原始错误或视觉重设计；
- 不改变 rollback DTO、session schema 或 endpoint 行为；
- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`。

**完成记录：**

- 已添加 request ID、AbortController、signal、stale request/session guard，
  并只清理当前请求的 controller；
- Desktop UI contract 先确认 RED，随后实现后通过；
- Desktop focused tests **102/102**；
- `pnpm verify` 通过并输出 `all selected gates passed`，相关计数为
  runtime-manager **15/15**、CLI **314/314**、documentation contract
  **19/19**、Rust unit/doc **54/54**、real Rust integration **11/11**；
- 未创建 tag、未 push、未发布 npm package、未创建 GitHub Release、未修改
  `~/.npmrc`。

### Follow-up 目标 27：加固 Desktop validation rerun 的过时响应边界

**Status:** DONE

**建立时间：** 2026-09-18；Goal 26 收口后审计 validation card，发现 rerun
响应可在用户切换 session 后被追加到新 transcript。

**范围：**

- 为 validation rerun 请求补 request ID、AbortController 和 signal；
- stale request 或 stale session 的 rerun 结果不更新状态、不标记 evidence
  preview 过时、不追加 validation；
- 保持 `/api/changesets/validate` schema、409/404/501 文案和 validation DTO
  渲染不变。

**RED contract：**

- 先在 Desktop UI contract 中断言 `desktopValidationRerunRequestId`、
  abort controller、stale/session guard 和 signal 存在；
- 确认 RED 后，再做最小实现并更新文档。

**验收命令：**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
git diff --check
```

**边界：**

- 不新增 panel、导出入口、绝对路径、原始错误或视觉重设计；
- 不改变 validation DTO、session schema 或 endpoint 行为；
- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`。

**完成记录：**

- 已添加 request ID、AbortController、signal、stale request/session guard，
  并只清理当前请求的 controller；
- Desktop UI 与 documentation contract 先确认 RED，随后实现后通过；
- Desktop focused tests **101/101**；
- `pnpm verify` 通过并输出 `all selected gates passed`，相关计数为
  runtime-manager **15/15**、CLI **314/314**、documentation contract
  **18/18**、Rust unit/doc **54/54**、real Rust integration **11/11**；
- 未创建 tag、未 push、未发布 npm package、未创建 GitHub Release、未修改
  `~/.npmrc`。

### Follow-up 目标 26：加固 Desktop session 历史的过时响应边界

**Status:** DONE

**建立时间：** 2026-09-18；Goal 25 收口后继续审计相邻请求路径，发现快速切换
session 时 `loadHistory` 没有 request/session guard。

**范围：**

- 为 Desktop session 历史请求补 request ID、AbortController 和 signal；
- stale request 或 stale session 的历史响应不渲染；
- 保持现有 transcript 渲染、validation 卡片、空状态和错误静默降级不变；
- 更新 Desktop README 与 v0.1.7 candidate checklist。

**RED contract：**

- 先在 Desktop UI contract 中断言 `desktopHistoryRequestId`、abort controller、
  stale/session guard 和 signal 存在；
- 确认 RED 后，再做最小实现并更新文档。

**验收命令：**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
git diff --check
```

**边界：**

- 不新增 panel、导出入口、绝对路径、原始错误或视觉重设计；
- 不改变 `/api/sessions/<id>/messages` 公开 schema；
- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`。

**完成记录：**

- 已添加 request ID、AbortController、signal、stale request/session guard，
  并只清理当前请求的 controller；
- Desktop UI contract 先确认 RED，随后实现后通过；
- Desktop focused tests **100/100**；
- `pnpm verify` 通过并输出 `all selected gates passed`，相关计数为
  runtime-manager **15/15**、CLI **314/314**、documentation contract
  **17/17**、Rust unit/doc **54/54**、real Rust integration **11/11**；
- 未创建 tag、未 push、未发布 npm package、未创建 GitHub Release、未修改
  `~/.npmrc`。

### Follow-up 目标 31：给 Desktop JSON 请求体加上限

**Status:** DONE

**建立时间：** 2026-09-18；Goal 30 收口后最终审计发现 Desktop 的 POST JSON
`readBody` 没有总字节上限，而 SSE 已有 `DEV_AGENT_SSE_MAX_BYTES` 缓存上限，
两者缺少同样的资源边界。

**范围：**

- 为 Desktop 的 POST JSON 请求体加固定总字节上限；
- 超限请求返回稳定 `413`，不回显 body、路径或原始错误；
- 保持 malformed/empty/unknown-session 的既有状态语义；
- 更新 Desktop README 与 v0.1.7 candidate checklist。

**RED contract：**

- 新增 server contract：超过上限的 `POST /api/chat` 返回 `413`，且不会启动
  session run；
- 在 documentation contract 中断言 Desktop README 与 v0.1.7 candidate checklist
  记录请求体上限；
- 先确认 RED，再做最小实现。
- RED proof：临时把上限放大为 `Number.MAX_SAFE_INTEGER` 后，oversized body 契约
  返回 `400` 而非 `413`；文档契约此时为 **21 passed / 1 failed**。随后恢复
  `1 MiB` 并补文档。

**验收命令：**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
git diff --check
```

**边界：**

- 不改变 JSON DTO、session schema、validation/approval 语义或错误映射；
- 不新增 panel、导出入口、绝对路径、原始错误或视觉重设计；
- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`。

### Follow-up 目标 32：限制 Desktop 内存 session registry 数量

**Status:** DONE

**建立时间：** 2026-09-18；Goal 31 收口后最终审计发现 `sessionFor()` 会为
每个新 chat session id 建立并保留一个内存 session，没有固定 registry 上限。

**范围：**

- 为 Desktop 内存 session registry 设定固定的 `256` 个 session 总上限；
- 到达上限后，unknown session 的 chat 请求返回稳定 `429`，不创建新 session，
  也不启动 run；
- 保持默认 session、已有 session、重用 id、DELETE/rename 与 lifecycle 行为
  不变；
- 更新 Desktop README 与 v0.1.7 candidate checklist。

**RED contract：**

- 新增 server contract：用 injected fake session 填满 `256` 个总 entry 后，
  第 257 个 unknown chat id 返回 `429`，create/run 计数不再增长；
- 在 documentation contract 中断言 README 与 checklist 记录 session registry
  总上限；
- 先确认 RED，再做最小实现。
- RED proof：先因 helper 类型错误编译失败，改为现有测试的宽松 emit 类型后，
  新契约在无上限实现时返回 `200` 而非 `429`，聚焦运行为
  **107 passed / 1 failed**；文档契约为 **22 passed / 1 failed**。

**验收命令：**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

**边界：**

- 不配置用户可调上限，不增加 panel、导出入口、绝对路径、原始错误或视觉
  重设计；
- 不改变 chat/session DTO、validation/approval 语义或错误映射；
- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`。

**完成记录：**

- 已在 `sessionFor()` 加入固定 `256` 上限；registry 满员时 unknown chat 返回
  `429`，不调用 create/run；
- 已有 default/id session 在满员时仍可正常 chat，DELETE/rename 释放 registry
  entry 的既有行为未变；
- RED 后 Desktop focused tests **108/108**，documentation contract
  **23/23**；`pnpm verify` 输出 `all selected gates passed`，相关计数为
  runtime-manager **15/15**、CLI **314/314**、Rust unit/doc **54/54**、real
  Rust integration **11/11**；
- 未创建 tag、未 push、未发布 npm package、未创建 GitHub Release、未修改
  `~/.npmrc`。

### Follow-up 目标 33：限制 Desktop always-allow registry

**Status:** DONE

**建立时间：** 2026-09-18；Goal 32 收口后继续审计内存 registry，发现
每个 session 的 always-allow key `Set` 仍会随不同审批 key 无限增长，且单条
key 长度也没有上限。

**范围：**

- 为每个 Desktop session 的 always-allow registry 设定固定 `256` 条上限；
- 单条 allow key 超过 `512 UTF-8 bytes` 时只保留本次 allow，不写入 registry；
- 满员后新的 allow-always 请求仍允许本次工具调用，但不被记住；
- 已记住的 key 在满员后仍继续自动允许；
- 不改变 approval 请求/响应 DTO、UI 或 approval 语义；
- 更新 Desktop README 与 v0.1.7 candidate checklist。

**RED contract：**

- 新增 server contract：一次 chat run 内记住 `256` 个短 key 后，已有 key 无需
  再次审批；第 `257` 个 allow-always key 允许当前调用但不被记住，重复调用时
  再次产生 approval request；
- 新增 contract：超过 `512 bytes` 的 allow-always key 允许当前调用但不被
  记住；
- 先确认 RED，再做最小实现。
- RED proof：无上限实现时，entry-limit 契约记录 `257` 次而非 `258` 次审批
  请求，oversized-key 契约记录 `1` 次而非 `2` 次；聚焦运行为
  **108 passed / 2 failed**。文档契约为 **23 passed / 1 failed**。首次测试
  草稿因把 fake run 放在 server options 而不是 `session` 下编译失败，修正后
  才获得行为 RED。

**验收命令：**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

**边界：**

- 不配置用户可调上限，不新增 panel、导出入口、绝对路径、原始错误或视觉
  重设计；
- 不改变 rollback、validation、session lifecycle 或 HTTP DTO；
- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`。

**完成记录：**

- 已为每个 session 加入 `256` 条 always-allow key 上限和 `512 UTF-8 bytes`
  单 key 上限；
- 满员或 oversized key 的 allow-always 只允许当前调用；已记住的 key 仍自动
  允许；
- RED 后 Desktop focused tests **110/110**，documentation contract
  **24/24**；`pnpm verify` 输出 `all selected gates passed`，相关计数为
  runtime-manager **15/15**、CLI **314/314**、Rust unit/doc **54/54**、real
  Rust integration **11/11**；
- 未创建 tag、未 push、未发布 npm package、未创建 GitHub Release、未修改
  `~/.npmrc`。

### Follow-up 目标 34：限制 Desktop static file response 大小

**Status:** DONE

**建立时间：** 2026-09-18；Goal 33 收口后继续审计 Desktop 的资源边界，发现
`/public/` static response 会把整个文件读进内存，没有固定总字节上限。

**范围：**

- 为 `/public/` static file response 设定固定 `1 MiB` 总字节上限；
- 超过上限返回稳定 `413`，不回显路径、文件内容或原始错误；
- 现有 static asset 与 index 页面继续正常返回；
- 不改变 path traversal、missing/directory 的 `404` 语义；
- 更新 Desktop README 与 v0.1.7 candidate checklist。

**RED contract：**

- 新增 static-file contract：`/public/` 下一个超过 `1 MiB` 的文件返回 `413`；
- 在 documentation contract 中断言 README 与 checklist 记录 static response
  上限；
- 先确认 RED，再做最小实现。
- RED proof：无上限实现时，oversized static file 返回 `200`，新契约解析为
  HTML 内容时失败；聚焦运行为 **110 passed / 1 failed**。文档契约为
  **24 passed / 1 failed**。

**验收命令：**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

**边界：**

- 不配置用户可调上限，不流式扩展、缓存或重构 static serving；
- 不新增 panel、导出入口、绝对路径、原始错误或视觉重设计；
- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`。

**完成记录：**

- 已为 `/public/` static response 加入固定 `1 MiB` 上限；
- 超限响应返回稳定 `413`，不回显路径、内容或原始错误；
- missing/path-traversal `404` 语义保持不变；
- RED 后 Desktop focused tests **111/111**，documentation contract
  **25/25**；`pnpm verify` 输出 `all selected gates passed`，相关计数为
  runtime-manager **15/15**、CLI **314/314**、Rust unit/doc **54/54**、real
  Rust integration **11/11**；
- 首次全量验证只遇到一个 MCP 并发时序测试失败，未改动实现；单独重跑
  MCP suite 后 **63/63** 通过，随后完整 `pnpm verify` 通过；
- 未创建 tag、未 push、未发布 npm package、未创建 GitHub Release、未修改
  `~/.npmrc`。

### Follow-up 目标 35：限制 Desktop session ID 长度

**Status:** DONE

**建立时间：** 2026-09-18；Goal 34 收口后继续审计 session registry，发现
Desktop status 侧的安全展示逻辑已把 normalized session ID 截断到 `96`
字符，但 chat API 的 normalize/persist 路径没有长度边界，超长合法字符可
继续进入 registry 并形成过长的 memory filename。

**范围：**

- 在 Desktop server 的 session ID 请求路径上沿用 `96` 个 normalized
  characters 的固定上限；
- POST chat 使用超过上限的 normalized ID 时返回稳定 `400`，不创建
  registry entry，也不开始 run；
- 现有 `<= 96` 的 session ID、默认 ID、rename 和 lifecycle 行为不变；
- 更新 Desktop README 与 v0.1.7 candidate checklist。

**RED contract：**

- 新增 server contract：`97` 个合法 normalized characters 的 chat session ID
  返回稳定 `400`；RED 阶段证明它返回 SSE `200` 并把过长 ID 交给
  `createSession`；
- 新增 documentation contract：README 与 checklist 记录 `96` 字符 session ID
  上限；
- 先确认 RED，再做最小实现。
- RED proof：无上限实现时，超长 chat session ID 返回 SSE `200`，新契约在
  断言稳定 `400` 前失败，且过长 ID 已进入 `createSession`；聚焦运行为
  **111 passed / 1 failed**。文档契约为 **25 passed / 1 failed**。

**验收命令：**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

**边界：**

- 不配置用户可调上限，不重写 normalize、rename 或 registry；
- 不展示完整超长 ID，不新增绝对路径、原始错误或 UI 重设计；
- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`。

**完成记录：**

- 已在 Desktop request session ID 路径加入固定 `96` normalized characters
  上限；
- POST chat 超长 ID 返回稳定 `400`，不开始 run，也不创建 registry entry；
- 默认 session ID 与现有 `<= 96` 的 normalize/rename/lifecycle 行为保持；
- RED 后 Desktop focused tests **112/112**，documentation contract **26/26**；
  `pnpm verify` 输出 `all selected gates passed`，相关计数为 runtime-manager
  **15/15**、CLI **314/314**、Rust unit/doc **54/54**、real Rust integration
  **11/11**；
- 未创建 tag、未 push、未发布 npm package、未创建 GitHub Release、未修改
  `~/.npmrc`。

### Follow-up 目标 36：限制 Desktop session 列表扫描

**Status:** IN PROGRESS

**建立时间：** 2026-09-18；Goal 35 收口后继续审计 Desktop 的资源边界，发现
`GET /api/sessions` 会扫描并解析 session 目录里的每一个 `.json` 文件。内存
registry 已限制到 `256`，但磁盘上的历史文件数量没有固定列表上限。

**范围：**

- 为 `/api/sessions` 的磁盘 session summary 设定固定 `256` 条上限；
- active/default session 优先保留，再从稳定的文件名顺序补充磁盘 session；
- 返回列表总数不超过 `256`，不扫描或解析超过上限的额外磁盘文件；
- 现有普通目录的 list/history/audit/export 行为不变；
- 更新 Desktop README 与 v0.1.7 candidate checklist。

**RED contract：**

- 新增 server contract：目录中有 `300` 个合法 session 文件加一个 default
  session 时，列表总数为 `256`；
- RED 阶段证明当前实现返回 `301`，并读取所有磁盘 summary；
- 在 documentation contract 中断言 README 与 checklist 记录 session listing
  上限；
- 先确认 RED，再做最小实现。
- RED proof：无上限实现时，300 个磁盘 session 加 default 的列表返回 `301`；
  聚焦运行为 **112 passed / 1 failed**。文档契约为 **26 passed / 1 failed**。
  首次测试草稿因 fake session 类型签名编译失败，未计入行为 RED；改为显式
  default session 后获得上述行为 RED。

**验收命令：**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

**边界：**

- 不新增分页、可配置上限、绝对路径、原始错误或 UI 重设计；
- 不改变 session file schema、registry、rename 或 DELETE 行为；
- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`。

**完成记录：**

- 已为 Desktop session listing 加入固定 `256` 条上限；
- active/default session 保留在结果中，额外磁盘 summary 按稳定文件名顺序
  补足；
- RED 后 Desktop focused tests **113/113**，documentation contract **27/27**；
  `pnpm verify` 输出 `all selected gates passed`，相关计数为 runtime-manager
  **15/15**、CLI **314/314**、Rust unit/doc **54/54**、real Rust integration
  **11/11**；
- 未创建 tag、未 push、未发布 npm package、未创建 GitHub Release、未修改
  `~/.npmrc`。

### Follow-up 目标 37：限制 Desktop history 响应大小

**Status:** DONE

**建立时间：** 2026-09-18；Goal 36 收口后继续审计 Desktop 的读取路径，发现
`GET /api/sessions/<id>/messages` 会把完整 memory session 序列化成 JSON 后
直接返回，没有固定 response 字节上限。

**范围：**

- 为 Desktop history response 设定固定 `1 MiB` 总字节上限；
- 超过上限返回稳定 `413`，不回显 session 内容、路径或原始错误；
- 小型 history 的 messages/validations/changeSets/evidenceSummary 行为不变；
- 不限制 `/evidence` 已有的 audit limit 机制；
- 更新 Desktop README 与 v0.1.7 candidate checklist。

**RED contract：**

- 新增 server contract：session 文件序列化后超过 `1 MiB` 时，
  `/messages` 返回稳定 `413`；
- RED 阶段证明当前实现返回 `200` 并发送完整 transcript；
- 在 documentation contract 中断言 README 与 checklist 记录 history response
  上限；
- 先确认 RED，再做最小实现。
- RED proof：无上限实现时，超过 `1 MiB` 的 session transcript 返回 `200`
  并发送完整 JSON；聚焦运行为 **113 passed / 1 failed**。文档契约为
  **27 passed / 1 failed**。

**验收命令：**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

**边界：**

- 不新增分页、裁剪、可配置上限或 history schema 变更；
- 不回显绝对路径、文件内容或原始错误；
- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`。

**完成记录：**

- 已为 Desktop history response 加入固定 `1 MiB` 上限；
- 超限 transcript 返回稳定 `413`，不回显内容、路径或原始错误；
- 小型 history 的 messages/validations/changeSets/evidenceSummary 行为保持；
- RED 后 Desktop focused tests **114/114**，documentation contract **28/28**；
  `pnpm verify` 输出 `all selected gates passed`，相关计数为 runtime-manager
  **15/15**、CLI **314/314**、Rust unit/doc **54/54**、real Rust integration
  **11/11**；
- 未创建 tag、未 push、未发布 npm package、未创建 GitHub Release、未修改
  `~/.npmrc`。

### Follow-up 目标 38：约束 Desktop rename 生命周期

**Status:** DONE

**建立时间：** 2026-09-18；Goal 37 收口后继续审计 Desktop rename，发现
rename 只检查 source 是否在运行，没有检查 target 是否在运行，也没有把
source/target 在异步 rename 期间加入同一生命周期锁。同一 source 的并发
rename 可能一胜一败，rename 期间创建的 target run 也可能与文件移动竞争。

**范围：**

- rename 前检查 source 与 target 的 active lifecycle guard；
- 异步 rename 期间将 source 与 target 一并 fail-closed 锁定；
- rename 到 active target 返回稳定 `409`，不移动 source 文件；
- 同一 source 的并发 rename 不重复成功，输家返回稳定 `409`；
- 保持 idle rename、同名幂等、缺失 `404` 和目标冲突 `409` 行为不变；
- 更新 Desktop README 与 v0.1.7 candidate checklist。

**RED contract：**

- 新增 server contract：active target 存在时，将 idle source rename 到该
  target 返回 `409`；RED 阶段证明当前实现返回 `200` 并移动 source 文件；
- 新增 server contract：同一 source 的两个并发 rename 只有一个成功；RED
  阶段证明失败方不是稳定 `409`；
- 在 documentation contract 中断言 README 与 checklist 记录 rename target
  和并发锁定语义；
- 先确认 RED，再做最小实现。
- RED proof：无目标锁定实现时，active target 的 rename 返回 `200`；同源
  并发 rename 返回 `200/500`。聚焦全量运行为 **114 passed / 2 failed**。文档
  契约为 **28 passed / 1 failed**。

**验收命令：**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

**边界：**

- 不新增可配置锁数、分页、原始错误、绝对路径或 UI 重设计；
- 不改变 session file schema、DELETE、history、evidence 或 approval 行为；
- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`。

**完成记录：**

- 已将 rename 的 source lifecycle guard 提前到请求处理期；
- 已在 body 解析和文件移动期间同时锁定 source 与 target；
- active target rename 返回稳定 `409`，source 文件不移动；
- 并发同源 rename 的输家返回稳定 `409`，文件不会被复制或重复移动；
- 新的 unknown chat session 会先通过 active guard，不会在 rename 期间被
  提前注册到 target；
- RED 后 Desktop focused tests **114/114，2 failed**；文档契约为 **28/28，
  1 failed**。实现后 Desktop focused tests **116/116**，documentation
  contract **29/29**；`pnpm verify` 输出 `all selected gates passed`，相关
  计数为 runtime-manager **15/15**、CLI **314/314**、Rust unit/doc tests
  **54/54**、real Rust integration **11/11**；
- 未创建 tag、未 push、未发布 npm package、未创建 GitHub Release、未修改
  `~/.npmrc`。

### Follow-up 目标 39：限制 Desktop export 响应大小

**Status:** DONE

**建立时间：** 2026-09-18；Goal 38 收口后继续审计 Desktop 读取路径，发现
history 已有 `1 MiB` 上限，但 Markdown export 会把完整 session 渲染后直接
返回，没有固定 response 字节上限。

**范围：**

- 为 Desktop session Markdown export 设定固定 `1 MiB` 总字节上限；
- 超过上限返回稳定 `413`，不回显 transcript、路径或原始错误；
- 小型 export 的 Markdown transcript、evidence summary 与 filter 行为不变；
- 不改变 evidence audit 已有的 limit 机制；
- 更新 Desktop README 与 v0.1.7 candidate checklist。

**RED contract：**

- 新增 server contract：session 文件渲染为 Markdown 后超过 `1 MiB` 时，
  `/export` 返回稳定 `413`；RED 阶段证明当前实现返回 `200` 并发送完整
  transcript；
- 在 documentation contract 中断言 README 与 checklist 记录 export response
  上限；
- 先确认 RED，再做最小实现。
- RED proof：无上限实现时，超过 `1 MiB` 的 Markdown export 返回 `200`；
  聚焦运行为 **116 passed / 1 failed**。文档契约为 **29 passed / 1 failed**。

**验收命令：**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

**边界：**

- 不新增分页、裁剪、可配置上限或 export schema 变更；
- 不回显绝对路径、文件内容或原始错误；
- 不创建 tag、不 push、不发布 npm 包、不创建 GitHub Release、不修改
  `~/.npmrc`。

**完成记录：**

- 已为 Desktop Markdown export 加入固定 `1 MiB` response 上限；
- 超限 export 返回稳定 `413`，不回显 transcript、路径或原始错误；
- 小型 export 的 Markdown、filters 和 evidence summary 行为保持；
- RED 后 Desktop focused tests **116/116，1 failed**；文档契约为
  **29/29，1 failed**。实现后 Desktop focused tests **117/117**，
  documentation contract **30/30**；`pnpm verify` 输出
  `all selected gates passed`，相关计数为 runtime-manager **15/15**、CLI
  **314/314**、Rust unit/doc tests **54/54**、real Rust integration
  **11/11**；
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

## 七、夜跑后新增目标

### Follow-up 目标 40：约束 Desktop public 软链接边界

**Status:** DONE

**建立时间：** 2026-09-18 夜跑窗口结束后继续审计 Desktop 静态文件路径，
发现 `/public/` 只对 join 后的字符串做前缀检查。`public/` 内指向父目录
`package.json` 的 symlink 会被 `readFile` 跟随，越过真实 public 目录。

**范围：**

- `/public/` 内的 symlink 必须在解析真实路径后保持在真实 public 目录内；
- 逃逸或断链的 symlink 返回稳定 `404`，不返回目标文件内容或原始路径；
- 普通 static asset 与 `1 MiB` response limit 保持不变；
- 更新 Desktop README 与 v0.1.7 candidate checklist。

**RED contract：**

- 新增 server contract：`public/escape.tmp.json` 软链接到父目录
  `package.json` 时，请求返回 `404` 且不包含 package 元数据；
- 新增 server contract：`public/broken.tmp.js` 断链时返回稳定 `404`；
- 在 documentation contract 中断言 README 与 checklist 记录 symlink
  containment；
- 先确认 RED，再做最小实现。
- RED proof：无 realpath 守卫时，指向父目录 `package.json` 的 symlink 返回
  `200`；聚焦运行为 **118 passed / 1 failed**。文档契约为 **30 passed /
  1 failed**。

**完成记录：**

- 已为 `/public/` 同时解析 requested file 和 publicDir 的 real path；
- real path 越出真实 public 目录或断链的 symlink 返回稳定 `404`；
- RED 后 Desktop focused tests **118/118，1 failed**；文档契约为
  **30/30，1 failed**。实现后 Desktop focused tests **119/119**，
  documentation contract **31/31**；
- `pnpm verify` 输出 `all selected gates passed`，相关计数为 runtime-manager
  **15/15**、CLI **314/314**、Rust unit/doc tests **54/54**、real Rust
  integration **11/11**；
- 普通 static asset 与 `1 MiB` static response limit 保持不变；
- 未创建 tag、未 push、未发布 npm package、未创建 GitHub Release、未修改
  `~/.npmrc`。

### Follow-up 目标 42：约束 Desktop change-set ID 长度

**Status:** DONE

**建立时间：** 2026-09-18 夜跑窗口结束后继续审计 Desktop 请求边界，发现
`POST /api/changesets/validate` 和 `POST /api/changesets/rollback` 只对
`changeSetId` 做 trim 和非空校验，没有固定长度上限。真实 change-set ID 是
UUID，保守上限沿用 session ID 的 `96` 字符。

**范围：**

- `changeSetId` trim 后必须少于或等于 `96` 字符；
- validate 和 rollback 对超长 ID 返回稳定 `400`：
  `changeSetId is too long`；
- 超长请求不得进入 fake 或真实 session 的 `rerunValidation` /
  `rollbackChangeSet` 方法；
- 正常 UUID 与现有 lifecycle、错误映射和响应 schema 不变；
- 更新 Desktop README 与 v0.1.7 candidate checklist。

**RED contract：**

- 新增 server contract：validate 发送 97 字符 ID 时返回 `400`，fake
  `rerunValidation` 不被调用；RED 阶段证明当前实现会调用该方法；
- 新增 server contract：rollback 发送 97 字符 ID 时返回 `400`，fake
  `rollbackChangeSet` 不被调用；RED 阶段证明当前实现会调用该方法；
- 在 documentation contract 中断言 README 与 checklist 记录 change-set ID
  上限；
- 先确认 RED，再做最小实现。
- RED proof：无长度上限时，validate 和 rollback 都返回 `200` 并调用 fake
  session 方法；聚焦运行为 **120 passed / 2 failed**。文档契约为
  **32 passed / 1 failed**。

**完成记录：**

- 已为 validate 和 rollback 加入 trim 后 `96` 字符的固定 `changeSetId`
  上限；
- 超长 ID 返回稳定 `400` 与 `changeSetId is too long`；
- 超长请求在进入 session 的 `rerunValidation` 或 `rollbackChangeSet` 前返回；
- 正常 UUID、错误映射、active lifecycle 和响应 schema 保持不变；
- RED 后 Desktop focused tests **120/120，2 failed**；文档契约为
  **32/32，1 failed**。实现后 Desktop focused tests **122/122**，
  documentation contract **33/33**；
- `pnpm verify` 输出 `all selected gates passed`，相关计数为 runtime-manager
  **15/15**、CLI **314/314**、Rust unit/doc tests **54/54**、real Rust
  integration **11/11**；
- 未创建 tag、未 push、未发布 npm package、未创建 GitHub Release、未修改
  `~/.npmrc`。

**验收命令：**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

**边界：**

- 不新增可配置上限、输入 schema 变更、分页或 UI 重设计；
- 不回显 ID 内容、路径、文件内容或原始错误；
- 不创建 tag、不 push、不发布 npm package、不创建 GitHub Release、不修改
  `~/.npmrc`。

### Follow-up 目标 43：约束 Desktop evidence 查询过滤器

**Status:** DONE

**建立时间：** 2026-09-18 Goal 42 收口后继续审计 Desktop 读路径，发现
`changeSetId` 和 `validationId` 作为查询过滤器时仍只做 trim 和非空校验，
没有与写路径一致的固定长度上限。真实 validation 和 change-set ID 都远小于
`96` 字符，可以沿用同一个保守上限。

**范围：**

- `/messages`、`/export`、`/evidence` 和 `/evidence/preview` 共用的
  `changeSetId` / `validationId` query filter trim 后必须少于或等于 `96`
  字符；
- 超长过滤器返回稳定 `400`，不回显过滤器内容；
- 超长过滤器不进入 evidence selection，返回的 validations/changeSets 为空；
- 正常 ID 过滤、status 过滤、audit limits、响应上限和 metadata-only 边界
  保持不变；
- 更新 Desktop README 与 v0.1.7 candidate checklist。

**RED contract：**

- 新增 server contract：history 发送 97 字符 `changeSetId` 时返回 `400`；
  RED 阶段证明当前实现返回 `200`；
- 新增 server contract：evidence audit 发送 97 字符 `validationId` 时返回
  `400`；RED 阶段证明当前实现返回 `200`；
- 在 documentation contract 中断言 README 与 checklist 记录 evidence query
  filter 上限；
- 先确认 RED，再做最小实现。
- RED proof：无查询过滤器上限时，history 与 evidence audit 对 97 字符
  `changeSetId` / `validationId` 返回 `200`；聚焦运行为
  **122 passed / 2 failed**。文档契约为 **33 passed / 1 failed**。

**完成记录：**

- 已在共享 evidence filter parser 中为 `changeSetId` 和 `validationId` 加入
  trim 后 `96` 字符固定上限；
- `/messages`、`/export`、`/evidence` 和 `/evidence/preview` 都使用同一
  parser；
- 超长过滤器返回稳定 `400`，不回显过滤器内容，也不进入 evidence selection；
- 正常过滤、status 过滤、audit limits、response limits 和 metadata-only
  边界保持不变；
- RED 后 Desktop focused tests **122/122，2 failed**；文档契约为
  **33/33，1 failed**。实现后 Desktop focused tests **124/124**，
  documentation contract **34/34**；
- `pnpm verify` 输出 `all selected gates passed`，相关计数为 runtime-manager
  **15/15**、CLI **314/314**、Rust unit/doc tests **54/54**、real Rust
  integration **11/11**；
- 未创建 tag、未 push、未发布 npm package、未创建 GitHub Release、未修改
  `~/.npmrc`。

**验收命令：**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

**边界：**

- 不新增可配置上限、分页、裁剪或 UI 重设计；
- 不改变 audit limit 语义、history schema 或 evidence DTO；
- 不回显绝对路径、文件内容、过滤器内容或原始错误；
- 不创建 tag、不 push、不发布 npm package、不创建 GitHub Release、不修改
  `~/.npmrc`。

### Follow-up 目标 44：约束 Desktop approval ID 长度

**Status:** DONE

**建立时间：** 2026-09-18 Goal 43 收口后继续审计 Desktop 输入边界，发现
`POST /api/approval` 接受任意长度的 `id` 字符串后直接进入 approvals 查找。
真实 approval ID 是 UUID，保守上限沿用已有 ID 边界的 `96` 字符。

**范围：**

- `/api/approval` 的 `id` 必须少于或等于 `96` 字符；
- 超长 ID 返回稳定 `400` 与 `approval id is too long`；
- 超长请求不进入 approvals map 查找，也不会 resolve 任何 approval；
- 正常 UUID、decision 校验、404、allow/deny/allow-always 行为不变；
- 更新 Desktop README 与 v0.1.7 candidate checklist。

**RED contract：**

- 新增 server contract：发送 97 字符 approval ID 时返回 `400`；RED 阶段
  证明当前实现返回 `404 unknown approval request`；
- 在 documentation contract 中断言 README 与 checklist 记录 approval ID
  上限；
- 先确认 RED，再做最小实现。
- RED proof：无长度上限时，97 字符 approval ID 返回 `404 unknown approval
  request`；聚焦运行为 **124 passed / 1 failed**。文档契约为
  **34 passed / 1 failed**。

**完成记录：**

- 已为 `/api/approval` 加入固定 `96` 字符 ID 上限；
- 超长 ID 在 approvals map 查找前返回稳定 `400` 与 `approval id is too
  long`；
- 正常 UUID、decision 校验、404、allow/deny/allow-always 行为保持不变；
- RED 后 Desktop focused tests **124/124，1 failed**；文档契约为
  **34/34，1 failed**。实现后 Desktop focused tests **125/125**，
  documentation contract **35/35**；
- `pnpm verify` 输出 `all selected gates passed`，相关计数为
  runtime-manager **15/15**、CLI **314/314**、Rust unit/doc tests
  **54/54**、real Rust integration **11/11**；
- 未创建 tag、未 push、未发布 npm package、未创建 GitHub Release、未修改
  `~/.npmrc`。

**验收命令：**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

**边界：**

- 不新增可配置上限、approval schema 变更或 UI 重设计；
- 不回显 ID 内容、路径、文件内容或原始错误；
- 不改变 approval timeout、disconnect deny 和 postimage guard；
- 不创建 tag、不 push、不发布 npm package、不创建 GitHub Release、不修改
  `~/.npmrc`。

### Follow-up 目标 45：约束 Desktop JSON body 对象形态

**Status:** DONE

**建立时间：** 2026-09-18 Goal 44 收口后继续审计 Desktop 请求边界，发现
多数 POST 接口 `JSON.parse` 后直接读取字段，JSON `null` 会抛出 TypeError
并被外层错误处理转为 `500`；cleanup 已拒绝非对象，但行为不统一。

**范围：**

- 所有 POST JSON endpoint 在读取字段前校验 body 是 JSON object；
- JSON `null`、数组、字符串和数值返回稳定 `400` 与
  `request body must be a JSON object`；
- malformed JSON 仍返回 `400 request body must be valid JSON`；
- 正常对象、sessionId/message/changeSetId/approval ID 校验和 lifecycle
  保持不变；
- 更新 Desktop README 与 v0.1.7 candidate checklist。

**RED contract：**

- 新增 server contract：向 `/api/chat`、`/api/chat/cancel`、
  `/api/changesets/validate`、`/api/changesets/cleanup`、
  `/api/changesets/rollback`、`/api/approval` 和 rename endpoint 发送 JSON
  `null` 时统一返回 `400`；
- 在 documentation contract 中断言 README 与 checklist 记录 non-object
  JSON body 的 `400` 行为；
- 先确认 RED，再做最小实现。
- RED proof：无统一 object 校验时，JSON `null` body 返回 `500`；聚焦运行
  为 **125 passed / 1 failed**。文档契约为 **35 passed / 1 failed**。

**完成记录：**

- 已新增共享 `parseJsonObjectBody` helper，七处 POST JSON route 统一解析
  和校验；
- JSON `null`、数组、字符串和数值在读取字段前返回稳定 `400` 与
  `request body must be a JSON object`；
- malformed JSON 保持 `400 request body must be valid JSON`；
- 正常对象、ID/message 校验、1 MiB body limit 和 lifecycle 保持不变；
- RED 后 Desktop focused tests **125/125，1 failed**；文档契约为
  **35/35，1 failed**。实现后 Desktop focused tests **126/126**，
  documentation contract **36/36**；
- 未创建 tag、未 push、未发布 npm package、未创建 GitHub Release、未修改
  `~/.npmrc`。

**验收命令：**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

**边界：**

- 不新增可配置 schema、DTO 变更、裁剪或 UI 重设计；
- 不回显 body 内容、路径、文件内容或原始错误；
- 不改变 JSON body 1 MiB 上限、approval timeout、disconnect deny 和
  postimage guard；
- 不创建 tag、不 push、不发布 npm package、不创建 GitHub Release、不修改
  `~/.npmrc`。

### Follow-up 目标 46：刷新 Desktop candidate 的只读 preflight 证据

**Status:** DONE

**建立时间：** 2026-09-18 Goal 45 收口后继续审计，当前没有新的请求边界
缺口；改为做 release readiness 只读复核，确认安全收口没有改变
candidate 元数据。

**范围：**

- 运行 `pnpm release:preflight`；
- 记录 candidate `0.1.7`、published registry `0.1.6`、authenticated npm
  identity 和五个 candidate package files；
- 更新 v0.1.7 candidate checklist 与 progress 记录；
- 明确 preflight 只是 readiness evidence，不是 release authorization。

**RED contract：**

- 在 documentation contract 中新增唯一的 `post-goal-46 release preflight
  refresh` 断言；
- 先确认缺失该记录时契约失败，再补充 checklist。
- RED proof：无 post-goal-46 记录时 documentation contract 为
  **36 passed / 1 failed**。

**验收命令：**

```sh
pnpm release:preflight
node --test tests/documentation-contract.test.mjs
git diff --check
```

**边界：**

- 不修改实现、package version 或 release state；
- 不创建 tag、不 push、不发布 npm package、不创建 GitHub Release、不修改
  `~/.npmrc`。

### Follow-up 目标 47：忽略 Desktop diagnostic report 文件

**Status:** DONE

**建立时间：** 2026-09-18 Goal 46 收口后检查工作区，发现 Node 生成的
`apps/desktop/report.*.json` 一直是未跟踪文件，存在误暂存风险。

**范围：**

- 为 `apps/desktop/report.*.json` 增加 root `.gitignore` 规则；
- 保留已存在的临时 report 文件，不读取内容、不提交、不删除；
- 用 documentation contract 锁定该 ignore 边界。

**RED contract：**

- 新增 `Desktop diagnostic reports are ignored` documentation contract；
- RED proof：无 `.gitignore` 规则时 documentation contract 为
  **37 passed / 1 failed**。

**验收命令：**

```sh
node --test tests/documentation-contract.test.mjs
git status --short --branch
git diff --check
```

**边界：**

- 不修改实现或 release state；
- 不提交任何 diagnostic report；
- 不创建 tag、不 push、不发布 npm package、不创建 GitHub Release、不修改
  `~/.npmrc`。
