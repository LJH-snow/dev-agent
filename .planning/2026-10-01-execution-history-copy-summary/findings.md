# Findings — 复制运行摘要

- Execution Center 已通过 callback 注入剪贴板能力；主页面已有共享 copyText helper。
- HistoryRecord 仅含 run/session IDs、状态、时间、耗时、计数及可选验证状态；复制摘要应只使用这些 allowlisted 字段。
- 不复制 sessionId、validationId、changeSetId、提示词、命令、文件路径或原始输出。
