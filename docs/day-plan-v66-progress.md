# v66 开发进度：CLI / Desktop 终端历史与工作台可靠性

> 最后更新：2026-09-24（Asia/Shanghai）

## 当前状态

- 排程文档已建立：`docs/day-plan-v66.md`。
- canonical 持久化工作文件已建立在：`.planning/2026-09-24-ten-hour-dev-sprint/`。
- 当前分支 `codex/desktop-cli-workbench` 以 `737b5ed` 为本轮基线；terminal hardening 已在
  `95c1d91` 提交，read-only project capability 已在 `a52680f` 提交并推送到 GitHub。
- 本轮已修改 CLI/Desktop 源码、测试和计划文档；`.playwright-cli/`、`output/` 与重复计划目录仍为本地未跟踪产物。
- metadata-only observability 已提交为 `7d2331a feat: add metadata-only capability observability`，并推送到 GitHub。
- 本次新增只读项目能力面板：Git branch/dirty/remote host、GitHub 显式 opt-in、GitHub Actions 最近一次运行状态与 monitoring 投影；所有 mutation 仍 fail-closed。
- 新增 metadata-only observability：trusted tool capability class、authorization result、terminal/preview lifecycle；单一 trace schema，不记录 prompt、路径、URL、凭据或 raw error。

## 证据账本

| 阶段 | 状态 | 证据 |
|---|---|---|
| 基线与排程 | 已完成 | canonical plan、分支/远程审计与边界记录 |
| CLI 滚动/历史 | 已完成 | CLI 630/630；真实 CLI PTY launch/exit smoke 已完成 |
| Desktop 命令历史 | 已完成 | Desktop 232/232；隔离浏览器 terminal 验收已完成 |
| Desktop 输出滚动 | 已完成 | manual follow-latest contract 与隔离浏览器 terminal surface 验收已覆盖 |
| capability token | 已完成本轮范围 | 生产 launcher、`/api/` mutation guard、served HTML 注入、token tests |
| 会话恢复/维护审计 | 延后 | 不在本轮已提交范围内 |
| 全量门禁/推送 | 已完成本轮范围 | agent-core 212/212、Desktop 232/232、build/typecheck、diff check；`7d2331a` 已推送 |
| 隔离浏览器验收 | 已完成 | 临时 Git fixture；capability cards、terminal command、loopback preview、single lifecycle trace |

## 操作规则

- 每次修改后先跑最小 focused test，再扩大验证范围。
- 若发现安全边界不清晰，保留 fail-closed 行为并记录 findings，不为了功能通过而放宽边界。
- 临时截图、下载和 Playwright 日志继续留在未跟踪目录，不加入 Git。

## 2026-09-24 12:56 — CLI scroll and Desktop terminal history/output progress

- CLI viewport audit confirmed the existing PageUp/PageDown/Home/End behavior,
  mouse parser, startup size normalization, and one-row render guard. Added a
  bounded `scrollBy()` path so mouse-wheel events move three wrapped rows rather
  than jumping an entire page; keyboard page navigation remains unchanged.
- CLI verification after the change: **630/630** tests passed, including Ink
  long-transcript navigation, mouse-wheel interaction, terminal scrollback
  preservation, and the new viewport regression.
- Desktop task terminal now has a session-local `TerminalCommandHistory` with a
  64-entry / 4096-character bound, duplicate suppression, draft restoration,
  and ↑/↓ recall for single-line commands. It intentionally does not use
  browser storage because commands can contain secrets.
- Desktop output now preserves a user's manual scroll position while new output
  arrives and exposes an explicit `Follow latest` control. Clear/reconnect,
  session changes, and new runs return to follow-latest mode.
- Desktop verification after these changes: **223/223** tests passed, including
  the new command-history regression and HTML/controller safety contracts.


## 2026-09-24 13:05 — Desktop capability boundary tranche

- 生产 `startDesktopEntry()` 路径现在启用 server-scoped capability token；token 只注入根 HTML 文档，浏览器通过统一 `fetch` seam 为同源 mutation 请求添加 header。
- `terminal` 与 `workspace` mutation 先行受保护；loopback、origin、read-only metadata 约束保持不变。默认 `createDesktopServer()` 仍保持未启用，避免测试/embedding host 在未选择边界时被隐式改变。
- token 使用常量时间比较，缺失/错误 token 返回稳定 403，不回显 token；served HTML 会替换占位符。
- 新增 capability-token focused regression：页面注入、缺失/错误 token 拒绝、正确 token 允许 terminal start；当前 focused tests 通过。
- 仍待完成：把 capability 边界扩展到其余 Desktop mutation 路由前，先统一测试请求 helper；补 terminal canonical cwd/lifecycle cleanup 和 full verification。


## 2026-09-24 13:22 — capability token and release-gate evidence

- 修复 task-workspace 测试在 capability guard 开启后缺少 mutation header 的问题；
  Desktop 全量测试最终为 **224/224**。
- CLI 全量测试为 **630/630**；Desktop build/typecheck、workspace build/typecheck、
  TypeScript release gate、CLI package smoke、preview/documentation/native contracts
  与 `git diff --check` 均通过。
- `startDesktopEntry()` 生产路径开启 server-scoped capability token；所有 `/api/`
  mutation 统一受保护，GET metadata 保持只读和 loopback 约束。
- 本轮未宣称 terminal canonical cwd/lifecycle、浏览器手工验收和 PTY 手工验收完成；
  它们保留在后续 sprint。
- 下一步：只 stage 预期源代码、测试和文档，排除本地 QA 产物，然后 commit/push。



## 2026-09-24 — read-only project capability panel

- Desktop workbench metadata now exposes only bounded Git repository metadata：branch、dirty state、changed-file count、remote host/provider；不会返回 remote path、credential、文件内容或工作目录路径。
- GitHub capability remains explicit opt-in via `DEV_AGENT_DESKTOP_GITHUB=1`；`gh auth status` 与 `gh run list --limit 1` 仅用于只读状态，`mutationAllowed` 在实际 probe 和 HTTP normalizer 中均固定为 `false`。
- UI 新增 GitHub、CI、Repository、Remote cards，并区分 opt-in required、unauthenticated、CLI unavailable、unsupported、no runs 等状态；monitoring 继续声明 `readOnly`、`canApprove: false`、`canMutate: false`。
- Git/GitHub 输出和 custom-host metadata 均有大小、枚举、host、branch、secret/path 过滤；in-progress CI runs 保留 `conclusion: unknown`，不会被误报为 malformed。
- Desktop 全量测试更新为 **230/230**；build、typecheck 与 `git diff --check` 通过。浏览器/真实 PTY 手工验收与 authorization trace 仍未完成。

## 2026-09-24 — Desktop terminal execution hardening

- terminal cwd 现在在 spawn 前使用 `lstat`/`realpath` canonicalize；缺失、文件和最终
  symlink 路径均拒绝，POSIX shell 额外用 `pwd -P` guard 防止校验后重定向。
- session 删除会先停止其 terminal processes；停止流程支持 process-group `SIGTERM`
  到 `SIGKILL` escalation；运行 terminal 时拒绝 session rename。
- command summary/system metadata 会脱敏 token、Bearer、私钥和 credential-shaped 值；
  stdin event 仅保留 `[input N bytes]`，不再保存原始输入。
- 最新 Desktop focused suite：**227/227**；Desktop build/typecheck 与 `git diff --check`
  通过。浏览器/PTY 手工验收以及 read-only capability panel、Git metadata 和
  authorization trace 仍未完成。
- `.playwright-cli/`、`output/` 与 `.planning/2026-09-24-ten-hour-development/`
  继续保持未跟踪，不纳入提交。


## 2026-09-24 — delivery

- 已将 terminal execution hardening 与 canonical 计划/文档提交为
  `95c1d91 feat: harden desktop terminal lifecycle`。
- 已成功推送到 `origin/codex/desktop-cli-workbench`；本地仅保留未跟踪 QA/重复计划目录，
  未纳入提交。

## 2026-09-24 — capability panel delivery

- 已将只读项目能力面板、Git/GitHub bounded metadata、CI 状态与 custom-host normalization 提交为 `a52680f feat: expose read-only project capabilities`。
- 已推送到 `origin/codex/desktop-cli-workbench`；push 前验证 Desktop **230/230**、build、typecheck、`git diff --check`。
- 未跟踪的 `.playwright-cli/`、`output/` 与重复计划目录继续排除；浏览器/真实 PTY 验收、authorization trace 仍是后续工作。


## 2026-09-24 — metadata-only observability

- AgentRunTrace now projects only trusted tool-registry risk metadata and
  allowlisted authorization outcomes. Plan-mode denials are represented as
  `deny`; arbitrary runtime payloads are ignored.
- Terminal and preview lifecycle events are bounded enum metadata in the existing
  session trace. Terminal manager callbacks and the preview route are guarded so
  observability cannot change execution behavior.
- The overlapping untracked Desktop capability-trace registry and duplicate
  lifecycle endpoint were removed; the shared `AgentRunTrace` remains the single
  trace source.
- Verification: agent-core **212/212**, Desktop **232/232**, package builds,
  Desktop typecheck, and `git diff --check` pass. Browser/real-PTY acceptance is
  still pending and QA artifacts remain excluded.


## 2026-09-24 — metadata-only observability delivery

- 已将共享 `AgentRunTrace` 的 capability class、authorization result、
  terminal/preview lifecycle 与相应回归测试提交为
  `7d2331a feat: add metadata-only capability observability`。
- 已推送到 `origin/codex/desktop-cli-workbench`。提交前验证 agent-core **212/212**、
  Desktop **232/232**、build、typecheck 与 `git diff --check`。
- 浏览器/真实 PTY 验收仍未完成；`.playwright-cli/`、`output/` 与重复计划目录继续排除。


## 2026-09-24 — isolated browser acceptance

- 使用临时 Git fixture 而非真实项目工作区启动 Desktop。浏览器确认 Repository、
  Remote、GitHub、CI metadata cards 的只读状态，并执行真实 task-terminal command。
- 通过 loopback HTTP preview 加载并清除 iframe；Runtime trace 最终显示单一
  `Terminal: started/completed` 与 `Preview: started/loaded`，未显示 prompt、tool
  payload、路径、URL 或 secret。
- 浏览器验收发现 UI 与 server 重复记录 terminal lifecycle，以及 stale iframe
  event 可能制造 false preview failure；已修复并通过 targeted Desktop **39/39**、
  build 与 `git diff --check`。
- CLI 外部真实 PTY 手工验收仍为后续项；临时 server/browser 已停止，QA 目录继续排除。


## 2026-09-24 — lifecycle trace fix delivery

- 已将浏览器验收发现的 terminal lifecycle duplicate 与 stale iframe event 修复提交为
  `e148abb fix: deduplicate desktop lifecycle trace events`，并推送到
  `origin/codex/desktop-cli-workbench`。
- 修复后 targeted Desktop **39/39** 通过；最新浏览器 trace 显示单一 terminal
  start/completed 与 preview start/loaded。CLI 外部真实 PTY 仍待后续。


## 2026-09-24 — CLI PTY smoke acceptance

- 在隔离临时 `HOME` 下构建并启动真实 CLI pseudo-terminal，确认 Ink Signal Loom
  banner、provider/model metadata、PageUp/PageDown 提示、composer、status footer
  和 Ctrl-C clean exit 均正常。
- 捕获内容没有 startup `ESC[2J`、`ESC[3J`、`ESC[H` 清屏序列，说明启动不会清掉
  terminal scrollback。长 transcript 的交互式 PageUp/PageDown 仍以既有自动化 Ink
  测试为主要证据，外部 provider-backed PTY 回放仍待后续。


## 2026-09-24 — provider-backed CLI PTY acceptance

- 使用本地 fixture Ollama endpoint（通过 `DEV_AGENT_CONFIG_FILE`，不使用外部
  provider 或 credential）启动真实 CLI PTY。CLI 接收 `hello`，渲染长 streamed
  transcript，并接收 PageUp/PageDown escape input 后由 Ctrl-C clean exit。
- capture 没有 startup `ESC[2J`、`ESC[3J`、`ESC[H`；自动化 Ink viewport tests
  继续验证具体 scroll offset 和 mouse-wheel semantics。
- 终端滚动/历史与 Desktop 浏览器验收范围已完成；下一阶段转向 session recovery
  与 maintenance audit。

## 2026-09-24 — session recovery / maintenance audit

- 完成 Desktop session rename/delete/reload seam 审计：发现 pending plan、approval
  allowlist 与 run replay 等内存态没有和持久化 session id 完整绑定。
- 修复删除/服务器关闭时的 bounded runtime cleanup，并在 rename 时迁移可继续执行的
  pending plan 与 allowlist；rename 后立即 materialize 新 session，避免必须先刷新或
  发送新消息才能继续 apply。
- 新增 rename 后继续 apply pending plan 的回归测试；Desktop suite **233/233**、build
  与 `git diff --check` 均通过。

## 2026-09-24 — active session recovery boundary

- 修复 rename/delete 后的 active session stale id：服务端会更新 active-session pointer，
  `/api/sessions` 在删除后从现存持久化 session 选择安全 fallback，省略 `sessionId` 的
  请求也不再回到旧 default。
- 增加 active-session response 回归断言；Desktop **233/233**、build 与
  `git diff --check` 均通过。

## 2026-09-24 — active-session fallback regression

- 增加删除 active session 后从剩余持久化 session 选择 fallback 的端到端回归测试；
  Desktop suite 已提升至 **234/234**，build 与 `git diff --check` 通过。
