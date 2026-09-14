# CI real Rust integration decision（v55）

**日期：2026-09-14**

## Trigger

固定本地 `pnpm verify` 包含 `rust-integration`，但 `.github/workflows/ci.yml` 只有
`pnpm verify:typescript` 和 `pnpm verify:rust`。现有
`packages/executor/tests/real-rust-integration.integration.ts` 的 sandbox cases 要求 macOS
与 `/usr/bin/sandbox-exec`；在 Ubuntu 上这些 cases 会 skip，因此 Ubuntu Rust job 不能证明
live macOS sandbox enforcement。

## Minimal implementation

- root `package.json` 增加 `verify:integration`，只映射到
  `node scripts/release-gate.mjs --integration`。
- CI 增加固定 `macos-15` job：安装 pnpm、Node、Rust、protobuf 和 workspace dependencies；
  先执行 `pnpm verify:rust` 构建并验证 debug runtime。
- integration 前显式检查 debug binary、`/usr/bin/sandbox-exec` 和可导入 socket 的
  `python3`。缺少前置条件时 job 失败，不把 live coverage 静默降级为 skip。
- 最后执行 `pnpm verify:integration`，继续复用 release-gate 的固定 argv/cwd、无 shell 和
  fail-fast 语义。

## Contract and boundary

`tests/release-gate.test.mjs` 增加 workflow contract，锁定 root entrypoint、macOS job、Rust
gate→prerequisite→integration 的顺序以及 prerequisite checks。没有修改 runtime、protobuf、
Evidence、session、Undo、公开 API/schema、Rust policy 或 package dependencies。

## Local evidence

- RED：在实现前 contract 发现 root `verify:integration` 不存在，focused suite 为 11/12。
- GREEN：实现后 `node --test tests/release-gate.test.mjs` 为 **12/12**。
- `pnpm verify:integration` 为 **10/10**；本地 macOS prerequisites 已满足。
- fresh `pnpm verify` 全部通过；TypeScript workspace **614/614**、preview **8/8**、release-gate
  contract **12/12**、Rust unit/doc **46/46**、real-Rust integration **10/10**。
- YAML parse、structure check、`git diff --check` 和 `node --check scripts/release-gate.mjs` 均通过。

## Remaining external evidence

本地 contract 只能证明 workflow 文本和顺序；真正的 GitHub-hosted `macos-15` job 运行结果仍
需在 push 后观察 workflow run。若 runner image 不提供 `sandbox-exec`，该 job 应失败并转入
新的 runner compatibility decision，而不是放宽 prerequisite。

## Decision

**GO：补充 macOS live integration CI coverage。** 保持 Linux/Ubuntu Rust unit、macOS live
sandbox integration 和现有本地 full gate 的职责分层；不把 skipped tests 当作通过的 enforcement
证据。

## Hosted run evidence（v56 follow-up）

首个 push 后的 GitHub Actions run 为 [34806937694](https://github.com/LJH-snow/dev-agent/actions/runs/34806937694)，
对应 commit `70081840543f86ce9612599f4093bfed556357fa`。结果不是通过：

- Ubuntu `Rust` job 在 Linux-only 的 `linux_bwrap_runs_echo` 测试编译失败。远端报错表明
  `RestrictedExecutor::run` 需要第三个 `cancel` 参数，而测试只传了 request 和 profile；这
  是 macOS 本地编译无法发现的跨 target 调用错误。
- macOS `macOS integration` job 的 Rust gate 通过，但原先合并 binary、`/usr/bin/sandbox-exec`
  和 Python socket 检查的 fail-fast step 失败。由于三个命令在同一个多行 step 中，日志不能
  区分具体缺失的 capability；`pnpm verify:integration` 因前置失败没有执行。

因此，v55 的 hosted live evidence 仍然是 **pending**，不能把该 run 解释为
`sandbox-exec` 缺失，也不能把未执行的 integration 解释为 skip-free 通过。

## v56 minimum follow-up

- 在 `runtime/rust/src/restricted_executor.rs` 的 Linux-only test call 补齐 `None` cancel 参数，
  并用 `cargo check --tests --target x86_64-unknown-linux-gnu` 重现前后差异。
- 将 macOS prerequisite 拆成三个有名字的 steps：Rust binary、`sandbox-exec`、Python socket；
  保留每个 check 失败即停止的 fail-closed 语义。
- 用 `tests/release-gate.test.mjs` 锁定 steps 和顺序；本地 focused contract 保持 **12/12**。

下一次 hosted run 必须同时证明 Ubuntu Rust gate 通过、三个 macOS prerequisite steps 通过，
以及 `pnpm verify:integration` 真实输出 **10/10 且无 unexpected skip**。在此之前不切换
runner image、不放宽检查、不修改 runtime/API/schema。

## Second hosted run evidence（v56 follow-up）

第二个 run 为 [34807975071](https://github.com/LJH-snow/dev-agent/actions/runs/34807975071)，
对应 commit `130f22bfa093a4385196785b22261cd7e1708851`。第一项修复已生效：TypeScript、Ubuntu
Rust 和 macOS Rust gate 均通过；macOS job 随后在 `Check Rust binary prerequisite` 失败，后续
`sandbox-exec`、Python 和 integration steps 被正确阻断。

这次失败确认了 workflow artifact contract 的缺口：`pnpm verify:rust` 通过 `cargo test` 验证
Rust，但 `cargo test` 不负责把生产 binary 放到
`runtime/rust/target/debug/dev-agent-executor`；integration test 的固定入口则直接读取这个
路径。此前的 binary check 因而比 integration 更早失败。

## v56 minimum follow-up（第二轮）

- 在 Rust gate 之后显式运行 `cargo build --bin dev-agent-executor`，工作目录固定为
  `runtime/rust`。
- 保持 binary、`sandbox-exec`、Python socket 三个独立 prerequisite steps 及其 fail-closed
  顺序。
- 用 release-gate contract 锁定 Rust gate → production binary build → binary check →
  sandbox/Python checks → integration 的顺序；本地 focused contract 保持 **12/12**。

下一次 hosted run 必须同时证明 production binary、三个 macOS prerequisite steps 均通过，
以及 `pnpm verify:integration` 真实输出 **10/10 且无 unexpected skip**。在此之前不切换
runner image、不放宽检查、不修改 runtime/API/schema。
