# Windows sandbox feasibility notes（v61）

**日期：2026-09-14**

**状态：预研记录；不授权实现 Windows backend，也不扩大 release target。**

本文把 v61 的 Task 1 threat model 固化为可审阅的 proof-gap 记录。它不是安全认证，不能
把候选 Windows 原语的存在解释成 `dev-agent` 已经支持 Windows restricted execution。

## 当前代码边界

- `runtime/rust/src/restricted_executor.rs` 在 macOS 使用 `sandbox-exec`，在 Linux 使用
  `bwrap`；其他平台的 `run` 直接返回 `RestrictedError::Unsupported`。
- `runtime/rust/src/sandbox_executor.rs` 保留 Unsupported 的结构化映射；
  `runtime/rust/src/bin/dev-agent-executor.rs` 输出 `SANDBOX_UNSUPPORTED`。
- `packages/executor/src/index.ts` 在没有 Rust binary 配置时显式创建普通 `LocalExecutor`；
  CLI doctor 也明确显示 “without the sandbox”。这个模式必须与 restricted execution 的
  platform Unsupported 分开建模，不能作为 Windows backend 的隐式 fallback。

## 资产与攻击者能力

### 需要保护的资产

1. 工作目录之外的宿主文件、凭据、SSH/云配置、注册表和其他用户数据；
2. 受保护为 readonly 的文件，以及 profile 声明的 writable path 之外的工作区；
3. 宿主网络、loopback 语义和本地服务；
4. 命令创建的完整子进程树、runtime 自身和其他用户进程；
5. stdout/stderr、输入、超时、取消、输出配额和结构化错误状态；
6. session/change-set/evidence 元数据的边界，避免 sandbox 失败被误报为成功或可恢复。

### 攻击者能力

把模型生成的命令、参数、环境变量、脚本、依赖包和子进程视为不可信输入。攻击者可能会
尝试：

- 读取或写入未授权的文件、符号链接/reparse point、注册表或凭据；
- 通过子进程、进程树 breakaway、句柄或调试接口离开边界；
- 绕过 disabled/loopback 网络约束，探测宿主服务或内网；
- 通过 fork/child、CPU、内存、文件、句柄或输出制造资源耗尽；
- 忽略取消/超时，留下仍在运行的进程或包装器；
- 让 capability 缺失、权限变化或系统版本差异变成静默的无沙箱成功。

### 信任边界与安全目标

- **TypeScript → Rust stdio：** 只传递已校验的 command/profile/request；错误必须保持结构化，
  不得把 `Unsupported` 变成 `RunResult`。
- **Rust → Windows process/security boundary：** 创建的主进程和子进程必须处在同一个可
  管理的安全边界；取消、超时和失败必须覆盖整个进程树。
- **Sandbox → host filesystem/network:** 默认拒绝未显式授权的访问；writable/readonly、
  cwd、network policy 和 reparse-point 行为需要逐项负向测试。
- **Resource boundary:** 输出、CPU、内存/进程/句柄/文件等限制需要有可观察的失败结果，
  不能仅依赖 best-effort。
- **Release boundary:** 只有完成 target-specific live evidence 的 target 才能进入 release
  matrix；不把编译通过或模拟测试当成 sandbox coverage。

## 候选 Windows 原语：能做什么、不能单独证明什么

### AppContainer

Microsoft 的 AppContainer 文档描述了基于最小权限的文件、网络、进程和凭据隔离，并要求
对需要的资源显式授予访问权。参考：[AppContainer isolation](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation)、
[Launch an AppContainer](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)。

**对本项目的意义：** 这是目前最接近 `writablePaths`/`readonlyPaths`/network policy
模型的候选安全边界；但必须证明任意命令、解释器和子进程都能稳定在该边界中启动，并处理
workspace ACL、临时目录、环境变量、stdin/stdout、cwd 以及 reparse point。文档本身不替代
本项目的 negative tests。

### Job Objects

Job Objects 可以把一组进程作为单位管理，设置部分资源限制并终止关联进程。Microsoft
同时记录了子进程继承、breakaway 和嵌套 job 的边界。参考：[Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)。

**对本项目的意义：** 适合承接进程树、timeout/cancel 和部分 resource-limit 语义，但它
本身不是 filesystem/network/credential 隔离；还必须显式禁止或验证 breakaway，并证明
子进程创建方式不会逃出可管理集合。

### Restricted token

`CreateRestrictedToken` 可以禁用 SID、删除权限并添加限制 SID，再用新 token 创建进程。
参考：[Restricted Tokens](https://learn.microsoft.com/en-us/windows/win32/secauthz/restricted-tokens)、
[CreateRestrictedToken](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken)。

**对本项目的意义：** 可作为 least-privilege 层，但不能单独替代 AppContainer/ACL/network
边界，也不能单独证明任意 child process、文件系统和本地网络访问已被隔离。

### Windows Sandbox / hypervisor boundary

Windows Sandbox 使用 hypervisor 隔离的独立 kernel，提供一次性的环境；官方文档同时说明
网络和 clipboard 等集成默认可能打开，且 edition/host capability 会影响可用性。参考：
[Windows Sandbox overview](https://learn.microsoft.com/en-us/windows/security/threat-protection/windows-sandbox/windows-sandbox-overview)、
[Configure Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file)。

**对本项目的意义：** 可作为更强隔离的候选执行环境，但启动成本、命令级 stdio 交互、文件
映射、网络关闭、并发和 Windows edition 要求都可能不适合当前 per-request runtime；在没有
可重复 runner 和性能/功能证据前，不应把它作为默认 backend。

## Proof-gap matrix

| 现有 profile 语义 | Windows 必须证明的行为 | 当前状态 |
| --- | --- | --- |
| command/args/env/cwd | 任意支持的命令在选定安全边界内启动，cwd 不会借 reparse point 逃逸 | 未证明 |
| writable/readonly paths | ACL/容器映射精确表达 allowlist，父目录、临时文件和 reparse point 安全 | 未证明 |
| disabled/loopback/enabled network | 无外网、loopback 和 enabled 的语义可区分，且不能探测越权宿主服务 | 未证明 |
| timeout/cancel | Job/process boundary 覆盖完整 child tree，取消后无残留进程 | 仅有候选 Job Objects，未证明 |
| CPU/FSIZE/NOFILE/NPROC/CORE 等限制 | 有等价、可观察、跨 Windows 版本稳定的限制或明确拒绝 | 未证明 |
| output quota/stdin/stdout/stderr | stdio 不破坏安全 boundary，输出超额/错误保持结构化 | 未证明 |
| Starlark policy | policy allow 之后仍由 OS boundary 强制执行，不能只靠脚本返回值 | 未证明 |
| Unsupported behavior | 缺失 primitive/permission/edition 时返回结构化拒绝，绝不 fallback | 当前代码已满足 restricted path，Windows live 未验证 |

## Preliminary decision

**Preserve current macOS/Linux implementation; NO-GO for Windows backend implementation in v61.**

进入 code implementation 前至少需要：

1. 稳定 Windows runner（至少覆盖目标 Windows 版本/edition 和权限配置）；
2. 明确的 OS primitive 组合与逐项 threat-model 论证；
3. filesystem/network/process/resource/timeout/cancel 的 negative tests 和 failure injection；
4. 与 Rust stdio、TypeScript executor、CLI/desktop、artifact naming/checksum 相容的端到端
   evidence；
5. 明确是否进入 release matrix，以及签名、安装和 unsupported downgrade 的边界。

在这些条件出现前，现有 `Unsupported` 是正确的安全结果；v61 不添加 Windows shim、模拟
runner、无沙箱 fallback 或 release target。
