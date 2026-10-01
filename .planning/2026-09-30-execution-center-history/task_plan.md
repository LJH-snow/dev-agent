# Execution Center v3 持久化运行历史

## 目标

让 Desktop 在重启后仍能显示每个 session 最近的 bounded run summary，并在
Execution Center 中查看历史运行；只持久化状态元数据，不保存原始事件或输出。

## 范围

- 新增独立 execution history store，默认私有文件、原子写入、总大小不超过 1 MiB。
- 每个 session 最多保留 50 条最近终态记录，非法或过大的文件 fail-closed。
- 在 chat、Autofix 和 plan apply 三条运行结束路径写入历史。
- 新增只读 history 查询和 Execution Center 历史列表；保留现有 current run API。
- 不触碰 .mimosa/ 或并行窗口文件，不提交原始 prompt、tool output、command、凭据和路径。

## 阶段

- [x] 先补 history store、run summary 和 route/UI 的 failing tests。
- [x] 实现持久化 store 与三条运行结束路径接线。
- [x] 接入 Execution Center 历史查询、刷新和 session 切换。
- [x] 运行 focused、Desktop 全量、静态检查和文档验证。

## 验收标准

- 同一 history 文件重载后恢复记录；损坏、超限和不可信记录被忽略，不阻塞 Desktop 启动。
- 运行历史最多 50 条/session，总序列化大小最多 1 MiB，写入使用私有权限和临时文件替换。
- 历史记录只包含 runId、状态、时间、耗时、sequence 和 bounded counters。
- history route 只读、session-bound、响应 bounded；UI 在 session 切换和 stale response 下保持正确。
