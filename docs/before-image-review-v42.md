# v42 before-image 七闸门 evidence ledger

> 建立日期：2026-09-14
> 状态：**NO-GO**。本文复核现有证据和 proof gap，不授权持久化 before-image、消费 before-image 或实现跨进程 Undo。

## 1. 评审范围

本 ledger 只比较已有 postimage-only guard、同进程 guarded rollback、metadata-only evidence
和 v39 的安全要求。postimage hash 能证明“当前文件仍像已应用结果”，不能证明 before
bytes 可安全保存、恢复或跨进程消费；两者不能互相替代。

## 2. 七项闸门

| 闸门 | 已有可定位证据 | 仍缺少的最小证明 | 决策 |
| --- | --- | --- | --- |
| 完整性绑定 | v37/v38 的 session/workdir/path/kind/existence/postimage guard；agent-core lifecycle matrix 覆盖过滤和状态转换 | before bytes 与 change-set/session/workdir/version 的不可替换绑定；篡改、串 session、路径逃逸和版本错配的故障注入 | **NO-GO** |
| 容量上限 | v37/v41 有 validation/change-set retention、audit record/file/byte rejection limits | before bytes 的单文件、单 set、单 session、全局磁盘预算；apply 前预检、崩溃中间态和清理配额 | **NO-GO** |
| 敏感数据 | v38/v41 projection 明确不导出 file bytes、before-image、command/output；路径/符号链接安全测试存在 | secret/credential/binary/permission/special-file/symlink 分类、加密和密钥生命周期、删除/崩溃恢复/日志脱敏 | **NO-GO** |
| 用户确认 | review-writes 对当前 apply 有显式确认和真实 diff；rollback 有 postimage conflict guard | before-image restore 的精确文件/字节范围、冲突和不可恢复风险展示；确认绑定当前 set/postimage、拒绝/过期/范围变化测试 | **NO-GO** |
| 原子与可恢复失败 | 同进程 multi-file apply/rollback、postimage conflict 和失败不自动 rollback 有回归 | before bytes 恢复的进程中断、磁盘满、权限变化、单文件失败、部分恢复状态机和幂等故障注入 | **NO-GO** |
| 生命周期与并发 | v37 lifecycle matrix、applied guard protection、rolled-back 不复活、cleanup/session isolation 和 v41 export side-effect tests | before-image 状态机与 validation/rollback/cleanup/rename/delete/并发/崩溃的锁、幂等和回收证明 | **NO-GO** |
| 版本兼容 | legacy memory version 1、缺失 evidence、allowlist projection 和损坏记录拒绝测试 | 独立 before-image record version、未知/损坏/降级记录拒绝、旧客户端不会误消费恢复输入 | **NO-GO** |

## 3. Current evidence boundary

已通过的证据支持以下安全边界：

- v1 audit export 只返回 metadata-only complete snapshot 或 rejection-only limit error；
- CLI/Desktop 的 evidence surfaces 不加载 provider、不进入 chat queue、不读取/写入 workspace；
- applied change-set guard 可以在 postimage 一致时支持显式 validation rerun，但没有跨进程
  before-image，因此不能提供 Undo；
- cleanup 只改变 evidence metadata，active applied guard 受保护，rolled-back record 不复活；
- report、audit、validation 和 restore guard 之间没有执行授权传递。

这些事实不能推导出 before-image GO；它们只证明当前“不保存/不消费 before-image”的边界
仍然成立。

## 4. Required isolated proof before any future proposal

若未来重新提议 before-image，必须另开实现计划，并先在临时、可删除 fixture 中完成：

1. authenticated integrity binding 与跨 session/workdir/version tamper matrix；
2. 多级容量预检、磁盘满/中断注入、无部分快照和可诊断恢复状态；
3. 敏感文件分类、加密 key lifecycle、删除和日志脱敏；
4. 一次性、范围准确、postimage-bound 的用户确认与过期/拒绝测试；
5. 多文件恢复的原子或可证明可恢复状态机、重复执行和部分失败测试；
6. 与 validation/rollback/cleanup/rename/delete/并发/崩溃交织的状态机和锁测试；
7. 独立版本、旧客户端拒绝、未知/损坏记录 fail-closed 和升级/降级测试。

fixture 内容、真实秘密、before bytes、命令和绝对路径不得写入普通日志、audit export、
model context 或 release report。

## 5. Conclusion

**NO-GO。** 七项闸门目前都有至少一个关键 proof gap；v39 的七项要求继续是进入实现的
必要条件。v42 不修改 memory schema、rollback API、audit export 或任何生产恢复路径。
