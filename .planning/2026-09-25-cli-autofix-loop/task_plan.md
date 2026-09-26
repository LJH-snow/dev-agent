# CLI 自动验证与自修复闭环

## 目标
在现有 trusted validation 和交互式 CLI 基础上，增加 `:autofix [次数]`：读取最近一次 failed/blocked 验证，生成脱敏失败摘要，驱动 Agent 只修复对应问题，并在每轮后复用受信任验证。最多 3 轮，支持取消、失败和无可修复结果的明确状态。

## 阶段
- [in_progress] 设计并实现纯函数解析、摘要和闭环协调器
- [pending] 接入 readline 与 Ink 两条交互路径及帮助提示
- [pending] 补 focused unit/integration tests
- [pending] 更新 CLI 文档和规划记录
- [pending] 构建、CLI focused tests、全量回归

## 约束
- 保留工作区已有未提交 Settings/Desktop 改动；不 reset/clean。
- 不记录原始工具输出、密钥、完整 prompt 或绝对路径。
- 远程 GitHub 工作流暂不在本阶段实现。
