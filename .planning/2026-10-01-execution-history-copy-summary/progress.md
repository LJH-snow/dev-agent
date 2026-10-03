# Progress — 复制运行摘要

## 2026-10-01

- 开始给选中的历史运行增加一键复制的 metadata-only 摘要。
- 保留并行 Autofix、.mimosa/、本地凭据和提交边界。
- RED 测试确认复制按钮启用、只复制 allowlist 摘要，并显示剪贴板成功/失败反馈；历史模块 14/14 通过。
- Desktop 全量测试 400/400 通过；build 与 git diff --check 通过。
- 未提交或推送；并行 Autofix 与 .mimosa/ 保持不变。
- RED 测试确认选中运行后复制按钮仍禁用；测试还覆盖私密字段排除和剪贴板失败反馈。
