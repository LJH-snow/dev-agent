# v55 开发进度：把 real Rust integration 接入 macOS CI

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v55.md` 为准。v55 本地实现已完成；首个远端 run 已完成但
> 暴露失败，后续修复与复跑转入 `docs/day-plan-v56.md`。runtime 和公开 API 没有变化。

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

- [x] 已观察首个 GitHub-hosted `macos-15` run（34806937694）：macOS Rust gate 通过，但合并的
  prerequisite step 失败，integration 未执行。
- [x] 已将失败定位与后续兼容性处理转入 `docs/day-plan-v56.md`。
- [ ] 下一次 run 必须确认 `/usr/bin/sandbox-exec`、Python fixture 和 live suite 的真实状态。

## 发布状态

- [x] v55 实现已提交并推送。
- [x] 首个远端 run 已观察，但结论为失败而非通过。
- [ ] 通过 v56 的复跑验证后再关闭 external evidence item。
