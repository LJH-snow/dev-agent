# 8 小时开发目标：安全的无人值守并行开发闭环

> 本计划承接 v0.1.0 Release Candidate hardening。它定义一个可以连续运行约 8 小时的
> 开发窗口，目标是把下一阶段工作推进到“可审计、可回归、可安全交接”的基线；不自动
> 创建 release tag、不 push、不发布 GitHub Release，也不绕过项目安全边界。

**建立日期：2026-09-15**

**状态：已完成（核心验收提前满足；2026-09-15）**

**进度记录：** `docs/superpowers/plans/2026-09-15-eight-hour-unattended-development-goal-progress.md`

**前置基线：**
- `docs/release-candidate-checklist-v0.1.0.md`
- `docs/superpowers/plans/2026-09-15-release-candidate-hardening.md`
- `docs/next-roadmap-plans-v62-plus.md`

## 一、8 小时总目标

在 8 小时窗口内，将当前工作区从“RC hardening 已完成、正式发布仍受人工授权约束”
推进到“下一轮工程工作有明确范围、可由多个子代理无人值守执行、结果可合并审计”的
开发基线，重点收口以下四件事：

1. **运行安全**：明确子代理在无人批准时可以做什么、不能做什么，并把停止条件写成
   可执行的任务协议。
2. **变更隔离**：让并行代理只在各自的 worktree 或明确文件范围内工作，避免互相覆盖
   和把未审查的结果直接写进主工作区。
3. **验证闭环**：每条轨道都必须产出测试、检查结果或明确的 proof gap；主代理最后
   统一运行固定 gate，不把子代理的口头结论当成证据。
4. **发布闸门**：继续保持 no-tag/no-push/no-release；只有维护者确认版本、tag、CI
   required checks、发布说明和回滚责任后，才允许进入正式发布阶段。

### 成功标准

8 小时窗口结束时，应当有：

- 一份更新后的执行计划和进度记录；
- 至少两条独立轨道完成代码、测试或证据产出；
- 每条轨道都有明确的文件范围、验证命令和未解决风险；
- TypeScript、Rust、real integration、文档和相关 contract gate 有新鲜运行证据；
- 主工作区没有未经记录的临时文件、秘密、tag 或发布资产；
- 若任何轨道触及发布、外部写入、破坏性操作或权限边界，必须停在人工闸门前。

“8 小时”是时间盒，不是为了填满时间而扩大范围；如果核心验收提前满足，剩余时间
用于审计、回归和文档，而不是擅自开启新功能。

## 二、执行分段（总计 8 小时）

| 时间盒 | 阶段 | 交付物 | 停止条件 |
| --- | --- | --- | --- |
| 0:00–0:30 | 基线冻结 | 工作区清单、已有 gate 快照、代理任务分配 | 发现基线失败时先修复或记录，不继续扩大范围 |
| 0:30–2:30 | 三条并行调查/实现轨道 | 各轨道的 patch、测试或 proof-gap 报告 | 触及非授权目录、外部写入或 destructive command |
| 2:30–5:30 | 轨道内实现 | 最小可合并变更与回归测试 | 轨道间出现共享文件冲突时暂停写入并交回主代理 |
| 5:30–6:45 | 集成与审计 | 合并前 diff 审查、文档状态、风险清单 | 测试失败未能定位时不宣称完成 |
| 6:45–7:45 | 全量验证 | TypeScript、Rust、integration、contracts、文档检查 | 任一固定 gate 失败则进入修复/记录，不进入发布 |
| 7:45–8:00 | 交接 | 进度记录、剩余事项、人工决策清单 | 没有维护者授权时保持 NO-GO for publish |

## 三、推荐的并行轨道

### Track A：Release provenance 与发布前置条件

**范围：** 只检查和补强 release workflow、CI contract、版本/tag 规则文档和对应测试；
不创建 tag，不调用 `gh release`，不改变发布目标矩阵。

**候选交付物：**
- 对 SemVer、项目版本、tag commit、required CI checks 的策略形成明确 contract；
- 对不可变 GitHub Actions 引用提出可验证的更新方案；
- 为新增边界补静态 workflow tests；
- 在发布清单中记录仍需维护者决策的项目。

**验收：**
- `node --test tests/release-workflow.test.mjs tests/ci-workflow.test.mjs`；
- `git diff --check`；
- 无 tag、无 release、无远程写入。

**明确不做：** 猜测 action commit SHA、直接修改 protected tag 规则、实际发布。

### Track B：Executor cancellation 与进程树证据

**范围：** 评估现有 `SIGTERM → SIGKILL` timeout 处理在 macOS/Linux 上的子进程边界；
只有证据充分、跨平台语义明确时才实现小范围改动，否则交付 proof-gap 报告和测试计划。

**候选交付物：**
- 直接子进程与子进程树的行为矩阵；
- 不同平台的可行终止策略和风险说明；
- 至少一个真实或受控的回归测试；
- 若不适合本轮实现，明确 `Preserve / follow-up` 决策，不做投机重构。

**验收：**
- `pnpm verify:rust`；
- `pnpm verify:integration`；
- 新增测试必须能证明失败路径，而不是只证明 happy path。

**明确不做：** 没有跨平台证据时引入未经验证的 process-group API、全局 deadline 或
Windows backend。

### Track C：CLI/Desktop operator observability

**范围：** 只改进开发者能看到的运行状态、失败原因和交接信息；不改变 provider、tool、
approval、session schema 或执行权限语义。

**候选交付物：**
- CLI/health/doctor 对 executor mode、验证状态和失败阶段的可读展示；
- machine output 与人类终端输出的边界回归；
- 对无人值守运行有用的最终摘要（完成、失败、跳过、需人工决策）；
- 相关 TypeScript tests 与文档。

**验收：**
- `pnpm --filter @dev-agent/cli test`；
- `pnpm verify:typescript`；
- JSON stdout 仍为单一可解析文档，终端输出不泄漏控制序列或明显凭据。

**明确不做：** 不在本轮引入新的公开 API，不把富 TTY UI 带入 pipe/CI/JSON/MCP 模式。

### 主代理集成轨道：变更审计与最终 gate

主代理不与上述轨道重复实现，负责：

- 维护 disjoint file scope；
- 检查每个子代理的 diff、测试和未解决风险；
- 解决冲突或拒绝越界变更；
- 更新本计划的进度记录；
- 运行全量固定 gate；
- 在没有明确授权时保持 `NO-GO for publish`。

## 四、无人批准运行的解决方案

### 结论先说

**可以做到“无人值守运行”，但不能让子代理自行绕过权限或审批。** 解决方案分为两层：

1. **宿主权限层**：在启动任务前，将当前会话配置成明确的自动批准/非交互策略，或使用
   已预授权的受限 runner；子代理继承宿主策略。
2. **项目治理层**：即使没有逐条批准，也必须用白名单、隔离目录、固定命令、停止条件
   和最终人工闸门把操作范围锁死。

当前 Codex 会话的实际状态是 `approval_policy=never`、`danger-full-access`、文件系统
unrestricted、网络可用。子代理通常会继承宿主的非交互策略，因此不会逐条弹出批准提示；
但这不等于它们拥有一个独立的安全容器。尤其是当前工作区本身有待审查的修改和未跟踪
文件，不能把主工作区当作安全的无人值守写入环境。白天推荐只运行只读代理；需要写入时，
改用无网络、workspace-only 的受限 runner 和独立 worktree，并把最终合并留给人工。

### 无人值守允许的操作

- 读取当前仓库代码、测试、配置和文档；
- 在指定 worktree 或指定文件范围内编辑；
- 运行仓库已有的构建、测试、lint、format、contract 和 diff 检查；
- 生成测试报告、进度记录和 proof-gap 文档；
- 在代理之间传递摘要、patch 路径和验证证据。

### 必须停在人工闸门前的操作

- `git push`、创建或移动 tag、创建/编辑 GitHub Release、上传 release asset；
- 部署、修改线上资源、修改组织/仓库权限、写入外部 SaaS；
- 删除仓库文件、清理不属于自己范围的目录、`reset --hard`、强制覆盖他人变更；
- 读取或复制 secrets、token、私钥，或把环境变量写入日志/文档；
- 新增未经审查的网络依赖、执行来源不明的远程脚本、改变沙箱逃逸边界；
- 发现任务范围不清、共享文件冲突、测试失败无法解释或需要用户决策时继续推进。

### 推荐的子代理 brief 约束

本仓库白天最多并行运行 3 个子代理；并发数量不是安全边界，真正的边界仍由宿主权限、
网络策略、写入范围和人工闸门决定。

每个 brief 固定写入以下内容：

1. 一个目标；
2. 允许读取的目录；
3. 允许写入的文件集合；
4. 允许运行的命令集合；
5. 成功标准；
6. 明确禁止的操作；
7. 失败时必须返回的证据格式。

代码代理使用独立 worktree；只读审查代理不得修改文件；不同代理不得拥有重叠的
写入集合。当前主工作区已有未提交和未跟踪变更，不能让新的写入代理直接覆盖它；
worktree 只解决代码副本冲突，不会自动隔离系统权限、网络或凭据。主代理是唯一可以
整合冲突和决定是否进入下一阶段的角色。

### 如果宿主仍然会弹审批

子代理不能、也不应该通过提示词绕过宿主审批。可选方案只有：

- 在 Codex/宿主设置中预先选择适用于该仓库的非交互审批策略；
- 先降低沙盒和网络权限，再使用该策略；仅把“没有提示”当作交互体验设置，不当作安全证明；
- 使用一个权限最小化、目录受限、没有发布凭据的本地 runner/CI job；
- 把任务拆成只读调查和受限写入两类，让需要人工批准的动作统一延后；
- 让子代理在审批点安全退出并写入 `blocked` 结果，而不是循环重试或自行放宽权限。

不要使用“全部自动批准 + 整台机器无限权限”作为长期方案。无人值守的正确目标是
**approval-free but not authority-free**：减少打断，同时保留最小权限和不可自动跨越的
发布闸门。

## 五、代理调度协议

### 父代理启动前

- 记录当前 commit、工作区状态和基线 gate；
- 创建任务清单，给每个代理分配 disjoint scope；
- 明确本轮禁止 tag/push/release/deploy/delete；
- 指定超时、最大重试次数和失败交接格式；
- 将最终人工决策列成清单，而不是留在聊天上下文中。

### 子代理运行中

- 只做 brief 中的一件事；
- 每个重要阶段写入短进度或测试结果；
- 发现边界问题立即停止并报告，不自行扩大范围；
- 不等待非必要的用户输入；
- 不把“测试未执行”记为“测试通过”。

### 父代理收口时

- 检查 `git status --short`、`git diff --check` 和每个代理的变更范围；
- 重新运行最终 gate，不依赖代理转述；
- 生成一份交接摘要：已完成、证据、剩余风险、需要维护者批准的动作；
- 只有在人工授权后才进入 commit/tag/push/release。

### 子代理失败交接格式

```text
status: blocked | failed
track: <A|B|C>
scope: <实际触及的文件或命令>
reason: <具体阻塞原因>
evidence: <测试输出、错误摘要或 proof-gap>
next_action: <主代理可执行的最小下一步>
needs_human: yes | no
```

## 六、最终验收清单

- [x] 本计划有对应的进度记录，所有阶段都有时间和状态；
- [x] 至少两条独立轨道有可审查产出；
- [x] 所有代码改动有回归测试或明确的“不适合实现”证据；
- [x] `pnpm verify:typescript` 通过；
- [x] `pnpm verify:rust` 通过；
- [x] `pnpm verify:integration` 通过；
- [x] `git diff --check` 通过；
- [x] 没有创建 tag、push、GitHub Release 或 release asset；
- [x] 人工决策清单已列出，正式发布仍为 `NO-GO`，除非维护者明确授权。

## 七、交接给维护者的明确问题

在正式发布或扩大无人值守权限前，维护者需要明确回答：

1. 是否允许该仓库使用非交互审批策略？如果允许，适用范围是本仓库、指定 worktree，
   还是临时 runner？
2. 是否要求所有 GitHub Actions 固定到不可变 commit SHA？
3. 正式 tag 是否必须符合 SemVer，并且与项目版本和通过 CI 的 commit 一致？
4. required CI checks、发布说明负责人和回滚责任人分别是谁？
5. 哪些操作即使在无人值守窗口内也必须保留人工批准？

在这些问题没有明确前，本计划允许继续做本地代码、测试和文档工作，但不允许跨越
发布或外部写入闸门。
