# v58 开发进度：建立 release workflow 与打包完整性的静态 contract

> 最后更新：2026-09-14

> v58 已完成并推送。普通 CI run **34810638031** 已验证 release workflow contract **2/2**；
> 没有创建 tag、上传 artifact 或发布 GitHub Release。

## 最终状态

`.github/workflows/release.yml` 已有四 target 的 build matrix，并负责 release binary、tar.gz、
SHA-256 sidecar、artifact upload 和 tag-only publish。README 也记录了四个 supported targets。
此前没有专门的 release workflow contract；v58 已增加静态覆盖，但没有假设真正的跨平台
发布已被本地执行。

## 已完成

- [x] 建立 `docs/day-plan-v58.md`，限定为 release workflow 与 packaging contract。
- [x] 确认没有现有 release workflow contract，选择独立 `tests/release-workflow.test.mjs`，
  并将其作为 fixed TypeScript gate 的独立 step。
- [x] 写 focused contract，覆盖四个 target、Rust target setup、Linux arm64 cross linker、
  release build、tar/checksum、artifact upload、manual dispatch 和 tag-only publish。
- [x] 当前 workflow 已满足 contract，没有做 speculative release workflow 重构。
- [x] 保留 v56 hosted macOS evidence 与 v57 clean/warmed artifact decision，不重新打开已有
  sandbox/runtime 行为。
- [x] focused contract **2/2**，release-gate plan contract **12/12**。
- [x] 推送后普通 CI run **34810638031** 的 Rust、TypeScript 和 macOS integration jobs 全部
  成功；hosted TypeScript log 明确记录 release workflow contract **2/2、0 failures**。

## 最终决策

**GO for static contract / Preserve release workflow。** 静态 contract 锁定了发布边界，但不能
替代真实四平台 release run；本轮没有创建 tag、上传 artifact 或发布 GitHub Release。后续只有
在 release workflow 或 target/toolchain 发生真实变化时重新运行/扩展该 contract。

## 发布状态

- [x] release workflow contract 已进入 fixed TypeScript gate。
- [x] current workspace 的必要验证通过，`git diff --check` 通过。
- [x] CHANGELOG 和 v58 文档已更新。
- [x] 建立下一阶段入口：`docs/day-plan-v59.md`。
