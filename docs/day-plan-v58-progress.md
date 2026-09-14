# v58 开发进度：建立 release workflow 与打包完整性的静态 contract

> 最后更新：2026-09-14

> v57 已完成并推送；v58 已建立，当前只做 release workflow inventory 和 bounded contract，
> 不创建 tag 或发布 Release。

## 当前状态

`.github/workflows/release.yml` 已有四 target 的 build matrix，并负责 release binary、tar.gz、
SHA-256 sidecar、artifact upload 和 tag-only publish。README 也记录了四个 supported targets，
但目前没有发现专门的 release workflow contract；这条边界先通过静态测试验证，不假设真正的
跨平台发布已被本地执行。

## 已完成

- [x] 建立 `docs/day-plan-v58.md`，限定为 release workflow 与 packaging contract。
- [x] 读取 release workflow 的 matrix、protobuf/toolchain、cross linker、release build、
  package/checksum、upload 和 publish 条件。
- [x] 对照 README 的 supported target 与 tag/manual release 说明。
- [x] 保留 v56 hosted macOS evidence 与 v57 clean/warmed artifact decision，不重新打开已有
  sandbox/runtime 行为。

## 待完成

- [ ] 确认没有现有 release workflow contract，并选择不重复 gate authority 的测试位置。
- [ ] 写 RED focused contract，锁定 target 与 packaging/publish 边界。
- [ ] 根据测试结果只做必要的 workflow/README 修复，或记录 Preserve。
- [ ] 运行验证、更新 CHANGELOG，并决定是否建立 v59。

## 当前决策

**Inventory first / no tag publish。** 先验证 workflow 文本与 README 的一致性；静态 contract
不能替代真实四平台 release run，也不能把普通 CI 的绿色解释为发布成功。

## 下一步

1. 在现有 release-gate contract 附近增加一个不触发 workflow 的 release contract 测试。
2. 运行 RED/GREEN 与固定 gate 的必要子集。
3. 只在发现具体 mismatch 时修改 workflow，并用普通 push CI 验证。
