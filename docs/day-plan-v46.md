# Day plan v46：preview 跨宿主 parity 与 Desktop query 语义收敛

**建立日期：2026-09-14**

**状态：Task 0--2 完成；跨宿主 parity 已通过，Desktop query 结论为 Preserve / tests-only。**

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

- [x] **Step 1: 记录 v45 基线。** 固化六个 benchmark bytes/counts、v41 cap decision、
  v45 NO-GO 结论和当前 CLI/Desktop preview routes。
- [x] **Step 2: 设计同一份 session fixture。** 覆盖未过滤、change-set filter、validation
  filter、status filter、UTF-8 ids/paths、空 evidence/错误边界；session id 与 workspace
  均为临时值，不跨 test 污染。
- [x] **Step 3: 写 parity allowlist 与 query matrix。** success、unknown session、
  audit-limit query、duplicate/empty/unknown/encoded query 和 side-effect invariants
  已记录于 `docs/evidence-preview-parity-v46.md`。

## Task 1：跨宿主 preview parity regression

**Produces:** core/CLI/Desktop 的可重复 parity tests；优先不改 runtime。

- [x] **Step 1: 先写 parity regression tests。** `tests/evidence-preview-parity.test.mjs`
  让同一 fixture 通过 CLI 与 Desktop，比较 schema version、counts、file count、canonical
  bytes；当前实现直接 GREEN，证明 preserve contract 没有 parity gap。
- [x] **Step 2: 实现最小测试 harness 与 fixture loader。** `pnpm test:preview-parity` 只
  构建既有 packages/apps 并使用 core/FileMemory；没有复制 serializer，也没有在宿主层
  计算 bytes。
- [x] **Step 3: 回归敏感字段与 side effect。** 证明 memory/workspace 不变、provider 未加载、
  Desktop fake session 不运行，且 response 不输出 evidence 内容。

## Task 2：Desktop query semantics decision（条件执行）

**Produces:** 明确 preserve/reject 决策；只有 proof gap 才改 parser。

- [x] **Step 1: 对 unknown/duplicate/empty/encoded query 做兼容性证据。** 对比 preview
  与既有 `/messages` history endpoint；结果一致，没有 silent session selection 变化。
- [x] **Step 2: 未发现明确 bug，不修改 parser。** 保留当前 `get()` first/empty-as-absent/
  unknown-ignore 语义；audit-limit、unknown-session 和 generic error 边界已有回归。
- [x] **Step 3: 形成 decision。** **Preserve / tests-only**；query tightening 继续保持
  CONDITIONAL，直到有真实客户端 proof gap，不引入版本协商。

## Task 3：验证、发布和下一阶段

**Produces:** v46 parity decision、发布提交和下一份有边界的计划。

- [x] **Step 1: focused/full verification。** `pnpm test:preview-parity` 3/3 通过；TypeScript
  workspace 612/612、release-gate 9/9、Rust unit/doc 46/46、real-Rust integration 10/10，
  独立 TypeScript/Rust gate、report smoke、structure 和 diff check 也通过。
- [x] **Step 2: 更新 README、CHANGELOG、progress 和 decision matrix。** 明确记录
  tests-only evidence 与未发生的 runtime 修复。
- [x] **Step 3: commit/push 并制定 v47。** v47 digest design plan 已建立；v46 保持
  `origin/main` 可复现。

## Acceptance checklist

- [x] 同一 evidence fixture 的 core/CLI/Desktop preview counts/bytes parity 有自动化证据。
- [x] success/error/unknown-session response 均保持 metadata-only allowlist。
- [x] duplicate/empty/unknown/encoded query 有明确 preserve decision，并有兼容性依据；没有
  silent session selection 变化。
- [x] v41 export caps、v1 export、pagination/schema v2、before-image/cross-process Undo
  boundaries remain intact.


## v46 decision summary

- core/CLI/Desktop preview parity：**通过**，4 组标准 filter case 全部一致。
- Desktop unknown/duplicate/empty/encoded query：**Preserve / tests-only**，不修改 parser。
- runtime hardening：**未触发**；v1 export、v41 caps、schema/pagination/before-image/Undo
  boundaries 均未改变。
- 详细证据：见 `docs/evidence-preview-parity-v46.md`。
