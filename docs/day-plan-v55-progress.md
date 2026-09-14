# v55 开发进度：把 real Rust integration 接入 macOS CI

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v55.md` 为准。v55 本地实现已完成，当前等待首个远端
> GitHub-hosted macOS workflow run；runtime 和公开 API 没有变化。

## 当前状态

CI 之前只运行 TypeScript 与 Ubuntu Rust jobs。fixed local gate 虽然包含 real-Rust integration，
但 integration test 的 sandbox cases 只在 macOS + `/usr/bin/sandbox-exec` 上执行。v55 增加
专用 `macos-15` job，并在运行 integration 前 fail-closed 检查 binary、sandbox 和 Python fixture。

## 已完成

- [x] inventory fixed gate、CI workflow 和 integration test skip 条件。
- [x] RED contract：实现前 `node --test tests/release-gate.test.mjs` 为 11/12。
- [x] root `verify:integration` entrypoint。
- [x] `.github/workflows/ci.yml` 的 macOS job、Rust build 顺序和 prerequisite checks。
- [x] release-gate workflow contract：实现后 12/12。
- [x] `docs/ci-real-integration-v55.md` decision doc。

## Validation

- [x] `pnpm verify:integration`：10/10。
- [x] `pnpm verify`：workspace 614/614、preview 8/8、release-gate contract 12/12、Rust
  unit/doc 46/46、real-Rust integration 10/10。
- [x] `node scripts/check.mjs`、`git diff --check`、YAML parse 和 `node --check scripts/release-gate.mjs`。
- [x] README 与 `docs/README.md` 已记录新的 integration entrypoint 和 CI coverage。

## Remaining external evidence

- [ ] push 后观察 GitHub-hosted `macos-15` job 是否能提供 `/usr/bin/sandbox-exec`，并确认 live
  suite 没有 unexpected skip。
- [ ] 根据首个远端 run 建立 v56 compatibility/maintenance decision。

## 发布状态

- [ ] 提交并推送 v55。
- [ ] 远端 workflow run 验证后再关闭 external evidence item。
