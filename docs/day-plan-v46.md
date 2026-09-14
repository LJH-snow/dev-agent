# Day plan v46：preview 跨宿主 parity 与 Desktop query 语义收敛

**建立日期：2026-09-14**

> 本计划承接 `docs/day-plan-v45.md`。v45 用受控 benchmark 证明当前完整 preview
> projection 在 record/file cap 边界内没有 concrete availability gap，因此没有新增
> preview hard cap。v46 只处理仍有证据价值的跨宿主 contract parity 与 Desktop query
> 语义；没有兼容性证据时不收紧参数，不发布 schema v2。

## Goal

用同一份持久化 metadata-only evidence fixture 验证 agent-core、CLI 和 Desktop 的
preview counts、file count、canonical UTF-8 `serializedBytes` 与敏感字段边界完全一致，
并把 v44 保留的 Desktop unknown/duplicate/empty query 语义从“暂保留”推进到有测试和
明确决策。优先增加 regression evidence；只有发现真实 parity 或输入处理 proof gap 时
才做最小 runtime 修复。

## Questions

- 同一 session memory 在 CLI `--preview-evidence` 与 Desktop
  `/api/sessions/<id>/evidence/preview` 是否返回相同的 v1 projection counts/bytes？
- CLI 与 Desktop 的 filter selection 是否对 `changeSetId`、`validationId`、`status`
  保持相同的空值、未知值和编码语义？
- Desktop `URLSearchParams.get()` 的重复值取第一个、空值按未提供、未知 query 忽略，是否
  已被客户端/历史 endpoint 的既有行为依赖？若没有兼容证据，是否仍应 preserve？
- generic error、unknown session、audit-limit rejection 是否跨宿主保持 metadata-only，
  且不会把 preview 变成 execution、validation、restore 或 Undo authority？

## Global constraints

- 不改变 `EvidenceAuditPreview` v1 success allowlist、canonical serializer、v41 export
  limits 或 CLI operation exclusivity。
- 不新增 partial、cursor、pagination、schema v2、before-image、patch、diff、file bytes
  或跨进程 Undo；不把 preview bytes/digest 当作执行或恢复授权。
- parity fixture 只包含 synthetic metadata；不读 workspace、不初始化 provider、不进入 chat
  queue、不写 session memory，除非某个 focused integration test 明确需要读取既有 fixture。
- 任何 runtime 改动都必须先写 RED test；如果 tests 只证明 preserve，则只提交测试、决策
  文档和最小使用说明。
- 错误响应只允许稳定 generic metadata；不得回显 persisted command、args、cwd、output、
  error、diff、patch、file contents 或绝对 working-directory。

## Task 0：冻结 v45 基线与 parity fixture

**Produces:** 可复用的跨宿主 fixture、字段 allowlist 和 query decision matrix。

- [ ] **Step 1: 记录 v45 基线。** 固化六个 benchmark bytes/counts、v41 cap decision、
  v45 NO-GO 结论和当前 CLI/Desktop preview routes。
- [ ] **Step 2: 设计同一份 session fixture。** 同时覆盖未过滤、change-set filter、
  validation filter、status filter、UTF-8 ids/paths、空 evidence 和损坏 evidence；明确
  fixture 的 session id 不跨 test 污染。
- [ ] **Step 3: 写 parity allowlist 与 query matrix。** 把 success、unknown session、
  malformed memory、audit-limit query、duplicate/empty/unknown query 的预期状态、
  response keys 和 side-effect invariants 写入文档。

## Task 1：跨宿主 preview parity regression

**Produces:** core/CLI/Desktop 的可重复 parity tests；优先不改 runtime。

- [ ] **Step 1: 先写 RED tests。** 让同一 fixture 通过 CLI 与 Desktop，比较 schema version、
  counts、file count、canonical bytes 和 generic error；旧实现若有差异先失败。
- [ ] **Step 2: 实现最小共享 harness 或 fixture loader。** 不复制 serializer，不在宿主层
  计算 bytes；只复用 core preview 与现有 memory boundary。
- [ ] **Step 3: 回归敏感字段与 side effect。** 证明 preview 不改变 memory 文件、工作区，
  不启动 provider/MCP/chat queue，不输出 evidence 内容。

## Task 2：Desktop query semantics decision（条件执行）

**Produces:** 明确 preserve/reject 决策；只有 proof gap 才改 parser。

- [ ] **Step 1: 对 unknown/duplicate/empty/encoded query 做兼容性证据。** 对比 history/export
  endpoint 与现有客户端调用方式；不得凭理论风险直接 reject。
- [ ] **Step 2: 若发现明确 bug，先写 RED，再最小修复。** 错误状态/消息须 metadata-only，
  filters 不得改变 session 选择；若无 bug，保留当前 `get()` first/empty-as-absent/
  unknown-ignore 语义并记录理由。
- [ ] **Step 3: 形成 decision。** preserve 为默认；query tightening 仅在真实 proof gap
  下 GO，否则 CONDITIONAL/NO-GO，不引入版本协商。

## Task 3：验证、发布和下一阶段

**Produces:** v46 parity decision、发布提交和下一份有边界的计划。

- [ ] **Step 1: focused/full verification。** 新增 focused parity/query tests；再跑 TypeScript、
  Rust、integration、report、structure 和 diff check。
- [ ] **Step 2: 更新 README、CHANGELOG、progress 和 decision matrix。** 清楚区分 tests-only
  evidence 与实际 runtime 修复。
- [ ] **Step 3: commit/push 并制定 v47。** 保持 `origin/main` 可复现；若无 runtime proof gap，
  v47 只选择新的真实产品需求，不继续堆 speculative preview semantics。

## Acceptance checklist

- [ ] 同一 evidence fixture 的 core/CLI/Desktop preview counts/bytes parity 有自动化证据。
- [ ] success/error/unknown-session response 均保持 metadata-only allowlist。
- [ ] duplicate/empty/unknown/encoded query 有明确 preserve 或 reject decision，并有兼容性
  依据；没有 silent session selection 变化。
- [ ] v41 export caps、v1 export、pagination/schema v2、before-image/cross-process Undo
  boundaries remain intact.
