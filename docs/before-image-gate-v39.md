# v39 before-image 可行性闸门

> 建立日期：2026-09-14
> 状态：**NO-GO**。本文件只定义进入未来研究的证明要求，不授权持久化 before-image、消费 before-image 或实现跨进程 Undo。

## 1. 决策

v38/v39 继续只允许 postimage-only validation、metadata-only audit export 和
显式的同进程 guarded rollback。before-image 只有在下表的七项闸门全部由
可重复测试、故障注入和运行记录证明后，才可以进入独立实现计划；任一项
缺少证据都保持 **NO-GO**。

| 闸门 | 必须输入/解决的问题 | 进入实现前必须证明 | 否决条件 |
| --- | --- | --- | --- |
| 完整性绑定 | session、canonical working directory、相对路径、文件 kind、长度/摘要、记录版本 | before bytes 与 change-set 身份和 postimage 形成不可替换的完整性绑定；篡改、串 session、串工作目录、路径逃逸和版本错配都被拒绝 | 仅靠 SHA-256、可复制的裸文件名或可重放的旧记录即可恢复 |
| 容量上限 | 单文件、单 change-set、单 session、全局磁盘预算，以及崩溃中间态 | apply 前完成容量预检；超限时不写入部分快照、不产生半个 change-set；清理和配额行为有上限测试 | 先写一部分再报错、无上限、无限制增长或预算失败后仍可恢复 |
| 敏感数据 | 密钥、凭据、二进制、权限、特殊文件、符号链接和敏感路径 | 明确定义允许/拒绝的文件类型和路径；加密、密钥生命周期、删除、崩溃恢复和日志脱敏均有证明 | before bytes 明文落盘、密钥进入日志/导出、特殊文件可被伪造恢复 |
| 用户确认 | 文件/字节影响范围、冲突、不可恢复风险、恢复原因 | 恢复前展示准确范围并获得一次明确确认；确认绑定当前 change-set 和当前 postimage；拒绝或过期确认不会恢复 | 自动 rollback、隐式确认、范围变化后沿用旧确认、UI 只显示模糊提示 |
| 原子与可恢复失败 | 多文件恢复、进程中断、磁盘满、权限变化、单文件失败 | 预检全部 postimage；恢复过程具备原子或可证明的可恢复状态机；部分失败可诊断且不会伪装成功；重复执行不会扩大损坏 | 部分文件恢复后标记成功、失败后覆盖用户修改、无法区分已恢复与未恢复 |
| 生命周期与并发 | validation、rollback、cleanup、session rename/delete、并发请求、进程崩溃 | 用明确状态机、锁和幂等规则证明不会重复消费、越权恢复、清理活动记录或让 rolled-back 重新激活 | cleanup 与恢复竞态、跨 session 复用、重启后状态不一致、恢复记录被隐式删除 |
| 版本兼容 | memory schema、audit schema、未知字段、损坏记录、旧客户端 | 新记录有独立版本和拒绝策略；旧版本安全忽略；未知/损坏/不兼容恢复记录不会被猜测或执行；升级/降级有测试 | 通过字段猜测迁移、旧客户端误把新数据当可恢复输入、损坏记录仍可触发恢复 |

## 2. Go/No-Go 规则

1. 七项闸门全部满足前，状态固定为 **NO-GO**；不得修改 memory schema 以保存
   before bytes，不得新增恢复 API，不得把 before-image 传入模型上下文或 audit
   export，也不得为跨进程 Undo 增加隐藏开关。
2. 当前允许的恢复边界只有 v37/v38 已验证的 postimage guard、同进程 guarded
   rollback、显式 metadata-only cleanup 和 metadata-only audit export。
3. 未来研究必须先提交独立实现计划，逐闸门列出 RED 测试、故障注入、容量/敏感
   数据测试、并发测试和回滚后的清理证明；不能用“先落盘再补安全”替代证明。
4. 任一实现阶段出现未知字段、损坏快照、postimage conflict、session/workdir
   mismatch、取消或资源不足，都必须 fail closed：不恢复、不自动 rollback、不
   重新激活 rolled-back evidence。

## 3. 隔离实验边界

在所有闸门通过前，任何实验只能满足以下条件：

- 使用临时、隔离且可删除的测试夹具；不写入真实 session memory、用户工作目录或
  release artifact。
- 使用显式测试开关和固定 fixture，不接受模型输出、CLI 任意命令、历史 evidence
  或用户路径作为实验恢复输入。
- 记录测试 fixture 的生命周期和清理结果，不把 fixture 内容、密钥或文件字节写入
  日志、audit export 或普通模型 context。
- 实验失败、取消、超时和进程崩溃都必须以未授权恢复结束；实验代码不能被生产
  `Undo`、validation 或 cleanup 路径调用。

## 4. 当前状态与下一步

- 完整性、容量、敏感数据、确认、原子失败、生命周期/并发和兼容性目前都只有
  设计要求，没有足够的实现证据，因此整体保持 **NO-GO**。
- v39 先完成固定 release gate 和 CI 复用；下一阶段只能在独立评审中补充证据，
  不能把本文件误读为恢复功能规格。
- 当且仅当七项闸门均为 **GO**，才允许另建计划评估受确认的跨进程恢复；即使如此，
  audit export 仍应保持 metadata-only allowlist，并与恢复输入完全分离。
