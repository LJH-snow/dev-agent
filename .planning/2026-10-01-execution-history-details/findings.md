# Findings — 历史详情与证据关联

## 当前模型

- ExecutionHistoryRecord 只保留 runId、状态、时间、耗时、sequence 和聚合计数。
- DesktopRunState 已在内存 replay event 中清洗 validation 与 plan-review 元数据；可以在终态生成 history record 时提取 allowlisted IDs/status。
- Desktop message history endpoint 接受 validationId/changeSetId filters；UI 已有 conversation validation cards 和 evidence preview/history flows。

## 设计决策

- 只保存 validationId、changeSetId、validationStatus；每个字段做长度/enum 校验。
- 详情按 history row 选择状态展开，使用 textContent，不渲染原始输出。
- 验证/变更证据按钮绑定该 historySessionId 和对应 ID，通过现有 history API/渲染路径打开，不产生新的写操作。
