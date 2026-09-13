# v38 设计评审：before-image 与 metadata-only evidence audit

> 评审日期：2026-09-13  
> 状态：边界已批准；before-image 设计仍是跨进程 Undo 的阻断项。

## 1. 决策摘要

1. **v38 不实现跨进程 Undo。** 当前持久化 evidence 只包含 postimage 校验所需的哈希、路径和状态，不包含可恢复的 before bytes。把 before-image 加入 memory 会扩大敏感信息、磁盘容量、完整性和部分回滚风险，不能作为一个顺手的字段追加。
2. **v38 只实现 metadata-only audit projection。** 审计导出是固定 schema 的 allowlist projection，不是 `ValidationRecord` 或 `AppliedChangeSetRecord` 的直接 JSON 序列化。
3. **导出和 cleanup 分离。** export 是只读快照；cleanup 仍然只改 memory metadata。两者都不能执行命令、恢复文件或访问 working directory。
4. **projection 的 schema version 独立于 memory file version。** 旧 `version: 1` memory 缺失 evidence 时，导出返回同 schema 的空数组和零值 summary，不要求迁移。

## 2. before-image 设计评审结论

| 议题 | 当前决定 | 进入实现前必须满足 |
| --- | --- | --- |
| 完整性 | 暂不持久化 before bytes；postimage guard 继续作为现有跨进程校验 | before bytes 必须绑定 session、canonical working directory、相对路径、文件 kind、长度/摘要和记录版本，并具备防篡改校验；仅 SHA-256 不能单独证明来源 |
| 容量 | 不为 v38 分配隐含磁盘预算 | 必须有单文件、单 change-set、单 session 和全局上限；达到上限时在 apply 前明确失败，不能部分保存 |
| 敏感信息 | 不保存源文件内容、密钥、权限元数据或特殊文件快照 | 必须定义敏感路径/文件类型策略、加密与密钥生命周期，以及删除和崩溃恢复规则 |
| 用户确认 | 不提供隐式恢复或自动 rollback | 恢复前必须展示影响范围、字节/文件数量、冲突状态和不可恢复风险，并获得明确用户确认 |
| 恢复失败 | 继续保持 no-auto-rollback；冲突只返回 blocked/error | 必须验证每个 postimage，设计原子/可恢复的多文件恢复流程；任何部分失败都不能伪装成成功 |
| 并发与生命周期 | v37 的 applied guard 保护和 rolled-back 不可重新激活保持不变 | before-image 的锁、cleanup、session rename/delete、进程崩溃恢复必须有明确状态机和回归测试 |
| 兼容性 | v38 不扩展 memory file schema | 新 schema 必须可被旧版本安全忽略，并能拒绝未知/损坏/版本不兼容的恢复记录 |

在这些条件没有形成独立实现计划和 RED 测试前，任何“跨进程 Undo”需求都应继续返回不可用或要求同一进程的 guarded rollback。

## 3. Audit projection allowlist

导出顶层对象固定为：

- `schemaVersion: 1`
- `sessionId`
- `generatedAt`
- `summary`：`validations`、`changeSets`、`protectedChangeSets`、`rolledBackChangeSets`、`retention` 和固定的 `protectedChangeSetsReason`
- `validations[]`
- `changeSets[]`

### 3.1 Validation allowlist

每条 validation 只允许：

- `validationId`
- `changeSetId`
- `status`
- `durationMs`
- `recordedAt`
- `checks[]` 中的 `id`、`status`、`durationMs`、`exitCode`（如存在）

以下字段明确拒绝：`summary`、`reason`、`command`、`executable`、`args`、`cwd`、`output`、`error` 和任何未列出的未来字段。这样 audit export 不会携带可执行输入或命令结果中的路径/密钥/文件内容。

### 3.2 Change-set allowlist

每条 change set 只允许：

- `changeSetId`
- `state`
- `additions`
- `deletions`
- `createdAt`
- `recordedAt`
- `files[]` 中的 `path`、`kind`、`beforeExists`、`afterExists`、`beforeHash`（如存在）、`afterHash`、`additions`、`deletions`

`workingDirectory` 不导出；session 已在顶层绑定。`path` 必须是相对路径，统一为 `/`，不含 NUL、绝对前缀或 `..` 逃逸。导出不读取这些路径，只投影已持久化 metadata。

### 3.3 稳定性与不可变性

- validations 按 `recordedAt`、`validationId` 排序；每条 checks 按 `id` 排序。
- change sets 按 `recordedAt`、`changeSetId` 排序；每条 files 按 `path` 排序。
- projection 创建新对象和新数组，不修改 memory 返回的输入。
- `generatedAt` 由调用方提供或在边界生成；测试使用固定时间验证结构和排序。
- 新增内部字段不会自动出现在导出中；需要逐字段评审和版本兼容测试。

## 4. 必须保留的安全断言

- export、cleanup 和 history filter 不改变 working directory 的任何字节。
- export 不触发 executor、MCP、filesystem mutation、rollback 或 model call。
- export 不把 evidence 放回普通 model message context。
- applied guard 仍受 retention 保护；rolled-back evidence 仍不能恢复成 applied，也不能获得 Undo 能力。
- session、working-directory、postimage、file-kind、existence、cancellation、no-auto-rollback、MCP denial 和 Rust sandbox 约束继续由 v37 回归矩阵覆盖。

## 5. 后续实现门槛

Task 1 只能实现上述 projection 和纯函数测试。Task 2 才能增加 CLI/Desktop 只读入口。任何 before-image 代码、磁盘快照、恢复 API 或自动 rollback 都不属于 v38，除非先重新通过完整设计评审。
