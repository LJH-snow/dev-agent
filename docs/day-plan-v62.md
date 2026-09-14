# Day plan v62：Linux `bwrap` hosted live integration

**建立日期：2026-09-14**

**当前状态：进行中；先建立 RED contract，再接入 Ubuntu hosted live evidence。**

> v61 完成了 Windows restricted execution 的 feasibility review，结论是保持
> macOS `sandbox-exec`、Linux `bwrap`，其他平台 fail-closed `Unsupported`。v62 不扩大
> 公开 API、protobuf、release target 或 Windows 支持范围，只补齐已经声明 active 的 Linux
> backend 的真实 hosted evidence。

## Goal

让 macOS 与 Linux 都有可复核的 real-Rust restricted execution evidence，尤其验证 Linux
`bwrap` 的 filesystem、network、cwd、timeout、cancel、output quota、concurrency 和
child-process 边界；能力缺失必须让 job 失败，不能被测试 skip 或包装成成功。

## Global constraints

- 不把 `LocalExecutor` 作为 restricted execution 的 fallback。
- 不修改 protobuf、公开 TypeScript API、release target matrix 或 Windows 支持边界。
- 不把静态 argument-builder 测试、模拟 runner 或 skipped test 当作 Linux live proof。
- hosted workflow 必须显式安装并检查 `bubblewrap`、user namespace、Rust binary、Python
  fixture 和 executor `dist`；任何 prerequisite 缺失都独立失败。
- 允许 macOS/Linux 使用平台化错误断言，但不能降低行为安全断言的强度。
- 不创建 release tag、GitHub Release 或新的 artifact 发布入口。

## Task 0：capability inventory

- [x] 盘点 integration harness 的 macOS-only 判断、Python fixture 和当前 10 个行为覆盖。
- [x] 盘点 Linux `RestrictedExecutor` 的 `bwrap` 参数构造、profile timeout/resource
  组合和现有 unit/live test。
- [x] 确认 Ubuntu job 需要独立验证：`bubblewrap` binary、user namespace、network
  namespace、protobuf compiler、debug Rust binary、Python socket fixture 和 executor
  `dist`。
- [x] 记录平台差异：macOS network deny 通常返回 sandbox errno；Linux network namespace
  失败可能表现为 `Network is unreachable` 或 `Connection refused`，断言必须验证真实
  boundary，而不是固定错误文案。

## Task 1：RED contract

- [x] 在 `tests/release-gate.test.mjs` 增加 Linux integration job contract。
- [x] contract 锁定 Ubuntu runner、bubblewrap 安装、CI-only user namespace setup、独立
  prerequisite checks、显式 Rust build、executor build、`DEV_AGENT_REQUIRE_LIVE_SANDBOX=1`
  和固定 gate 顺序。
- [x] 先在没有 Linux job 的基线上观察 contract 失败，再实现 workflow。

## Task 2：platformized real integration

- [x] 让 TypeScript integration harness 在 macOS 和 Linux 识别对应 backend，而不是把 Linux
  全部标记为 skip。
- [x] 为 hosted Linux job 增加 fail-closed live capability assertion，防止 binary 或
  backend 缺失时静默 skip。
- [x] 将 network-deny 断言改为连接真实 host fixture，避免“未监听端口的 connection
  refused”伪造 network isolation evidence。
- [x] 保留并验证 Starlark deny/allow、readonly/write、network disabled/loopback、timeout、
  output quota、cancel 和 runtime concurrency 的真实路径。
- [ ] 通过 GitHub-hosted Ubuntu job 获取真实 Linux evidence，并确认无 skipped integration。

## Task 3：验证与记录

- [x] 更新 CI/release contract、README、architecture、runtime README 和 CHANGELOG，准确
  区分 macOS 与 Linux live evidence。
- [x] 本地 macOS fixed gate 保持通过。
- [ ] hosted Linux integration 成功后，将 run URL、测试数量和 capability evidence 写入
  `docs/day-plan-v62-progress.md`。
- [ ] 不修改 release target matrix，不创建 release tag。

## Acceptance checklist

- [ ] Linux hosted integration job 运行在 Ubuntu，显式安装并检查 `bubblewrap`。
- [ ] CI-only user namespace/AppArmor setup、user namespace / network namespace / Python /
  Rust binary / executor dist 缺失会让 job 独立失败。
- [ ] Linux integration 没有静默 skip，所有预期测试明确通过。
- [ ] macOS integration 继续为 10/10，且 TypeScript、Rust、release 和 documentation
  contracts 全部通过。
- [ ] 真实 network fixture 证明 disabled 与 loopback 行为，不依赖固定平台错误文案。
- [ ] 无新的公开 API、protobuf 字段、无沙箱 fallback、Windows backend 或 release target。

## 下一步

实现 `.github/workflows/ci.yml` 的 `linux-integration` job，推送后等待 hosted evidence；
如果 runner 暴露 bwrap 参数或 namespace 的真实问题，先写 failing test/contract，再修正
backend，不用 skip 或放宽断言掩盖问题。
