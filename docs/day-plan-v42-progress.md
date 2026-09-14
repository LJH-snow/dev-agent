# v42 开发进度：pagination/schema v2 与 before-image 独立评审

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v42.md` 为准。本文件只记录设计评审，不表示任何
> pagination、schema v2、before-image 或跨进程 Undo 已获准实现。

## 当前状态

v41 已完成 v1 audit export 的 rejection-only limits、CLI/Desktop 只读映射和完整门禁。
v42 先冻结 v1 事实，再分别评审 keyset pagination、schema negotiation 和 before-image
七项安全闸门；所有未具备可重复证据的方向保持 NO-GO。

## 评审原则

- v1 仍是完整 snapshot 或明确限额错误，不返回 partial/pagination/cursor。
- cursor 只允许绑定 metadata；不携带命令、args、cwd、输出、文件内容、秘密或
  before-image，也不成为执行/restore/validation/rollback 授权。
- schema v2 只能通过显式版本交集和 deterministic error 进入未来计划，不隐式降级。
- before-image 与 audit/report/validation 保持独立；postimage guard 不等于恢复安全证据。

## 任务状态

### Task 0：v41 基线冻结

- [x] 记录 v41 通过计数、limits cap 和 CLI/Desktop 错误映射：TypeScript **606/606**、release-gate **9/9**、Rust **46/46**、real-Rust integration **10/10**；limits 为 validations/changeSets 各 10,000、files 100,000、bytes 10,485,760。
- [x] 写评审问题清单：cursor 是否绑定稳定 snapshot、v2 如何显式协商和区分 page/full、before-image 七项闸门分别缺什么可重复证据。

### Task 1：keyset pagination 设计评审

- [x] 在 `docs/evidence-pagination-review-v42.md` 固化排序和边界元组：validation/change-set 均按 `(recordedAt, stable id)`，拒绝重复 stable id。
- [x] 定义 cursor 的 session/filter/schema/sort/snapshot binding、过期和失效规则；cursor 不进入执行边界。
- [x] 写 tamper/expiry/session/schema/snapshot/byte-budget failure matrix；结论为 **CONDITIONAL**，v1 不实现分页。

### Task 2：schema v2 compatibility review

- [x] 在 `docs/evidence-schema-v2-review-v42.md` 定义显式版本交集、`unsupported_schema` 和非法请求拒绝。
- [x] 区分 partial page 与 full snapshot，保持 v1 字段/限额不变。
- [x] 覆盖旧客户端、旧 memory、未知/缺失字段、损坏 JSON、cursor mismatch 和 rollback；结论为 **CONDITIONAL**。

### Task 3：before-image 七闸门复核

- [x] 在 `docs/before-image-review-v42.md` 建立七项 evidence ledger。
- [x] 记录每项 proof gap 和最小补证；七项均保持 **NO-GO**。
- [x] 复核未来恢复输入不得来自模型输出、历史命令、任意 path、audit cursor 或未确认的跨进程状态。

### Task 4：结论和发布

- [x] 在 `docs/evidence-review-conclusion-v42.md` 分别给出 pagination、schema v2、before-image 的 GO/CONDITIONAL/NO-GO。
- [x] 运行结构/文档门禁并确认 runtime 无变化。
- [x] 更新 CHANGELOG、progress 和下一阶段计划并准备推送。
