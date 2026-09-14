# v42 schema v2 compatibility 评审

> 建立日期：2026-09-14
> 状态：**CONDITIONAL / DESIGN ONLY**。本文只定义未来版本协商和拒绝规则，不发布 v2 runtime schema。

## 1. v1 freeze

当前 `EvidenceAuditExport` 固定为 `schemaVersion: 1`，包含完整 metadata-only projection、
summary、validations 和 changeSets。v1 不定义 `partial`、`hasMore`、`nextCursor`、
`returnedCounts`、`totalCounts` 或版本协商字段；v41 仅增加请求限额和结构化超限错误，
不改变成功响应。

旧 CLI/Desktop 客户端必须继续按 v1 allowlist 校验结果。遇到大于 1 的 schema、缺失必需
字段、未知 cursor 或损坏 JSON 时，应明确拒绝，不把对象当作完整快照或执行输入。

## 2. Future negotiation contract

未来若发布 v2，客户端必须显式声明 supported versions，例如逻辑上的
`[1, 2]`；服务端只选择交集中的一个版本：

| 客户端声明 | 服务端可提供 | 结果 |
| --- | --- | --- |
| 未声明（旧客户端） | v1 | 返回完整 v1 |
| 未声明（旧客户端） | 仅 v2 | `unsupported_schema`，不隐式降级或返回 page |
| 声明 v1 | v1/v2 | 选择 v1，保持完整 snapshot |
| 声明 v2 | v2 | 只有明确校验 v2 contract 后返回 |
| 声明无交集 | 任意 | `unsupported_schema` |
| 声明非法/重复版本 | 任意 | `invalid_schema_request` |

协商结果本身不携带命令、cwd、输出、文件内容或 before-image，也不授予任何 restore、
validation、rollback 或执行权限。

## 3. Full/page distinction

v2 若支持分页，成功响应必须显式携带能够区分 page 和完整 snapshot 的字段，并且：

- `partial: true` 只能出现在明确的 page response；
- `hasMore` 与 `nextCursor` 必须同时满足 schema/绑定/失效规则；
- summary 必须区分全量计数和本页返回计数；
- page 的 canonical UTF-8 byte budget 必须在发送前完成；
- 旧 v1 客户端遇到 v2 或 partial response 必须拒绝；
- v2 客户端遇到缺失 page metadata、cursor 失效或全量/本页计数矛盾时必须 fail closed。

v1 的 `maxBytes` 不可通过静默截断变成 v2；v1 超限仍返回结构化错误，保持响应没有
partial/pagination 字段。

## 4. Compatibility and failure matrix

| 输入 | 新客户端 | 旧客户端/当前 v1 surface |
| --- | --- | --- |
| v1 完整 snapshot | 校验后兼容读取 | 接受 |
| v2 完整 snapshot | 仅在显式协商后接受 | `unsupported_schema` / 非零或 4xx |
| v2 partial page | 校验 page/cursor/summary 后接受 | 拒绝，不把 page 当完整 snapshot |
| 未知顶层字段 | 若 schema 允许 optional metadata，可忽略；否则拒绝 | 拒绝未知版本/必需结构 |
| 缺失必需字段 | `invalid_schema` | 拒绝 |
| 损坏 JSON/类型错误 | `invalid_schema` | 非零/结构化 4xx |
| 旧 memory version 1 | 只读投影为 v1 或显式 v2 full | v1 兼容读取 |
| schema rollback | 重新协商，不复用 v2 cursor | 回到 v1 full 或明确 unsupported |
| session/filter/snapshot mismatch | `invalid_cursor` / `snapshot_changed` | 不接受 cursor |

错误 allowlist 只允许 code、schema/version、绑定类别和必要计数；不得包含原始请求、命令、
路径、输出、文件字节、before-image 或秘密。

## 5. Migration and rollback requirements

进入实现前必须补齐：

1. v1/v2 parser 的 strict allowlist 和未知版本拒绝测试；
2. 旧 memory 无 evidence、旧 CLI、旧 Desktop 与新服务端的端到端矩阵；
3. 协商无交集、损坏 JSON、缺字段、未知字段和 rollback 部署的 deterministic result；
4. page/full summary 的一致性、cursor invalidation 和 UTF-8 byte budget 故障注入；
5. 证明 v2 metadata 绝不进入 command/restore/validation/model-context 边界。

## 6. 结论

**CONDITIONAL。** schema v2 只有在显式协商、严格 parser、full/page 区分、旧客户端拒绝
和 rollback matrix 都具备可重复证据后，才可另开实现计划。当前 v1 freeze 继续有效，
v2 不进入本次 runtime。
