# Execution Center v2 操作详情

## 目标

把现有只读 Execution Center 扩展为可操作的运行详情抽屉：选中 session 后展示
状态、阶段、工具/审批和耗时，并复用已有 Stop、Trace、Validation、Autofix 入口。

## 边界

- 不新增服务端 mutation API 或权限；所有动作复用现有入口和 guard。
- 不保存原始 prompt、tool output、command、凭据或绝对路径。
- 保留并行窗口的 apps/desktop/tests/capabilities.test.ts 与 .mimosa/ 变更。
- 详情渲染继续使用 textContent，动作按钮必须可键盘访问并在无目标时禁用。

## 阶段

- [x] 补详情抽屉、动作按钮和回调的 failing contract tests。
- [x] 接入现有 Stop、Trace、Validation、Autofix 生命周期。
- [x] 增加样式、双语文案和 stale/selection 状态处理。
- [x] 运行 focused、Desktop 全量、静态检查和文档验证。

## 验收标准

- 点击任一 execution card 后显示详情；刷新后仍选择当前 session 或当前活跃 session。
- Stop 只取消选中的 session；Trace/Validation 会先切换到目标 session 再打开对应面板。
- Autofix 只在当前 session 存在 failed/blocked validation 时启用，否则保持 disabled/fail-closed。
- 现有 Desktop 测试保持通过，不改变已有 mutation API 和审批边界。
