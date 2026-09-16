# Release Candidate Hardening Plan

> 本计划把当前 `dev-agent` 工作区整理成可合并的 v0.1.0 Release Candidate 基线；不执行
> tag、push 或 GitHub Release。

**建立日期：2026-09-15**

**状态：已完成（2026-09-15）**

**主清单：** `docs/release-candidate-checklist-v0.1.0.md`

## 目标

在一个约四小时的并行工作窗口内，收口 CLI TUI v1/v1.1 变更，证明机器输出边界和
终端安全边界，补齐可重复的回归证据，并让 TypeScript、Rust、集成、文档和 release
workflow 固定 gate 可复核。主代理负责最终整合，不把子代理结论当作最终证明。

## 任务

### Task 1：TUI 流式渲染可靠性

- [x] 检查并加固节流、定时器取消、过期 callback 和 `finish()` 最终刷新。
- [x] 覆盖未闭合 fenced code、重绘边界和模型文本终端控制字符。
- [x] 运行 CLI stream renderer 定向测试。

### Task 2：Rich TTY 生命周期

- [x] 消除 readline 输入回显与额外用户块的重复。
- [x] 覆盖 `Thinking…` 的首 token、tool、完成、异常、EOF 和 Ctrl-C 路径。
- [x] 用不依赖 `interact` 的 PTY 驱动验证 rich welcome、命令和取消路径。

### Task 3：机器输出回归

- [x] 增加 pipe、`--once`、`--json`、`--no-stream` 和 `--mcp-server` 的边界测试。
- [x] 证明机器模式不含 rich TTY 控制序列，JSON stdout 保持单一可解析值。
- [x] 为缺少 PTY 依赖的环境提供显式 skip 语义，并在 Ubuntu CI 安装 `expect`/`procps`。
- [x] 人类可读路径统一清理终端控制序列，并对明显 credential-shaped 值做脱敏；JSON
  路径不改写模型数据。

### Task 4：Release Candidate 文档与门槛

- [x] 建立 `docs/release-candidate-checklist-v0.1.0.md`。
- [x] 保持 release workflow 的 tag-only publish 和 manual-dispatch 安全边界。
- [x] 将 release workflow 收口为默认只读权限、publish 最小写权限、临时 checkout 凭据、
  tag/ref 一致性、精确 artifact/checksum 校验和 `--verify-tag`。
- [x] 将 CI workflow contract 纳入 TypeScript fixed gate，避免本地与 CI 漂移。
- [x] 最终 gate 通过后，把本计划和 CHANGELOG 状态更新为已完成。

### Task 5：最终验证与交付边界

- [x] Rust unit/doc gate 通过。
- [x] real Rust integration gate 通过。
- [x] 最终运行 `pnpm verify:typescript`、`pnpm verify:rust`、`pnpm verify:integration`、
  `git diff --check`。
- [x] 主代理完成变更审计；没有明确授权时不创建 release tag 或 GitHub Release。

## 本轮独立并行轨道

- CLI TUI/stream agent：完成 rich TTY、节流、过期 callback、PTY 回归与控制序列边界。
- Release workflow agent：完成权限分层、CI PTY 依赖 contract 与发布 artifact 边界建议。
- Release gate agent：完成每 step timeout、SIGTERM→SIGKILL escalation 与 contract test。
- 主代理：整合机器输出、终端脱敏、CI/release contracts、文档和最终 gates。

## 交付结论

**GO for merge preparation / NO-GO for publish。**

后续正式发布前必须由维护者确认版本/tag/required checks/发布说明/回滚策略；GitHub
Actions 的 immutable SHA、SemVer/tag provenance 和跨平台进程树清理另立计划，不在本轮猜测
实现。
