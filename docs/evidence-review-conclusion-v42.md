# v42 review conclusion

> 评审日期：2026-09-14
> 范围：`docs/day-plan-v42.md` 的 pagination、schema v2 和 before-image 独立评审。

## Decision summary

| 方向 | 决策 | 当前行动 |
| --- | --- | --- |
| keyset pagination | **CONDITIONAL** | 只保留 `docs/evidence-pagination-review-v42.md` 的设计输入；v1 不接收 cursor，不增加 page 字段。 |
| schema v2 negotiation | **CONDITIONAL** | 只保留显式版本交集、strict parser 和旧客户端拒绝矩阵；不发布 v2 runtime。 |
| before-image / cross-process Undo | **NO-GO** | 继续遵守 v39 七项闸门；不保存、不消费 before-image，不新增恢复 API。 |

## Why pagination is conditional

当前代码已经有稳定的 projection 排序和 v41 rejection-only limits，但没有跨页 snapshot
binding、cursor parser、失效状态机或 page/full response schema。仅凭
`(recordedAt, stable id)` 不能防止页间 evidence mutation、cleanup、session rename/delete
造成遗漏或重复。因此未来实现必须先证明 snapshot binding、cursor tamper/expiry/session
isolation、single-record-too-large 和 UTF-8 page budget；在此之前继续返回完整 v1 或
明确错误。

## Why schema v2 is conditional

v1 客户端和当前 surfaces 只理解完整 `schemaVersion: 1`。v2 还缺显式 supported-version
request、strict allowlist parser、partial/full summary contract、旧客户端拒绝和 rollback
部署矩阵。任何隐式降级都可能把 page 当完整 snapshot，因此 future v2 只有在兼容性和
故障注入证据齐全后才可另开实现计划。

## Why before-image remains no-go

v42 ledger 显示七项闸门均存在关键 proof gap：已有 postimage guard、同进程 rollback、
retention 和 metadata-only audit 不能证明 before bytes 的完整性、容量、敏感数据保护、
确认、原子恢复、生命周期或版本兼容。尤其不能把 postimage hash 当作可恢复 before-image
的授权。任何跨进程 Undo 提案都必须先在隔离 fixture 中完成七项可重复证据，并继续禁止
模型输出、历史命令、任意路径和 audit cursor 进入恢复输入。

## Release boundary

- v1 的成功字段、稳定排序、limits cap 和 CLI/Desktop 错误映射保持不变；
- `partial`、`hasMore`、`nextCursor`、`returnedCounts`、`totalCounts` 不进入当前 schema；
- pagination/schema v2 仅能通过新的独立实现计划进入 runtime；
- before-image 七项闸门未全部通过前，production 状态固定为 **NO-GO**。
