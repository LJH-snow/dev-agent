## [ERR-20260930-001] multiline-apply-patch-template

**Priority**: low
**Status**: pending
**Area**: tools

### 摘要
通过 JavaScript 模板字符串包装 apply_patch 时，补丁正文中的反引号和正则转义会先被外层脚本解析，导致补丁命令在执行前失败。

### 错误信息
SyntaxError: Unexpected identifier
SyntaxError: Invalid or unexpected token

### 建议修复
生成补丁时避免正文反引号，或使用 String.raw 加字符串拼接；失败后先确认目标文件未变化，再重试。

### 元数据
- Reproducible: yes
- Source: error

---
## [ERR-20260930-003] execution-history-blocked-session-release

**Priority**: high
**Status**: resolved
**Area**: tools

### 摘要
在 HTTP 运行路径的 finally 中等待 execution history 磁盘写入，会让 SSE 已结束但 session 的 inFlight 锁尚未释放；紧接着的请求会错误返回 409，失败测试还可能留下未关闭的服务器句柄。

### 错误信息
Expected status 200, received 409.
Promise resolution is still pending but the event loop has already resolved.

### 建议修复
终态 history 先更新内存并排队原子落盘；HTTP 清理路径先释放 inFlight、controller 和 pending state，再异步处理持久化结果。磁盘写失败不能改变已完成的请求状态。

### 元数据
- Reproducible: yes
- Source: error

---

## [ERR-20260930-002] documentation-contract-release-version-drift

**Priority**: medium
**Status**: pending
**Area**: docs

### 摘要
文档契约把 npm latest、CLI candidate 和最新 GitHub Release 当成同一版本：npm 0.2.0 已于 2026-09-30 发布，但 GitHub 最新正式 release 仍为 v0.1.8，且 v0.2.0 尚无 tag/release。

### 错误信息
Documentation assertions expected npm 0.1.8 and GitHub v0.2.0 to advance together.

### 建议修复
分别核验 npm dist-tag/package version 与 GitHub release/tag；release-state 记录 npm published/candidate 状态，文档明确 GitHub release 独立推进，不推断 tag/release 已发生。

### 元数据
- Reproducible: yes
- Source: error

---
## [ERR-20261001-001] typescript-release-gate-cli-integration-timeouts

**Priority**: medium
**Status**: resolved
**Area**: tools

### 摘要
本轮 TypeScript release gate 的 build、typecheck、Agent Core、Desktop、package smoke、preview、release、CI、documentation 和 native contracts 均通过，但 CLI 全套中两个与本轮证据改动无关的集成测试超时。

### 错误信息
    explicit resume continues a cancelled background session instead of replaying its original request: timed out waiting for the explicit continuation model request
    interactive CLI auto-routes greetings and allows an explicit manual override: missing [state=done turns=1]

### 上下文
- Command: pnpm verify:typescript
- Failing package: apps/cli
- The changed scope is Agent Core evidence deduplication and Desktop evidence/plan contracts.

### 建议修复
先单独复跑两个 CLI 用例确认是否为时序/资源争用；若可重复，再按 CLI integration harness 的 provider/child-process cleanup 分析，不把失败归因到本轮证据改动。

### 元数据
- Reproducible: no
- Source: error
- Resolution: 单独串行复跑两个用例均通过，判定为 release gate 负载/时序波动，未修改 CLI 业务代码。
- Recurrence: 2026-10-01 第二次完整 gate 仍仅在高负载全套 CLI 中触发 model-routing-cli 超时；该用例单独串行仍通过。
- Recurrence: 2026-10-01 第三次完整 gate 在 background-jobs-e2e explicit resume 用例超时；background-jobs-e2e 与 model-routing-cli 隔离串行复跑 3/3 通过。
- Recurrence: 2026-10-02 完整 CLI gate 的 model-routing-cli 等待 `state=done turns=1` 超时；该文件随后低负载串行复跑 3/3 通过，未观察到业务回归。
- Recurrence: 2026-10-03 完整 gate 的 CLI 全量又出现 approval overflow 无 EOF 2 秒窗口和跨进程 validation 5 秒窗口超时；两条路径隔离验证后均通过，扩大测试 harness 的有界等待窗口后组合回归 3/3 轮通过。
- Resolution update: 2026-10-03 最终完整 `pnpm verify` 以 `EXIT:0` 通过；CLI 823/823，相关等待/ANSI 聚合测试在完整 gate 中保持绿色。

---
## [ERR-20261002-001] terminal-input-stale-session-response

**Priority**: medium
**Status**: resolved
**Area**: tools

### 摘要
阶段 7 的 Terminal 输入请求在切换 task 后返回失败，会把新 task 的状态错误改成 `terminal.status.error`。

### 错误信息
```
Expected terminal.status.running, received terminal.status.error
```

### 上下文
- Command: `node --test --test-concurrency=1 apps/desktop/tests-dist/task-terminal.test.js`
- 触发路径：task A 的 `/input` 响应延迟，切换到 task B 后返回错误。

### 建议修复
输入请求捕获 session generation、session ID 和 run ID；响应或异常只有在三者仍匹配当前 UI 时才能更新状态或继续轮询。

### 元数据
- Reproducible: yes
- Source: error
- Resolution: 已加入请求身份检查，Terminal focused suite 15/15 通过。

---
## [ERR-20261002-002] terminal-preview-stale-session-effects

**Priority**: medium
**Status**: resolved
**Area**: tools

### 摘要
阶段 7 的旧 Terminal refresh 响应仍会写入新 task 的错误状态；session 切换清理旧 Preview 时也会把 `cleared` 生命周期误记到新 task。

### 错误信息
```
Expected terminal.status.ready, received terminal.status.error
Expected lifecycle to contain only task-a preview started, received task-b preview cleared
```

### 上下文
- Command: `node --test --test-concurrency=1 apps/desktop/tests-dist/task-terminal.test.js`
- 触发路径：task A 的 refresh/Preview 尚未完成，切换到 task B 后旧响应或 cleanup 继续产生可见副作用。

### 建议修复
所有异步入口捕获 session generation；旧 refresh 直接丢弃，session 切换的 Preview cleanup 只更新 UI，不写入新 task trace。

### 元数据
- Reproducible: yes
- Source: error
- Resolution: 已加入 refresh generation guard 与无 trace 的 session-switch cleanup；Terminal focused suite 17/17 通过。

---
## [ERR-20261002-003] midscene-preview-assertion-wording

**Priority**: low
**Status**: resolved
**Area**: tools

### 摘要
隔离浏览器中的非法 Preview URL 已正确显示 loopback 拒绝文案，但 Midscene 首次动作提示使用了不存在的“invalid preview URL”措辞，因此自动化动作误判失败。

### 错误信息
```
Task failed: 页面未显示明确的 invalid preview URL 错误
```

### 建议修复
先读取实际截图和本地化文案，再用页面的精确可见文本做断言。

### 元数据
- Reproducible: yes
- Source: error
- Resolution: 使用实际文案 `Only a loopback HTTP(S) URL with an explicit port can be previewed.` 重新断言通过。

---
## [ERR-20261002-004] rg-unescaped-group-query

**Priority**: low
**Status**: resolved
**Area**: tools

### 摘要
本轮两次 `rg` 查询把未转义的 `(` 放入 alternation，触发正则解析错误。

### 错误信息
```
rg: regex parse error: unclosed group
```

### 建议修复
搜索字面量括号时使用 `\\.` 或拆分成多个简单 `rg` 查询。

### 元数据
- Reproducible: yes
- Source: error
- Resolution: 改用拆分查询和转义字面量，后续检索成功。

---
## [ERR-20261002-005] mcp-stale-capabilities-after-failure

**Priority**: high
**Status**: resolved
**Area**: tools

### 摘要
MCP 重连失败或 `list_changed` 元数据刷新失败时，旧 tools/resources/prompts 仍可能留在 session snapshot 和上层注册表中。

### 错误信息
```
Expected empty MCP snapshot after failed reconnect/list refresh, received old-tool/stale-tool
```

### 建议修复
连接替换、close 和 generation 匹配的刷新失败都必须清空对应 capability；旧 client 的迟到结果继续丢弃。

### 元数据
- Reproducible: yes
- Source: error
- Resolution: 已在 `McpServerSession` 加入 clear-on-connect/close、空 snapshot 撤销通知和 list refresh failure 清空；MCP 全量 74/74 通过。

---
## [ERR-20261002-006] mcp-missing-metadata-wrapper-leak

**Priority**: high
**Status**: resolved
**Area**: tools

### 摘要
MCP server 未声明 resources/prompts capability 时，CLI、Desktop 和 worker lease 仍注册通用 resource/prompt wrapper。

### 错误信息
```
tools-only server exposed tools-only:resource and tools-only:prompt
```

### 建议修复
注册层读取 initialize capabilities；缺失 capability 时不生成 wrapper，并在 worker lease 中沿用同一 server-scoped metadata。

### 元数据
- Reproducible: yes
- Source: error
- Resolution: CLI/Desktop/worker registration 已加入 capability guards；tools-only 跨层回归通过。

---
## [ERR-20261002-007] sandbox-expansion-cancel-hang

**Priority**: high
**Status**: resolved
**Area**: tools

### 摘要
用户在 sandbox denial 的 expansion approval 等待期间取消时，AgentLoop 直接等待未完成 callback，run 不会结束。

### 错误信息
```
Promise resolution is still pending but the event loop has already resolved
```

### 建议修复
用 AbortSignal 包住 expansion callback；取消时立即抛出并发出 interrupted，迟到的 callback 结果不得重试工具。

### 元数据
- Reproducible: yes
- Source: error
- Resolution: 已加入 `awaitAbortable`；Agent Core approval/collaboration focused 54/54 通过。

---
## [ERR-20261002-008] rust-local-executor-broken-pipe

**Priority**: high
**Status**: resolved
**Area**: infra

### 摘要
Rust LocalExecutor 在大输入同时触发 output cap 时，子进程先关闭 stdin，写入任务把 BrokenPipe 当作执行失败。

### 错误信息
```
called `Result::unwrap()` on an `Err` value: Io(... Broken pipe)
```

### 建议修复
stdin BrokenPipe 视为 child 已结束的正常输入收敛；保留其它 I/O 错误，交给 output truncation/child status 生成最终结果。

### 元数据
- Reproducible: yes
- Source: error
- Resolution: 已加入 Rust write result normalization；Rust 48+6 与 real integration 11/11 通过。

---

---
