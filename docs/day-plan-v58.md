# Day plan v58：建立 release workflow 与打包完整性的静态 contract

**建立日期：2026-09-14**

**当前状态：已完成；静态 release workflow contract 已进入 fixed TypeScript gate，未创建 tag 或发布 Release。**

> 本计划承接 `docs/day-plan-v57.md`。v57 已完成 clean/warmed verification inventory，并将
> artifact 前置条件明确记录。当前 `.github/workflows/release.yml` 已支持四个发布 target、
> Rust release build、tar.gz 与 SHA-256 sidecar、artifact upload 和 tag-only publish，但
> fixed release-gate contract 还没有覆盖这条 workflow。v58 只补静态可验证的 packaging contract，
> 不把未执行的发布当作成功证据。

## Goal

用一个 bounded workflow contract 锁定 release workflow 与 README 中已经承诺的边界：

- target matrix 覆盖 Apple Silicon/Intel macOS 与 x86_64/aarch64 Linux；
- 每个 target 安装对应 Rust target、protobuf/toolchain 和必要 cross linker；
- release binary 的构建、归档、相邻 SHA-256 checksum、artifact upload 均 fail-fast；
- 只有 tag push 发布 GitHub Release，manual `workflow_dispatch` 只构建验证，不发布。

## Global constraints

- 不创建或推送 `v*` tag，不调用 release publish API，不消耗新的外部服务状态。
- 不改变 Rust/TypeScript runtime、protobuf schema、Evidence、session、Undo、公开 API/schema。
- 只使用现有 Node test runner 与已安装 YAML/parser tooling；不新增运行时依赖。
- contract 只检查固定 workflow 文本/解析后的结构，不执行 shell、上传 artifact 或解析历史
  release evidence。
- 如果 workflow 与文档已经一致，优先只增加覆盖并记录 Preserve，不做 speculative packaging
  重构。

## Task 0：inventory 与 source of truth

- [x] 读取 `.github/workflows/release.yml` 的 matrix、build、package、upload 和 publish jobs。
- [x] 对照 README 的 supported targets、release command 与 checksum 说明。
- [x] 确认当前仓库没有 release workflow contract；新增独立测试，不重复已有 gate authority。

## Task 1：RED contract

- [x] 写 focused release workflow contract，覆盖 target 集合、cross linker、release build、
  checksum、artifact upload 和 tag-only publish。
- [x] 将 contract 接入 fixed TypeScript gate；测试不创建 tag、不运行 workflow。

## Task 2：最小实现

- [x] contract 通过，未发现 workflow/README mismatch，因此只保留静态测试覆盖，不改 release
  workflow。
- [x] 没有将静态 contract 扩展成动态 release simulator 或 checksum parser。

## Task 3：验证、文档与下一阶段

- [x] 运行 focused release contract **2/2**、release-gate contract **12/12**、structure/diff
  checks。
- [x] 没有修改 release workflow、创建 tag 或触发 release；普通 CI 只需验证新 gate step。
- [x] 更新 v58 progress、CHANGELOG，并建立 `docs/day-plan-v59.md`。

## Acceptance checklist

- [x] release target matrix 与 README 承诺一致。
- [x] packaging/checksum/upload/tag-only publish 边界有静态 contract。
- [x] 没有真实发布、artifact 上传或 runtime/API/schema 回归。
- [x] fixed gate 的命令 authority、fail-fast 和 metadata-only report 边界保持不变。
