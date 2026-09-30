# Desktop 执行状态中心 MVP

## 目标

在现有 Desktop 运行时间线、运行状态、并行运行和 Runtime Trace 之上，增加一个
统一的 bounded execution snapshot 与紧凑面板，让用户能快速看到所有 session 的
运行阶段、等待审批、失败和最近更新时间，并能点击回到对应 session。

## 范围

- 新增纯函数快照模型与 fail-closed normalization。
- 新增 loopback-only GET /api/execution-center 只读接口。
- 新增独立 public/execution-center.js 面板，不重写现有 Run timeline/Trace。
- 支持英文/中文、键盘可达、文本节点渲染和 stale-response 丢弃。
- 不新增 shell、网络、凭据、审批或文件写入能力；不修改并行窗口的现有文件。

## 阶段

- [x] 先写快照、路由和 UI contract 的 failing tests。
- [x] 实现 bounded 聚合快照与 Desktop route。
- [x] 接入 UI、轮询/刷新和 session focus。
- [x] 运行 focused tests、Desktop typecheck/build/full suite 和 diff check。

## 验收标准

- 快照只返回 metadata-only 状态，不包含 prompt、output、command、args、env、凭据或绝对路径。
- session 数量、文本、时间和响应体都有上限；非法输入被丢弃或降级为空快照。
- /api/execution-center 返回 schemaVersion、统计摘要、当前 session runtime 状态和 bounded session cards。
- UI 在 session 切换、运行结束和手动刷新后保持正确；旧请求不能覆盖新 session。
- 不触碰已有 apps/desktop/tests/capabilities.test.ts 未提交改动。

## 当前边界

- 2026-09-30：apps/desktop/tests/capabilities.test.ts 存在另一窗口的未提交改动，只读保留。
- 不提交、不推送、不修改 .mimosa/ 删除变更。
