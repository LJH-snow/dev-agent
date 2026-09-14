# v42 pagination 设计评审：keyset cursor 与完整性边界

> 建立日期：2026-09-14
> 状态：**CONDITIONAL / DESIGN ONLY**。本文不改变 v1 runtime，不增加分页字段、cursor endpoint 或 schema v2。

## 1. 当前 v1 排序事实

当前 agent-core projection 在生成完整 v1 snapshot 前使用以下稳定顺序：

- validation：`(recordedAt ASC, validationId ASC)`；
- change set：`(recordedAt ASC, changeSetId ASC)`；
- checks：`id ASC`；files：规范化后的 `path ASC`。

v41 的 limits 作用于过滤后的、稳定排序后的完整 projection。v1 没有 page、cursor、
partial 或 has-more 语义，因此这些排序事实只能作为未来设计输入，不能被当前客户端
解释为分页协议。

## 2. 建议的未来 keyset contract

若未来完整快照无法满足 byte budget，v2 才可考虑 keyset pagination。每个 collection
的 cursor 至少要绑定以下 metadata：

| 字段 | 目的 | 允许内容 | 禁止内容 |
| --- | --- | --- | --- |
| schema/sort version | 固定字段和比较规则 | 版本号、排序 id | 命令、执行授权 |
| session binding | 防止跨 session 重放 | session 的逻辑 id 或其摘要 | working directory、秘密 |
| filter binding | 防止改变过滤器后继续取页 | canonical filter 摘要 | 原始敏感输出 |
| snapshot binding | 防止页间数据漂移 | evidence generation/fingerprint | 文件字节、before-image |
| after tuple | 继续扫描的边界 | `recordedAt` + stable id | 数组 index |
| expiry/key id（如采用签名） | 限制重放并支持轮换 | 时间戳、签名 key id | session secret 本身 |

建议使用两个独立的 keyset 边界：validation cursor 绑定
`(recordedAt, validationId)`，change-set cursor 绑定 `(recordedAt, changeSetId)`。
不能用数组 index，因为插入、删除或 retention pruning 会改变 index 而不改变业务
顺序。

Cursor 只能用于继续读取同一个只读 audit projection。它不是 restore、validation、
rollback、命令执行或 model context 的输入；任何代码路径若试图把 cursor 传给这些
边界，都应拒绝。

## 3. 重复时间戳、重复 id 和边界行为

- 相同 `recordedAt` 通过 stable id 解决；同一 collection 内若出现重复 stable id，
  必须判为 invalid snapshot，而不是静默去重。
- 新记录的 tuple 大于 cursor 边界时可出现在后续页；小于或等于边界的记录不能再次
  返回。若没有 snapshot binding，页间新增/删除会造成遗漏或重复，因此不能宣称完整
  遍历。
- 若任何 evidence mutation、cleanup、session rename/delete 或 retention 变化导致
  snapshot binding 不匹配，服务端必须返回 `snapshot_changed`/`invalid_cursor`，而不
  猜测继续位置。
- 空页只有在 cursor 有效且服务端能证明没有更大 tuple 时才表示 `hasMore=false`；若
  单条记录本身大于 byte budget，必须返回明确的 `record_too_large`，不能返回空页造成
  客户端无限重试。
- 过滤器、排序规则、schema 版本或 session 变化都使旧 cursor 失效。v1 不接受任何
  cursor，因此不存在兼容性降级。

## 4. Byte budget 与页语义

未来 v2 必须先确定 page metadata、summary 语义和 `nextCursor`，再以 canonical UTF-8
JSON 计算完整页字节数。分页响应至少要区分：

- 全量 summary/计数；
- 本页返回的 validations/change sets/files；
- `partial: true`、`hasMore` 和稳定 `nextCursor`；
- 本页无法容纳单条记录时的 deterministic error。

不能把 v41 的 rejection-only `maxBytes` 改成“尽量塞几条”；那会让 v1 的 summary 与
数组不一致，也会让旧客户端误把 page 当完整快照。

## 5. Failure matrix

| 条件 | 未来 v2 期望 | v1 当前行为 |
| --- | --- | --- |
| cursor 被篡改 | `invalid_cursor`，不读 workspace | 不接受 cursor |
| 跨 session 重放 | `invalid_cursor` | 不接受 cursor |
| filter/schema/sort 改变 | `invalid_cursor` | 不接受 cursor |
| snapshot generation 改变 | `snapshot_changed` | 不接受 cursor |
| cursor 过期或 key 失效 | `invalid_cursor` | 不接受 cursor |
| 空页且 cursor 有效 | 明确 `hasMore=false` | 不接受 cursor |
| 单条记录超过页 budget | `record_too_large` | v1 完整快照超限时结构化限额错误 |
| 未知/损坏 cursor JSON | `invalid_cursor` | 不接受 cursor |
| cursor 试图进入执行边界 | hard reject / security event | 当前没有此输入路径 |

所有错误都只能包含错误 code、schema/version、绑定类别和必要的计数；不得回显命令、
绝对路径、输出、文件内容、before-image 或 session evidence。

## 6. 结论

**CONDITIONAL。** keyset pagination 在稳定 tuple、snapshot binding、显式 partial 语义和
严格失效规则都被实现并通过兼容性/并发/篡改测试前，不具备进入 runtime 的条件。
当前 v1 继续保持完整 snapshot 或明确限额错误；本评审不授权分页实现。
