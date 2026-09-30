# Claude Agent SDK 取消生命周期维护

## 目标

继续完善可选 Anthropic SDK adapter 的取消与清理边界：取消已经发生时不启动 query；取消发生在 query factory 创建期间时也必须关闭已创建的 query，避免孤儿进程/transport。

## 范围

- 仅修改 `packages/claude-agent-sdk/src/index.ts` 与对应 adapter tests。
- 不触碰当前工作区其他窗口的 Ink、planning、`.mimosa/`、`.zcode*` 改动。
- 保持现有 tool/approval/sandbox 边界与公开 API 不变。

## 阶段

- [complete] 写 failing tests，锁定 pre-aborted 与 factory-race 语义。
- [complete] 实现最小生命周期修复。
- [complete] 运行 package focused tests、typecheck/build 与 diff check。
- [complete] 仅提交本切片文件并推送当前分支。
