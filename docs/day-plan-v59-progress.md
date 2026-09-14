# v59 开发进度：验证 release artifact 的可复核 smoke boundary

> 最后更新：2026-09-14

> v59 已完成。当前 host 的单 target packaging smoke 通过；没有新增脚本、依赖、tag 或发布
> 权限，release workflow 继续由静态 contract 和真实 release candidate 共同验证。

## 最终状态

对 `.github/workflows/release.yml` 的 Package step 做了隔离、单 target 手工 smoke，使用当前
host target `aarch64-apple-darwin`：

- `cargo build --release --bin dev-agent-executor --target aarch64-apple-darwin` 成功；
- 按 workflow 的目录/命名规则生成 tar.gz 与 SHA-256 sidecar，checksum verification 为 OK；
- archive 包含 executable `dev-agent-executor` 与 `README.md`；解包后 executable bit 保留；
- 临时 artifact 写在隔离目录，没有写入 tracked workspace，也没有创建 tag、上传 artifact 或
  发布 GitHub Release。

这补充了静态 workflow contract 的 packaging-shape evidence，但不等价于四平台 release 成功。

## 已完成

- [x] 对照 `.github/workflows/release.yml` 的 Package step 与 README release instructions。
- [x] 确认当前没有可复用的 package/checksum smoke 工具。
- [x] 选择 `aarch64-apple-darwin` host target 与隔离临时目录，未触发 tag workflow。
- [x] 完成 binary、README、archive、checksum 和 executable bit smoke。
- [x] 记录 smoke 不能证明其他三个 target，也不能替代真实 release candidate。

## 最终决策

**Preserve / NO-GO for adding a permanent smoke script or fixed gate step。** 单 target smoke 已经
证明当前 workflow 的 packaging mechanics 可复核；但没有明确维护者 consumer 要求每次本地 gate
都生成 release archive，新增自动化会重复 release workflow authority。保留 v58 静态 contract、
当前手工 smoke 路径和未来 release candidate 的真实证据边界。

## 发布状态

- [x] 没有创建 tag、上传 release artifact 或调用 GitHub Release。
- [x] 当前 workspace 未产生 tracked artifact。
- [x] v59 decision 与 CHANGELOG 已更新。
- [x] 建立下一阶段入口：`docs/day-plan-v60.md`。
