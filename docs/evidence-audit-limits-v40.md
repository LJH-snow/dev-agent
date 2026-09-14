# v40 audit export 版本与大小边界设计

> 建立日期：2026-09-14
> 状态：**DESIGN ONLY**。本文件定义未来扩大 audit export 时的兼容和限额语义，不改变 v1 runtime schema，不保存 before-image，也不实现跨进程 Undo。

## 1. 当前 v1 事实与约束

当前 `EvidenceAuditExport` 是 schema version 1 的完整、metadata-only 快照。它
按稳定键排序，来自受 retention 约束的 memory evidence，并且不包含命令、args、
cwd、输出、错误、diff、patch、before-image 或文件字节。v1 没有分页、游标、部分
导出或大小上限字段，因此不能静默省略数组成员来“适应”某个响应上限。

未来若需要限制导出，必须先把“完整快照”和“明确部分快照”区分开；不能把返回
数组长度变化解释成成功的完整结果。

## 2. 限额语义

未来实现可支持以下四类独立限制，限制作用于**过滤后的、稳定排序后的 projection**：

| 限制 | 计量对象 | 超限行为 | 禁止行为 |
| --- | --- | --- | --- |
| record count | validations 和 changeSets 的返回条数 | 在生成响应前返回结构化 `limit_exceeded`，不返回部分 v1 快照 | 静默截断、修改 summary 伪装成完整结果 |
| file count | 每个 changeSet 的 files 条数和全局 files 总数 | 同样 fail closed；错误指出限制类别和实际计数，不包含路径内容 | 只截断 files 而保留看似完整的 changeSet |
| serialized byte budget | UTF-8 canonical JSON 的完整响应字节数 | 在输出前拒绝响应；不写半个 JSON，不落盘临时部分导出 | 按字符数估算、按 chunk 截断、输出不可解析 JSON |
| pagination | 稳定排序后的 keyset cursor 和 page size | 只能由新版本 schema 明确标记 `partial`/`hasMore`/`nextCursor` 后返回 | 用数组 index 当长期 cursor、把 page 当完整 snapshot |

限额错误必须是只读结果，不得触碰 working directory、session memory、executor、
MCP 或 rollback。错误本身只允许出现限制类别、请求值、已计数值和 schema/version
信息，不得回显命令、绝对路径、文件内容或敏感输出。

## 3. Canonical serialization

若未来采用 byte budget，必须先固定 canonical serialization：

1. 过滤、排序和 allowlist projection 完成后，使用固定对象字段顺序、固定数组顺序
   和 UTF-8 JSON 编码计算字节数。
2. `generatedAt`、schema version、filters 和 page metadata 必须在计量前确定；不能
   先发送头部再发现超限。
3. 计算结果必须以 `Buffer.byteLength(serialized, "utf8")` 语义为准；不能把 Unicode
   code point 数当成字节数。
4. 在内存中完成完整序列化和上限检查后，才允许一次性返回；任何写文件路径都必须
   仍然遵循固定、原子和 metadata-only 边界。
5. 同一输入、同一过滤器、同一 schema、同一时间和同一 page 参数必须得到完全相同
   的 canonical bytes；生成时间不同的结果不承诺 digest 相同。

## 4. Schema negotiation

- 当前 v1 客户端只接受 `schemaVersion: 1`。遇到大于 1 的版本、缺失必需字段、
  错误类型或损坏 JSON 时，客户端必须明确返回 unsupported/invalid，不得猜测字段
  或把结果当成执行输入。
- 新客户端请求新版本时，必须显式声明支持的版本集合；服务端只能选择双方交集，
  没有交集就返回 `unsupported_schema`。不通过隐式降级掩盖分页或限额语义变化。
- 在同一版本中新增可选 metadata 字段可以被兼容客户端忽略，但未知字段永远不能
  影响命令执行、restore、validation、cleanup 或 model context。新增必需字段必须
  升级 schema version 并补齐迁移/拒绝测试。
- v1 不定义 `partial`、`hasMore`、`nextCursor`、`returnedCounts` 或 `totalCounts`。
  这些字段只能进入新 schema，并且必须与旧客户端的拒绝行为一起发布。

## 5. Pagination 设计方向（未来 schema）

若完整快照无法满足 byte budget，未来 schema 应采用 keyset pagination，而不是数组
index：

- validation cursor 绑定 `(recordedAt, validationId)`，change-set cursor 绑定
  `(recordedAt, changeSetId)`；比较规则与当前稳定排序一致。
- page 必须携带 `partial: true`、`hasMore`、稳定的 `nextCursor` 和过滤器摘要；
  summary 必须区分全量计数与本页返回计数，不能让本页数组覆盖全量计数。
- 过滤器、schema、排序规则或 session 发生变化时，旧 cursor 必须失效；cursor
  不得包含绝对 working directory、命令、args、输出、文件内容或 before-image。
- cursor 如需防篡改，使用只绑定 metadata 的签名/摘要；不得把签名设计成恢复或
  执行授权，也不得把 session secret 写入导出。

## 6. Compatibility matrix

| 输入/客户端 | v1 完整导出 | 新版本分页导出 | 超过限额 | 损坏/未知版本 |
| --- | --- | --- | --- | --- |
| 旧客户端 | 接受并校验 allowlist | 拒绝 `unsupported_schema` | 接收结构化错误，不把错误当快照 | 拒绝，不猜测 |
| 新客户端 | 兼容读取完整 v1 | 只有显式声明版本并校验 `partial`/cursor 后接受 | 显式选择分页或调整请求，否则接受错误 | 拒绝并记录 invalid/unsupported |
| CLI v1 surface | 继续输出完整 metadata-only JSON | 未实现前不输出分页字段 | 不静默截断；错误走 stderr/非零退出 | 非零退出 |
| Desktop v1 surface | 继续返回完整 metadata-only JSON | 未实现前不返回部分结果 | 结构化 HTTP error，不触碰 chat/workspace | 结构化 HTTP error |

## 7. Go/No-Go

在 record/file/byte limit 的运行时值、canonical serialization、分页 schema、cursor
失效、旧客户端拒绝和 CLI/Desktop 错误映射都有 RED/GREEN 回归前：

- 不向 v1 增加“看似可选”的部分导出字段；
- 不静默截断 validations、changeSets 或 files；
- 不把超限 fallback 到命令、diff、patch、文件字节、before-image 或 workspace
  读取；
- 不改变当前 metadata-only projection、session 隔离、no-auto-rollback 和
  postimage-only restore 边界。

本文件是设计输入，不授权立即实现限额、分页或任何 before-image 能力。
