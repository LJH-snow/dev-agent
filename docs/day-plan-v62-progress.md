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

- [ ] 添加 `.github/workflows/ci.yml` 的独立 `linux-integration` job。
- [ ] 将 `packages/executor/tests/real-rust-integration.integration.ts` 从 macOS-only
  capability detection 改为 macOS/Linux platformized detection。
- [ ] 运行本地 macOS fixed gate，确保 10/10 仍通过。
- [ ] 推送后获取并核对 GitHub-hosted Ubuntu run 的真实结果，记录 skipped 数量和失败原因。

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
| Linux hosted live integration | 尚未运行 | 待完成 |
| TypeScript/Rust/release/docs gates | v61/v62 focused checks | 待本轮最终复核 |

## 下一步

先实现并运行 RED contract 对应的 Linux job，再修正 platformized integration harness；
之后把 Ubuntu hosted run 作为 v62 的最终 acceptance evidence。
