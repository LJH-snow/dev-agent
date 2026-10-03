# Findings — 验证结果筛选

- 历史记录已有可选 validationStatus，筛选可直接使用已清洗的状态字段。
- 整体运行状态与验证状态彼此独立；例如 run 为 done 但 validationStatus 为 failed。
- 旧历史记录没有 validationStatus，应可通过“无验证结果”选项单独定位。
- 此功能只过滤已加载的有界列表，不需要服务端查询或持久化改动。
