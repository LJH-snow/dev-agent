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
