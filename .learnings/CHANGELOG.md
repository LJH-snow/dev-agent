{"ts":"2026-09-30T15:00:00+08:00","action":"add","type":"learning","id":"LRN-20260930-001","summary":"共享工作区需在写入和提交前检查同文件并行改动，重叠后撤回自身块并精确暂存","target":".learnings/LEARNINGS.md"}
{"ts":"2026-09-30T22:14:00+08:00","action":"add","type":"error","id":"ERR-20260930-001","summary":"多行 apply_patch 外层模板中的反引号和转义可能导致脚本解析失败","target":".learnings/ERRORS.md"}
{"ts":"2026-09-30T22:14:00+08:00","action":"add","type":"error","id":"ERR-20260930-002","summary":"文档契约存在 0.1.8 与 0.2.0 的既有发布版本漂移","target":".learnings/ERRORS.md"}
{"ts":"2026-09-30T23:50:00+08:00","action":"add","type":"error","id":"ERR-20260930-003","summary":"终态历史写入不能阻塞 HTTP session 锁释放，否则后续请求会错误 409","target":".learnings/ERRORS.md"}
{"ts":"2026-10-01T09:10:00+08:00","action":"resolve","type":"error","id":"ERR-20260930-002","summary":"发布状态文档现分别记录 npm 0.2.0 与 GitHub v0.1.8，契约不再要求独立渠道版本强行同步","target":".learnings/ERRORS.md"}
{"ts":"2026-10-01T21:48:45+08:00","action":"add","type":"error","id":"ERR-20261001-001","summary":"TypeScript release gate 的两个 CLI 集成用例超时，需与本轮证据改动隔离复跑","target":".learnings/ERRORS.md"}
{"ts":"2026-10-01T21:50:00+08:00","action":"resolve","type":"error","id":"ERR-20261001-001","summary":"两个 CLI 用例串行隔离复跑通过，判定为并发负载时序波动","target":".learnings/ERRORS.md"}
{"ts":"2026-10-01T22:10:00+08:00","action":"update","type":"error","id":"ERR-20261001-001","summary":"完整 TypeScript gate 第二次在高负载 CLI 全套中复现 model-routing 超时，隔离运行仍通过","target":".learnings/ERRORS.md"}
{"ts":"2026-10-01T22:35:00+08:00","action":"update","type":"error","id":"ERR-20261001-001","summary":"第三次全套 TypeScript gate 的 background-jobs explicit resume 超时，相关 CLI 用例隔离复跑 3/3 通过","target":".learnings/ERRORS.md"}
{"ts":"2026-10-02T12:24:59+08:00","action":"add","type":"error","id":"ERR-20261002-001","summary":"Terminal 输入迟到响应在 session 切换后错误改写新 task 状态，已加 generation/session/run guard","target":".learnings/ERRORS.md"}
{"ts":"2026-10-02T12:24:59+08:00","action":"add","type":"error","id":"ERR-20261002-002","summary":"Terminal refresh 和 Preview cleanup 的旧 session 副作用已用 generation guard 与 silent cleanup 修复","target":".learnings/ERRORS.md"}
{"ts":"2026-10-02T14:52:26+08:00","action":"add","type":"error","id":"ERR-20261002-003","summary":"Midscene 初次非法 URL 断言使用错误措辞，改用截图中的 loopback 文案后通过","target":".learnings/ERRORS.md"}
{"ts":"2026-10-02T14:52:26+08:00","action":"add","type":"error","id":"ERR-20261002-004","summary":"rg alternation 中未转义括号导致正则解析错误，已拆分查询并转义","target":".learnings/ERRORS.md"}
{"ts":"2026-10-02T15:15:46+08:00","action":"add","type":"error","id":"ERR-20261002-005","summary":"MCP 失败 reconnect/list_changed 刷新保留旧 capabilities，已在 session 失效路径清空","target":".learnings/ERRORS.md"}
{"ts":"2026-10-02T15:55:28+08:00","action":"add","type":"error","id":"ERR-20261002-006","summary":"MCP 缺失 resources/prompts metadata 时错误生成 wrapper，已在 CLI/Desktop/worker 注册层加 capability guard","target":".learnings/ERRORS.md"}
{"ts":"2026-10-02T16:18:51+08:00","action":"add","type":"error","id":"ERR-20261002-007","summary":"sandbox expansion approval callback 未受 AbortSignal 约束导致取消挂起，已加入 awaitAbortable","target":".learnings/ERRORS.md"}
{"ts":"2026-10-02T16:18:51+08:00","action":"add","type":"error","id":"ERR-20261002-008","summary":"Rust LocalExecutor 大输入 output-cap 竞态将 BrokenPipe 误报为失败，已规范化 stdin 关闭路径","target":".learnings/ERRORS.md"}
{"ts":"2026-10-03T00:39:09+08:00","action":"update","type":"error","id":"ERR-20261001-001","summary":"完整 CLI gate 再现高负载等待窗口，扩大 approval/validation 测试有界超时并以组合 3/3 回归确认"}
{"ts":"2026-10-03T02:34:36+08:00","action":"resolve","type":"error","id":"ERR-20261001-001","summary":"最终完整 pnpm verify 通过，CLI 823/823、Desktop 444/444，Ink 聚合帧和等待边界保持稳定"}
