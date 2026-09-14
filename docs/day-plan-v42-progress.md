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

- [ ] 记录 v41 通过计数、limits cap 和 CLI/Desktop 错误映射。
- [ ] 写评审问题清单。

### Task 1：keyset pagination 设计评审

- [ ] 固化排序和边界元组。
- [ ] 定义 cursor 绑定和失效规则。
- [ ] 写 tamper/expiry/session/schema/byte-budget failure matrix。

### Task 2：schema v2 compatibility review

- [ ] 定义版本交集和 unsupported error。
- [ ] 区分 partial page 与 full snapshot，保持 v1 不变。
- [ ] 覆盖旧客户端、旧 memory、未知字段、损坏 JSON 和回滚。

### Task 3：before-image 七闸门复核

- [ ] 建立 evidence ledger。
- [ ] 记录 proof gaps 和最小补证。
- [ ] 复核未来恢复输入不会来自模型或历史命令。

### Task 4：结论和发布

- [ ] 分别给出 pagination、schema v2、before-image 的 GO/CONDITIONAL/NO-GO。
- [ ] 运行结构/文档门禁并确认 runtime 无变化。
- [ ] 更新 CHANGELOG、progress 和下一阶段计划并推送。
