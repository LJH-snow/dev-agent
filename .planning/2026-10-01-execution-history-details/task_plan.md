# Execution Center 历史详情与证据关联

## 目标

点击历史运行记录后显示可读详情，并把该运行关联的验证与变更集证据链接到
现有 session history 面板；不持久化 prompt、原始工具输出或敏感内容。

## 阶段

- [ ] 梳理验证/变更集 evidence 的稳定 ID 与现有 UI 导航入口。
- [ ] 补运行详情、证据关联和旧记录兼容的 RED 测试。
- [ ] 扩展 bounded history schema、Desktop API 与历史详情 UI。
- [ ] 运行 focused、Desktop 全量、文档和静态检查。

## 边界

- 只写入 allowlisted validationId、changeSetId、validationStatus 等 bounded metadata。
- 历史详情只读；证据按钮跳转到当前 session 已有的 history/evidence，不触发重跑、apply 或模型调用。
- 保留并行窗口 apps/desktop/src/autofix.ts、apps/desktop/tests/autofix-loop.test.ts 和 .mimosa/ 变更。
- 不自动提交或推送。
