# Day plan v59：验证 release artifact 的可复核 smoke boundary

**建立日期：2026-09-14**

**当前状态：已建立；先评估是否需要本地单 target package/checksum smoke，不触发真实发布。**

> 本计划承接 `docs/day-plan-v58.md`。v58 已将 release workflow 的静态 matrix/package/tag
> contract 接入 fixed TypeScript gate，但静态文本检查不能证明 tar.gz 中确实包含目标 binary、
> README 和可验证的 SHA-256。v59 只研究一个不发布的、低成本的 artifact smoke boundary；若
> 没有明确 consumer，保持 Preserve/NO-GO，不复制完整 GitHub Release。

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

- [ ] 对照 `.github/workflows/release.yml` 的 Package step 与当前 Rust/README release instructions。
- [ ] 确认当前没有可复用的 package/checksum smoke 工具。
- [ ] 选择 host target 与隔离临时目录策略，不触发 tag workflow。

## Task 1：decision contract

- [ ] 如果发现可以复现且有明确维护者 consumer，先写 RED smoke contract。
- [ ] 如果只有静态 workflow contract 的需求，记录 Preserve/NO-GO，不增加脚本。

## Task 2：最小实现

- [ ] 仅在 Task 1 通过时实现单 target smoke，并验证 archive/checksum/executable bit。
- [ ] 保持 workflow 的 `set -euo pipefail`、checksum fallback 和 artifact paths 不变。

## Task 3：验证、文档与下一阶段

- [ ] 运行 focused smoke/contract、固定 TypeScript gate 和 diff checks。
- [ ] 不触发 Release；若 workflow 变化，只观察普通 CI。
- [ ] 更新 v59 progress、CHANGELOG，并基于证据决定下一阶段。

## Acceptance checklist

- [ ] 不把单 target smoke 误报为四平台发布成功。
- [ ] 临时 archive/checksum 不污染 tracked workspace。
- [ ] 没有无证据增加 release automation 或 publish authority。
