# Day plan v59：验证 release artifact 的可复核 smoke boundary

**建立日期：2026-09-14**

**当前状态：已完成；host 单 target smoke 通过，永久 smoke script/fixed gate 维持 Preserve/NO-GO。**

> 本计划承接 `docs/day-plan-v58.md`。v58 已将 release workflow 的静态 matrix/package/tag
> contract 接入 fixed TypeScript gate，但静态文本检查不能证明 tar.gz 中确实包含目标 binary、
> README 和可验证的 SHA-256。v59 研究了一个不发布的、低成本 artifact smoke boundary；结果
> 记录为手工 evidence，不复制完整 GitHub Release。

## Goal

确认 release workflow 的 packaging contract 是否需要一个本地可重复的单 target smoke：

- 构建一个当前 host 支持的 release binary；
- 按 workflow 同样的命名/目录规则生成临时 tar.gz 与 checksum；
- 在隔离目录验证 archive 内容、checksum 和 executable bit；
- 不创建 tag、不上传 artifact、不调用 GitHub Release。

## Global constraints

- 不改变 runtime/API/schema、release workflow 的 target matrix 或发布权限。
- 不把 smoke 当作四平台 release 证明；它只能验证 packaging shape 和 checksum mechanics。
- 不把临时 artifact 写入 tracked 文件或公开 release report；使用隔离目录并在验证后清理。
- 没有稳定 consumer 时不新增脚本、依赖或固定 gate step。

## Task 0：inventory

- [x] 对照 `.github/workflows/release.yml` 的 Package step 与当前 Rust/README release instructions。
- [x] 确认当前没有可复用的 package/checksum smoke 工具。
- [x] 选择 `aarch64-apple-darwin` host target 与隔离临时目录策略，不触发 tag workflow。

## Task 1：decision contract

- [x] 评估 single-target smoke 的维护 consumer；没有明确 consumer，不写 permanent script。
- [x] 记录 Preserve/NO-GO，不增加 wrapper、计数解析或重复 release authority。

## Task 2：最小实现

- [x] 执行一次隔离单 target smoke，验证 archive/checksum/executable bit；未改变 tracked
  workflow 或 runtime。
- [x] 保持 workflow 的 `set -euo pipefail`、checksum fallback 和 artifact paths 不变。

## Task 3：验证、文档与下一阶段

- [x] 完成 focused release contract **2/2**、当前 host packaging smoke 和 diff checks。
- [x] 不触发 Release；没有创建 tag、上传 artifact 或调用 publish API。
- [x] 更新 v59 progress、CHANGELOG，并建立 `docs/day-plan-v60.md`。

## Acceptance checklist

- [x] 没有把单 target smoke 误报为四平台 release 成功。
- [x] 临时 archive/checksum 未污染 tracked workspace。
- [x] 没有无证据增加 release automation 或 publish authority。
