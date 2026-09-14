# Day plan v61：Windows restricted execution feasibility 与 fail-closed 平台边界

**建立日期：2026-09-14**

**当前状态：已完成；完成平台 inventory/threat model，结论为 Preserve current
macOS/Linux implementation / NO-GO for Windows backend。**

> v60 已完成 roadmap 编号归一化、文档 source-of-truth 导航和 hosted CI 复核。当前
> `runtime/rust` 对 macOS (`sandbox-exec`) 与 Linux (`bwrap`) 提供 restricted execution，
> 其他平台会返回明确的 `Unsupported`，而 release matrix 也只覆盖这两个平台。Windows
> 支持是下一个自然的产品能力候选，但不能在没有安全原语、runner、发布策略和不绕过约束
> 的证据时直接实现。

## Goal

判断 Windows restricted execution 是否具备进入实现阶段的条件，并把“不支持时必须
fail-closed、不能静默降级到 LocalExecutor”的边界写清楚：

- 盘点当前平台分支、错误映射、CLI/desktop 行为、release matrix 和 README 的支持声明；
- 明确 Windows backend 必须满足的资产保护、网络、文件系统、超时、取消、资源限制和
  可观测性目标；
- 只有在存在稳定 Windows runner、可审计的安全 primitive、可复现测试 fixture 和明确的
  artifact/release 计划时，才进入实现；
- 在证据不足时保留当前 Unsupported 行为，不为“看起来能运行”的无沙箱 fallback 增加
  兼容层。

## Global constraints

- 不把 `LocalExecutor` 当作 Windows restricted execution 的替代实现；任何失败都必须
  保持显式拒绝或结构化 Unsupported。
- 不修改 protobuf、公开 schema、CLI/desktop API、release target matrix 或默认安全策略，
  除非 inventory 和 threat model 先证明具体需求与迁移边界。
- 不添加 Windows target 到 release workflow，不宣称跨平台支持，不使用模拟环境冒充
  Windows live evidence。
- 不引入新的依赖或系统权限；先记录 proof gap，再决定是否需要独立实现计划。

## Task 0：平台路径 inventory

- [x] 列出 `RestrictedExecutor`、`SandboxExecutor`、stdio binary 错误映射和 CLI/desktop
  展示路径中的所有 platform-specific 分支。
- [x] 对照 `.github/workflows/ci.yml`、`.github/workflows/release.yml`、README、architecture
  和当前 day-plan，确认支持声明没有比可执行 evidence 更宽。
- [x] 确认 Windows 上不能意外走无沙箱 LocalExecutor，也不能把 Unsupported 转成成功结果。

**Task 0 result：** `RestrictedExecutor::run` 在 macOS/Linux 分别构造
`sandbox-exec`/`bwrap`，其他平台直接返回 `RestrictedError::Unsupported`；
`SandboxExecutor` 将其映射为 `SandboxError::Unsupported`，stdio binary 输出
`SANDBOX_UNSUPPORTED`。TypeScript 的 `createExecutor()` 在未配置 Rust binary 时明确选择
普通 `LocalExecutor`，CLI `--doctor` 也明确提示“without the sandbox”；这是一条显式的
非 restricted 模式，不是 Windows 上从 restricted path 静默降级。CI/release matrix 和
README/architecture/runtime README 都只声明 macOS/Linux active，没有 Windows target 或
live evidence。当前 proof gap 是缺少 Windows runner、OS primitive 评估和 target-specific
negative tests；Task 1 只完成了初步 threat model，继续 feasibility 验证前不改实现。

## Task 1：threat model 与 feasibility gate

- [x] 初步定义 Windows 方案要保护的资产、信任边界、攻击者能力和不可接受的降级路径，
  记录在 `docs/windows-sandbox-feasibility-v61.md`。
- [x] 初步评估候选 OS primitive 对 filesystem/network/cwd/resource/timeout/cancel 的覆盖，
  并将未证明部分标记为 proof gap；这不是实现授权。
- [x] 评估候选原语能否在 CI 中生成可复现的 negative tests；当前无法确认，所有未证明能力
  均保留为 proof gap。
- [x] 评估 build toolchain、runner、artifact naming/checksum、签名/发布和用户安装边界；
  当前没有足够 evidence，不把静态 contract 当作 live sandbox proof。

## Task 2：最小实现或 Preserve

- [x] 没有发现具体、可复现的 fail-open 或明确用户需求，因此没有写 RED implementation
  contract，也没有修改 runtime。
- [x] 当前 Unsupported 路径满足 fail-closed 目标，记录 Preserve/NO-GO；不新增 platform
  abstraction、模拟器或 speculative dependency。

## Task 3：验证、文档与下一阶段

- [x] 运行与本轮变更对应的 focused tests、fixed gate 和结构/diff checks。
- [x] 没有进入实现；已更新 progress/CHANGELOG，保留 proof gap 和触发条件。
- [x] 不创建 Windows release tag、artifact 或 GitHub Release。

## Acceptance checklist

- [x] 当前 macOS/Linux 支持与 Windows Unsupported 边界有代码和文档证据。
- [x] 没有无沙箱 fallback、隐式成功或把模拟测试误报为 Windows live coverage。
- [x] 任何进入实现的建议都必须先具备明确的 security primitive、runner、negative tests 和
  发布边界；本轮没有越过该门槛。
- [x] 没有在证据不足时扩大 runtime、依赖、schema 或 release authority。

## Decision boundary

默认决策为 **Preserve current fail-closed Unsupported path / NO-GO for Windows backend**，
直到出现稳定的 Windows runner、可审计安全 primitive、端到端 negative-test fixture 和明确
的用户/发布需求。v61 先负责证明“是否应该做”；它不是对 Windows 支持已存在的承诺。
