# Day plan v42：pagination/schema v2 与 before-image 独立评审

**建立日期：2026-09-14**

> 本计划承接 `docs/day-plan-v41.md`。v41 已把 v1 audit export 的拒绝式限额落地；v42 只做未来扩大能力的设计评审和可验证的安全决策，不直接实现分页、schema v2、before-image 或跨进程 Undo。

## Goal

在不改变当前 v1 runtime 的前提下，完成 keyset pagination、schema v2 negotiation 和
before-image 七项安全闸门的独立评审，明确哪些证据已经存在、哪些仍然是 NO-GO，以及
未来若继续开发所需的最小可验证合同。

## Scope boundary

- 当前 v1 继续保持“完整 snapshot 或明确限额错误”：不增加 `partial`、`hasMore`、
  `nextCursor`、`returnedCounts`、`totalCounts` 或隐式分页字段。
- pagination、schema v2 和 cursor 只在文档与兼容性矩阵中评审；本阶段不改
  `EvidenceAuditExport`、CLI 参数、Desktop endpoint 或 memory schema。
- before-image 继续独立于 evidence audit、release report、validation 和 rollback；
  未通过全部安全闸门前，不生成可执行恢复路径，也不实现跨进程 Undo。

## Architecture

- **v1 freeze：** 继续使用 `EVIDENCE_AUDIT_SCHEMA_VERSION = 1`、稳定排序、完整
  allowlist projection 和 rejection-only limits。
- **Future pagination review：** 评估以 `(recordedAt, validationId)` 和
  `(recordedAt, changeSetId)` 为边界的 keyset cursor；cursor 只绑定 session/filter/
  schema/sort metadata，不携带命令、cwd、输出、文件内容或 before-image。
- **Future schema review：** 评估显式 supported-version negotiation、未知版本拒绝、
  无交集时的 deterministic error，以及旧客户端对 partial snapshot 的 fail-closed
  行为；不在当前代码中发布 v2 字段。
- **Independent before-image review：** 逐项复核 integrity binding、capacity、sensitive
  data、explicit confirmation、atomic/recoverable failure、lifecycle/concurrency 和
  compatibility 七个闸门；每项都要有可重复的证据或明确缺口。

## Global Constraints

- 不持久化 before-image、patch、diff、文件字节、命令、args、cwd 或绝对 working directory。
- 不把 cursor、schema negotiation result、audit report 或历史 evidence 作为命令执行、
  restore、validation、model context 或 rollback 的输入。
- 不创建任意输出路径、任意 shell、任意模型可控的分页参数或可执行恢复授权。
- 评审结论必须区分 **GO（有可重复证据）**、**CONDITIONAL（需要补证）** 和
  **NO-GO（禁止实现）**，不能用“设计完成”替代运行时安全证据。
- 新增测试/文档遵循 TDD/证据优先：先记录要验证的失败条件，再写最小合同或测试；
  任何 runtime 变更都必须另开计划并经过完整 release gate。

## Task 0：v41 基线冻结

**Produces:** 可复核的 v1 当前事实和输入清单。

- [ ] **Step 1: 记录 v41 发布基线。** 固定通过计数、错误 allowlist、四类 limits cap
  和 CLI/Desktop 映射。
- [ ] **Step 2: 生成 v42 评审问题清单。** 区分“必须在 v2 前回答”和“继续 NO-GO”的问题。

## Task 1：keyset pagination 设计评审（文档 only）

**Produces:** 不可执行的 cursor contract 和失效条件。

- [ ] **Step 1: 固化排序/边界元组。** 评审 validation/change-set 的稳定排序、重复时间戳、
  同 id 冲突和新增/删除记录对 cursor 的影响。
- [ ] **Step 2: 评审 cursor 绑定。** 明确 session、filters、schema、sort version 和有效期；
  确认 cursor 不包含绝对路径、命令、输出、文件内容或秘密。
- [ ] **Step 3: 写 failure matrix。** 覆盖篡改、过期、跨 session、过滤变化、schema 变化、
  空页和超出 byte budget；所有不确定情况都 fail closed。

## Task 2：schema v2 compatibility review（文档 only）

**Produces:** 旧客户端/新客户端的显式 negotiation matrix。

- [ ] **Step 1: 定义版本交集和错误。** 无交集返回确定的 unsupported schema 错误，不隐式降级。
- [ ] **Step 2: 定义 partial/full 语义。** 只有新版本可以明确区分页与完整快照，summary
  必须区分全量计数和本页计数；v1 不消费这些字段。
- [ ] **Step 3: 评审迁移与回滚。** 覆盖未知字段、缺失字段、损坏 JSON、旧 memory、旧 CLI/
  Desktop 和服务端回滚；没有兼容证据就保持 NO-GO。

## Task 3：before-image 七闸门复核（文档 only）

**Produces:** 每项闸门的 evidence ledger 和剩余 proof gap。

- [ ] **Step 1: 逐项引用现有测试/设计证据。** 只记录可定位、可重复的事实，不把 postimage
  guard 当作 before-image integrity 证据。
- [ ] **Step 2: 明确缺口和最小补证。** 尤其复核敏感数据、原子恢复、容量上限、并发和旧客户端
  兼容性；缺口保持 NO-GO。
- [ ] **Step 3: 复核攻击路径。** 确认任何未来恢复输入都不会来自模型输出、历史命令、任意
  path 或未确认的跨进程状态。

## Task 4：决策、发布和下一阶段计划

- [ ] **Step 1: 写 v42 review conclusion。** 对 pagination、schema v2、before-image 分别
  给出 GO/CONDITIONAL/NO-GO。
- [ ] **Step 2: 运行文档/结构门禁。** `node scripts/check.mjs`、`git diff --check` 和必要的
  release gate；确认 v1 runtime 未改变。
- [ ] **Step 3: 更新 CHANGELOG、v42 progress 和后续计划。** 后续若要实现，只提出独立的
  小步计划，不自动承诺跨进程 Undo。
- [ ] **Step 4: Commit and push。** 评审结论和证据清单发布到 `origin/main`。

## Acceptance Checklist

- [ ] v1 输出字段和 rejection-only limits 保持不变。
- [ ] cursor contract 明确稳定排序、绑定范围、失效条件和敏感数据禁止项。
- [ ] schema v2 matrix 明确版本交集、partial/full 语义、损坏输入和旧客户端行为。
- [ ] before-image 七闸门各有可定位 evidence 或明确 proof gap；未满足者保持 NO-GO。
- [ ] 评审文档不生成恢复授权、不写 before-image、不访问 workspace 内容。

## 后续路线

1. 若 pagination/schema v2 仍缺证，继续保持 v1 完整快照与限额，不添加隐藏字段。
2. 若未来某一方向获得充分证据，另开独立实现计划，先做兼容性测试再改 runtime。
3. before-image 只有在七项闸门全部具备可重复证据后才可重新提议；在此之前不实现 Undo。
