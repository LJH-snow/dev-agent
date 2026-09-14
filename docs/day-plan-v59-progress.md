# v59 开发进度：验证 release artifact 的可复核 smoke boundary

> 最后更新：2026-09-14

> v58 已完成并推送；v59 已建立，当前只做 release packaging smoke 的 consumer/inventory 审计，
> 不创建 tag、不发布 Release。

## 当前状态

v58 的静态 release workflow contract 已锁定四 target、release build、tar/checksum、artifact
upload 和 tag-only publish。v59 要先判断是否需要一个本地单 target artifact smoke 来验证 archive
形状；静态 contract 与真实四平台 release 仍然是不同证据。

## 已完成

- [x] 建立 `docs/day-plan-v59.md`，明确不触发真实发布。
- [x] 保留 v58 的 release workflow contract 和 v56 的 hosted macOS integration evidence。

## 待完成

- [ ] inventory Package step、release instructions 和现有可复用工具。
- [ ] 判断是否存在明确 smoke consumer。
- [ ] 若有 consumer，写 RED contract 并实现隔离 single-target smoke；否则记录 Preserve/NO-GO。
- [ ] 更新文档并决定是否建立 v60。

## 当前决策

**Inventory first / no publish.** 单 target smoke 只能补 packaging shape 证据，不能代替四
platform release；不因为“可能有用”就增加 release automation。

## 下一步

1. 读取现有 package/checksum workflow 和 release documentation。
2. 复核当前 host 是否能安全生成临时 artifact。
3. 只在有稳定 consumer 与具体 mismatch 时继续实现。
