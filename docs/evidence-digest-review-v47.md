# v47 canonical metadata digest 评审

**评审日期：2026-09-14**

**状态：design-only；没有找到真实 consumer，公开 digest 与 signature 均 NO-GO。**

## Scope and inventory method

本评审只检查当前仓库中 `EvidenceAuditPreview`、`serializedBytes`、CLI/Desktop
preview、v1 export 和 release/CI 使用方式；不引入新依赖、不读取真实用户 session、
不访问 workspace，也不把 hash 当作执行或恢复输入。

代码与文档 inventory 的结论如下：

| 现有 surface | 当前使用 | 是否需要 digest |
| --- | --- | --- |
| agent-core `createEvidenceAuditPreview()` | 计算完整 v1 projection 的 counts/file count/UTF-8 bytes | 未发现下游 hash consumer |
| CLI `--preview-evidence` | 给操作者选择后续 v1 export limit | `serializedBytes` 已满足当前目的 |
| Desktop preview endpoint | 给本地 UI/API caller 选择后续 v1 export limit | 未发现 cache/integrity consumer |
| v1 CLI/Desktop export | 输出完整 metadata-only snapshot，并支持显式 rejection limits | 现有 canonical serializer 已是 byte identity source |
| release gate / CI | 只消费 phase status/timing/exit-code report | 不读取 evidence preview/digest |
| session memory | 持久化 evidence summary/records，不持久化 preview/digest | 没有 digest storage 或 invalidation protocol |
| tests/docs | 验证 allowlist、parity、bytes 和 security boundaries | 只能证明 contract，不构成产品 consumer |

`serializedBytes` 的唯一明确产品用途仍是 preview 后选择 v41 rejection-only export
limit；仓库没有 cache key、跨系统审计关联、远端同步、签名验证或 digest comparison
调用方。因此“增加一个 hash 以后可能方便”不构成 v47 runtime 需求。

## Candidate contract analysis

如果将来确实出现 content-identity consumer，最小 deterministic hash 应满足：

1. 输入严格为 `serializeEvidenceAuditExport()` 返回字符串的 UTF-8 bytes，而不是原始
   memory、未排序对象或 preview JSON；
2. contract 固定 schema version、algorithm label、domain separation、编码和输出格式，
   并绑定 session/filter/projection scope，避免跨 projection 或跨 session 混用；
3. empty、UTF-8、reordered input、filtered projection 和 limit rejection 都有固定 vectors；
4. CLI、Desktop、agent-core（必要时 Rust/CI）只对同一 canonical bytes 得到同一结果；
5. digest 只表达内容身份，不表达“已验证”“可信”“可恢复”“可执行”或“可 Undo”。

SHA-256 + lowercase hex 是一个可实现的候选，但候选算法本身不是需求证据，也不能解决
真实性问题。若 caller 需要 authenticity，则还需要密钥归属、签发、轮换、验证、撤销、
旧算法迁移和失败语义；当前项目没有这些 key lifecycle 或 trust anchor。因此不能把
 deterministic hash 命名为 signature，也不能仅因为 hash 稳定就扩大公开 schema。

## Abuse and compatibility boundary

- replay/stale digest：不能触发 validation、restore、rollback 或 Undo；caller 必须重新
  读取并验证当前 session/projection。
- cross-session mix-up：session id、schema/algorithm 和 projection scope 必须显式绑定；
  digest 不得成为跨 session 的授权票据。
- algorithm migration：旧/未知算法只能明确失败或由 caller 选择兼容路径，不能静默解释；
  不得改变 v1 preview/export 的字段。
- logging correlation：公开 digest 可能成为稳定关联标识，必须先证明日志/隐私需求与
  retention policy；当前没有该需求。
- sensitive data：hash 虽不直接输出 evidence，但如果把 digest 与 session、时间或外部
  事件持久化，仍可能扩大关联面；当前不增加该存储。
- signature confusion：无私钥、公钥、验证链和撤销机制时，不宣称 authenticity 或
  non-repudiation。

## Decision

**NO-GO（公开 surface）/ design-only（本轮）。**

v47 不修改 `EvidenceAuditPreview` v1、不新增 digest 字段、CLI flag、Desktop query、
MCP resource、持久化记录或 Rust protocol。继续使用 canonical `serializedBytes` 作为
当前 export-limit selection 的唯一 preview measurement。

如果未来出现真实 consumer，另开实现计划，先落 deterministic vectors 和跨宿主 parity，
再决定是独立 metadata endpoint、显式 opt-in CLI/HTTP surface，还是仅内部 utility；任何
signature 方案必须先补齐 key trust model。没有 consumer 前不继续堆 speculative integrity
fields。

## Evidence

- `git grep` inventory：当前 `serializedBytes` 仅服务 core preview、CLI/Desktop output、
  tests 与文档，没有 cache/signature/verification consumer。
- v45 benchmark：完整 projection bytes 与 v1 serializer parity 已通过；bytes 已足以指导
  explicit export limit。
- v46 parity：core/CLI/Desktop 的 counts、file count、bytes 和 query semantics 已一致；
  不需要 digest 才能完成当前跨宿主 contract。
