## [ERR-20260930-001] multiline-apply-patch-template

**Priority**: low
**Status**: resolved
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
**Status**: resolved
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
