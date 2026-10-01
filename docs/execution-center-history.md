# Execution Center 历史与导出契约

建立日期：2026-10-01

## 范围

Execution Center 的 Recent runs 面板提供运行历史检索、运行状态和验证状态筛选、运行对比、通知未读状态、摘要复制以及 JSON/Markdown 导出。所有功能都只使用 session-bound 的 bounded history projection。

## 可保存的筛选条件

浏览器本地只保存以下四个字段，key 为 dev-agent.execution-history-filters.v1：

- search：最多 96 个字符的运行 ID 搜索文本。
- status：all、done、failed 或 aborted。
- validation：all、passed、failed、skipped、blocked 或 none。
- format：json 或 markdown。

损坏、超长、非法枚举或无法访问的 storage 都回退到默认值；不会保存 prompt、工具输入/输出、命令、路径、凭据或证据正文。

## 通知语义

- 首次加载一个 history session 时，已有记录建立为已读基线。
- 后续刷新发现新的 done、failed 或 aborted run 才产生未读通知。
- 同一个 sessionId + runId 只产生一条通知。
- 切换到新的 session 会先建立该 session 的历史基线；已删除 session 的通知会被清理。
- 点击运行或 Mark read 只改变本地 metadata-only 未读状态，不触发模型、重跑、apply、rollback 或远程写入。

## 导出 allowlist 与上限

JSON 和 Markdown 导出只包含：sessionId、runId、status、startedAt、finishedAt、durationMs、sequence、toolCount、approvalCount、validationCount、validationId、changeSetId 和 validationStatus。

- 最多导出 50 条记录。
- 序列化结果最多 64 KiB；超出时丢弃最旧记录并标记 truncated。
- 空筛选结果导出空记录集合，不伪造运行状态。
- 导出状态是 UI 本地状态；下载失败不会改变历史，也不会重试或发起服务器写操作。

## 维护验收

- Desktop focused history tests 覆盖筛选、通知、stale response、导出 allowlist、空/超量上限和恢复筛选。
- Desktop 全量测试覆盖 Execution Center 与其它审批、MCP、终端、任务工作区和验证边界。
- 真实浏览器验收使用隔离 fixture，不使用真实项目工作区或真实任务内容。
