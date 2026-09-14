# 后续开发计划：v62 及之后

**建立日期：2026-09-14**

**文档状态：计划已建立；当前只确定范围和优先级，尚未授权 speculative runtime 实现。**

> v60 完成了文档 source-of-truth 整理，v61 完成了 Windows restricted execution 的
> feasibility review。v61 的结论是：继续保留 macOS `sandbox-exec`、Linux `bwrap` 和其他
> 平台的 fail-closed `Unsupported`，不在证据不足时实现 Windows backend。
>
> 本文把下一阶段想到的方向集中记录在一个文档中，避免每个想法都直接变成代码。真正开始
> 某一个阶段时，再根据本计划建立对应的 day-plan/progress 和 RED contract。

## 当前基线

截至 2026-09-14：

- 当前分支为 `main`，工作区干净。
- v60/v61 文档与 contract 已推送；最近一次普通 CI
  [34815284519](https://github.com/LJH-snow/dev-agent/actions/runs/34815284519) 的 Rust、
  TypeScript 和 macOS integration jobs 全部通过。
- 固定验证已经覆盖 TypeScript workspace、preview、release-gate、release-workflow、
  documentation contract、Rust unit/doc 和 macOS real-Rust integration。
- macOS real-Rust integration 已达到 **10/10**；Linux `bwrap` backend 有参数构造测试和
  条件式 live test，但还没有独立的 hosted Linux integration evidence。
- Windows restricted execution 已记录为 **Preserve / NO-GO**，除非未来出现稳定 runner、
  可审计安全原语、完整 negative tests 和明确发布需求。

## 总体原则

1. 先补真实安全 evidence，再扩大平台支持；不把静态 contract、编译通过或模拟测试当成
   live sandbox proof。
2. 不把 `LocalExecutor` 静默当成 restricted executor 的 fallback。
3. 每个方向先做 inventory 和 RED contract；没有稳定 consumer 或真实需求时采用
   Preserve/NO-GO。
4. 保持 protobuf、公开 schema、release authority 和现有 macOS evidence 的稳定性。
5. 新增 CI 时必须 fail-closed：能力缺失应明确失败，而不是把覆盖报告为 skipped/success。

---

## v62：Linux `bwrap` hosted live integration（推荐下一步）

### 目标

补齐 Linux sandbox backend 的真实 hosted evidence，使 macOS 与 Linux 两个平台都有可复核的
live integration，而不是只证明 Linux 参数构造正确。

### 为什么优先

- Linux `bwrap` 是已经实现并公开声明 active 的 backend。
- 当前最明显的 proof gap 是 Linux live integration 没有专门的 hosted job。
- 它不需要新增公开 API、protobuf 字段、Windows 支持或新的 release target。
- 它能直接验证真实用户最关心的 filesystem、network、timeout、cancel 和子进程边界。

### 计划步骤

#### Task 0：平台 capability inventory

- 盘点 `/Users/Admin/Desktop/dev-agent/packages/executor/tests/real-rust-integration.integration.ts`
  当前偏 macOS 的判断和错误断言。
- 确认 Ubuntu runner 上 `bubblewrap`、user namespace、network namespace、Python fixture
  和 protobuf 的前置条件。
- 明确哪些行为在 macOS `sandbox-exec` 与 Linux `bwrap` 上应保持一致，哪些错误文本只能
  做平台化断言。

#### Task 1：RED contract

- 为 `.github/workflows/ci.yml` 增加 Linux integration job 的静态 contract。
- 锁定：Ubuntu runner、明确安装 `bubblewrap`、显式构建 Rust binary、构建 executor `dist`、
  独立 prerequisite 检查、`pnpm verify:integration` 的固定顺序。
- 先让 contract 在没有 Linux job 时失败，再实现 workflow。

#### Task 2：平台化 real integration

覆盖以下能力，并且 Linux 缺少必要能力时 fail-closed：

- Starlark allow/deny；
- readonly path 写入拒绝；
- disabled network 与 loopback 语义；
- timeout 和 cancellation；
- output quota；
- concurrency limit；
- child-process termination 和 cwd boundary。

测试应共享稳定的行为断言，但允许 macOS/Linux 使用不同的命令路径和错误模式。不得因为
Linux 与 macOS 的错误文案不同而降低安全断言强度。

#### Task 3：验证与记录

- 本地 macOS 继续运行现有 fixed gate。
- 通过 GitHub-hosted Ubuntu job 获取真实 Linux evidence。
- 更新 `README.md`、`docs/architecture.md`、`runtime/rust/README.md` 和 CHANGELOG。
- 不创建 release tag，不修改 release target matrix。

### 验收标准

- Linux hosted integration 无静默 skip，所有预期测试明确通过。
- macOS integration 继续为 10/10。
- TypeScript、Rust、release contract 和 documentation contract 全部通过。
- 失败的 Linux capability 会让 job 失败，而不是被包装成通过。
- 不引入新的公开 API 或无沙箱 fallback。

---

## v63：Executor 模式与沙箱状态显式化

### 目标

减少用户误以为“已经启用 Rust sandbox”的风险。目前
`/Users/Admin/Desktop/dev-agent/packages/executor/src/index.ts` 在没有 Rust binary 时会
显式选择 `LocalExecutor`，CLI doctor 会给出 warning，但 Desktop 和普通运行路径的状态
仍可以更清楚。

### 先做的事情

- 盘点 CLI、Desktop、doctor、session metadata 和工具执行结果中能够展示 executor mode 的
  位置。
- 区分三个状态：
  - `local`: 未启用 Rust restricted runtime；
  - `sandboxed-macos`: 使用 `sandbox-exec`；
  - `sandboxed-linux`: 使用 `bwrap`。
- 设计 metadata-only 的状态展示，不泄露环境变量、路径、命令输出或敏感信息。

### 只有满足以下条件才实现

- 有真实用户会误解当前执行模式的反馈，或明确的 CLI/Desktop 产品需求；
- 先写 RED contract，证明当前输出无法区分模式；
- 保持 executor 执行语义不变，不把状态展示变成新的执行权限控制。

### 默认决策

在没有用户反馈前 **Preserve / deferred**。这不是 v62 的阻塞项，也不应为了增加 UI
状态而修改核心 executor API。

---

## v64：Release candidate readiness

### 目标

在真正创建 tag 之前，建立一个可复核的 release candidate 检查清单，验证已有四平台
workflow 的构建、打包、checksum 和 artifact 边界。

### 范围

- 用 `workflow_dispatch` 验证四个已有 target 的 build matrix；
- 复核每个 `.tar.gz`、`.sha256`、binary executable bit 和 README；
- 验证 artifact 名称与 target 一致；
- 检查 manual dispatch 不会发布 GitHub Release；
- 只有明确要求发布时，才讨论 tag、签名、发布说明和回滚流程。

### 明确不做

- 不自动创建 tag；
- 不在 fixed gate 中每次构建 release archive；
- 不把单 target smoke 当成四平台 release 证明；
- 没有真实用户/维护者需求时，不增加签名系统或发布服务。

### 默认决策

**Preserve current release workflow。** 只有准备正式发布版本时才启动 v64。

---

## v65：Desktop 产品化与执行状态 UX

### 目标

在基础 sandbox evidence 稳定后，改善 Desktop 对执行能力、审批状态、验证结果和会话状态的
可理解性，但不重新设计现有 evidence、Undo 或 session schema。

### 候选范围

- 在 Desktop header 或 doctor-style panel 中显示当前 executor mode 和 capability 状态；
- 让用户能区分：本地执行、Rust sandbox、sandbox prerequisite 缺失、命令被 policy 拒绝；
- 继续保持 Evidence 为 metadata-only，不展示原始命令输出或敏感字段；
- 对工具失败、取消、超时、policy deny 和 sandbox unsupported 提供一致的可访问性语义。

### 进入条件

- 有真实 Desktop 用户反馈或可复现的状态误解；
- 有明确的视觉/可访问性验收标准；
- 先建立 bounded UI contract，再决定是否修改 `apps/desktop/public/index.html` 或
  `apps/desktop/src`。

### 默认决策

**Preserve / deferred。** 没有具体 UX trigger 时不添加新的 panel、快捷键、通知或导出
入口。

---

## Windows backend：只保留为长期候选

Windows 不属于 v62–v65 的默认实现范围。只有同时满足以下条件，才重新开启独立计划：

1. 有真实 Windows 用户需求或明确的维护者 target commitment；
2. 有稳定 Windows runner，能够运行 target-specific live negative tests；
3. 有可审计的 AppContainer/Job Objects/restricted token 或更强隔离方案组合；
4. 能证明 filesystem、network、process、resource、timeout/cancel、stdio 和 reparse-point
   边界；
5. 有明确的 artifact、签名、安装、发布和 unsupported downgrade 策略。

在此之前，`Unsupported` 是正确的安全结果，不添加 Windows shim、模拟 runner 或无沙箱
fallback。详细 proof gap 见
`/Users/Admin/Desktop/dev-agent/docs/windows-sandbox-feasibility-v61.md`。

## 推荐执行顺序

| 顺序 | 阶段 | 默认决策 | 触发条件 |
| --- | --- | --- | --- |
| 1 | v62 Linux `bwrap` hosted live integration | **GO** | 现在就可以开始 |
| 2 | v63 Executor mode 显式化 | Preserve/deferred | 用户误解或明确 UX 需求 |
| 3 | v64 Release candidate readiness | Preserve | 准备正式发布版本 |
| 4 | v65 Desktop 产品化 UX | Preserve/deferred | 真实 Desktop UX feedback |
| 5 | Windows backend | NO-GO | runner + primitive + live evidence + target commitment |

## 当前推荐

下一步直接建立 `docs/day-plan-v62.md`，从 Linux `bwrap` capability inventory 和 RED
workflow contract 开始；不要先做 Windows backend，也不要先做 speculative Desktop UI。
