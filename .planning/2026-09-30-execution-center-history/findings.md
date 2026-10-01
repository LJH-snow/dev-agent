# Findings — Execution Center v3

## 现有边界

- DesktopRunState 当前只在内存中保留完整 replay event；Execution Center 只读聚合当前 run。
- server.ts 在 Autofix、普通 chat 和 plan apply 三条路径创建 DesktopRunState，并由 stream helper 统一 finish。
- scheduled-tasks.ts 已提供私有目录、JSON schema、1 MiB cap、原子临时文件写入模式，可复用其持久化原则。

## 设计决定

- history store 与 run replay 分离，避免把原始事件或 live fragments 写入磁盘。
- 只从 DesktopRunState 的终态 metadata 生成记录；进程重启中的未完成 run 不伪造成成功。
- Execution Center route 通过 historySessionId 查询单个 session 历史，默认当前 session。
