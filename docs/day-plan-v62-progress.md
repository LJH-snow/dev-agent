# v62 开发进度：Linux `bwrap` hosted live integration

> 最后更新：2026-09-14

## 当前状态

**In progress / RED contract established / Linux hosted evidence pending.**

v62 目标是补齐已经声明 active 的 Linux `bwrap` backend 的真实 Ubuntu hosted evidence，
不扩大公开 API、protobuf、release target 或 Windows 支持范围。

## 已完成

- [x] 完成 v62 capability inventory：integration harness 原先只把 macOS backend 视为
  live，Linux `bwrap` 只有参数构造测试和条件式 live test。
- [x] 确认 hosted job 的 fail-closed prerequisites：Ubuntu、`bubblewrap`、user/network
  namespace、protobuf compiler、debug Rust binary、Python socket fixture 和 executor
  `dist`。
- [x] 建立 `tests/release-gate.test.mjs` 的 Linux integration RED contract；在 workflow
  尚无 `linux-integration` job 的基线上按预期失败。
- [x] 建立跨平台 integration harness 的行为断言方案，network negative test 使用真实
  host listener，而不是未监听端口。

## 进行中

- [x] 添加 `.github/workflows/ci.yml` 的独立 `linux-integration` job。
- [x] 将 `packages/executor/tests/real-rust-integration.integration.ts` 从 macOS-only
  capability detection 改为 macOS/Linux platformized detection。
- [x] 运行本地 macOS fixed gate，Rust 43/43、TypeScript release gate 和 real-Rust
  integration 10/10 均通过。
- [ ] 推送修复后的版本并核对 GitHub-hosted Ubuntu run 的真实结果，记录 skipped 数量和
  capability evidence。

## 首次 hosted run 发现

- [x] run `34839400282` 的 TypeScript、Rust、macOS integration 均通过；Linux job 在 Rust
  release gate 的 `linux_bwrap_runs_echo` 失败。真实原因是 `build_bwrap_args` 在只读 root
  bind 后又尝试 bind `/root` 等 hosted runner 上存在但 workflow 用户不可读的 nested path。
- [x] 先添加 failing Rust unit assertion，确认不应在 `--ro-bind / /` 后重复挂载 nested
  standard paths；再把 backend 改为只读 root 单一 bind，并保留 `/proc`、`/dev`、`/tmp` overlay。
- [x] 第二次 hosted run `34840227357` 证明 nested bind 已修复，但暴露 `bwrap: loopback: Failed
  RTM_NEWADDR: Operation not permitted`；先添加 failing unit assertion，再让 user namespace
  内以 uid/gid 0 配置 loopback，并同步到 hosted prerequisite probe。
- [ ] 带 uid/gid 修复的 hosted run 仍待获取；不能把前两次失败当作 Linux evidence 通过。

## 当前阻塞/风险

- 本地开发机是 macOS，不能直接提供 Linux namespace live evidence。
- GitHub-hosted Ubuntu 的 user namespace policy、`bwrap` loopback 初始化和路径 bind 语义
  必须以 hosted run 为准；如果失败，保留 failing evidence 并修正实现/contract，不包装为
  skipped。

## 证据记录

| 项目 | 当前证据 | 状态 |
| --- | --- | --- |
| macOS real-Rust integration | 现有 hosted gate 10/10 | 已有 |
| Linux `bwrap` argument builder | Rust unit tests | 已有但非 live |
| Linux hosted live integration | `34839400282` nested bind 失败；`34840227357` loopback 权限失败；uid/gid 修复后待重跑 | 待完成 |
| TypeScript/Rust/release/docs gates | v61/v62 focused checks | 待本轮最终复核 |

## 下一步

已实现 RED contract 对应的 Linux job；下一步推送 nested bind 修复并重新获取 Ubuntu hosted run，
然后把成功且无 skipped 的结果作为 v62 最终 acceptance evidence。
