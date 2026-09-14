# v44 preview 输入 decision matrix

**日期：2026-09-14**

本矩阵只描述 v43 preview 的输入边界。它不授予 preview 执行、validation、restore、
rollback 或 Undo 权限。

| Surface / input | 当前语义 | v44 决定 | 证据/后续 |
| --- | --- | --- | --- |
| CLI `--preview-evidence` + `--session <id>` | 只读选定 memory | **GO / preserve** | v43 focused test |
| CLI preview + `--change-set-id` / `--validation-id` / `--status` | 复用 evidence filter | **GO / preserve** | v43 focused test；补 parity |
| CLI preview + `--json` | preview 本来就是 JSON | **GO / preserve** | no side effect |
| CLI preview + `--export-evidence` | 已拒绝 | **GO / preserve** | v43 test |
| CLI preview + `--cleanup-evidence` | 已拒绝 | **GO / preserve** | v43 implementation |
| CLI preview + `--audit-max-*` | parser 拒绝，limits 只属于 full export | **GO / preserve** | v43 test |
| CLI preview + `--once` | 入口显式拒绝 | **GO / implemented** | v44 RED/GREEN test |
| CLI preview + `--index` | 入口显式拒绝 | **GO / implemented** | v44 RED/GREEN test |
| CLI preview + `--session-delete` / `--session-rename` / `--compact` / `--reset-memory` | 入口显式拒绝 | **GO / implemented** | v44 RED/GREEN test |
| CLI preview + `--mcp-server` / `--tools` / `--doctor` / `--check-rust` | 入口显式拒绝 | **GO / implemented** | v44 RED/GREEN test |
| CLI preview + `--metadata` / `--session-list` | 入口显式拒绝 | **GO / implemented** | v44 RED/GREEN test |
| CLI preview + `--approval` / `--rust-executor` | 入口显式拒绝 | **GO / implemented** | v44 RED/GREEN test |
| Desktop preview + standard filters | `get()` first value；空值按未提供处理 | **CONDITIONAL / preserve** | compatibility review required before tightening |
| Desktop preview + unknown query | 当前忽略 | **CONDITIONAL / preserve** | no response leak; typo policy deferred |
| Desktop preview + `maxValidations` / `maxChangeSets` / `maxFiles` / `maxBytes` | 已拒绝 | **GO / preserve** | v43 focused test |
| unknown session | `404 { error: "unknown session" }` | **GO / preserve** | v43 focused test |
| malformed memory / invalid evidence path | generic preview failure path | **GO / regression-test** | no evidence details in response |
| oversized projection | full projection + canonical bytes; no truncation | **CONDITIONAL / defer cap** | benchmark and explicit rejection design required |
| any preview response | fixed metadata allowlist | **GO / preserve** | no evidence content, cursor, partial, schema v2 or authority |
