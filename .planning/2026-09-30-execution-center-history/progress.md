# Progress — Execution Center v3

## 2026-09-30

- 已确认 current run replay 仍保持内存 bounded，持久化只需要新增终态 summary store。
- 已确认三条运行路径分别是 Autofix、普通 chat 和 plan apply；并行窗口的 .mimosa/ 变更保持只读。
- 下一步先补 history store、终态记录和只读查询的 RED 测试。
- 已完成私有原子 history store、每 session 50 条/总 1 MiB 上限、run 终态 metadata 记录和 historySessionId 查询。
- Execution Center 已显示最近终态运行；history 写入改为先更新内存、异步落盘，避免阻塞 inFlight 生命周期。
- history focused tests 4/4 通过；Desktop 全量测试 390/390 通过；文档契约 58/60，剩余两项是既有 0.1.8/0.2.0 发布版本漂移。
- session lifecycle 回归后 history focused tests 为 8/8；单独 Autofix v2 测试为 17/17。随后全量回归为 390/391，唯一失败是并行窗口 Autofix 临时 worktree 的 ENOTEMPTY 清理竞态，未修改其文件。
- 通过 apps/desktop 包目录重新运行最终全量回归，Desktop 测试为 391/391；custom session 的默认 history 改为内存模式，正式启动路径仍使用默认私有 history 文件。
