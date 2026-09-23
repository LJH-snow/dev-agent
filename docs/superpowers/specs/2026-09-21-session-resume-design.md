# Session Resume and Switching Design

**Date:** 2026-09-21
**Status:** Implemented and verified (feature-focused)

## Goal

让 dev-agent CLI 能安全地列出、搜索、选择并继续已有会话，同时保持现有
`--session`、`--session-list`、`--session-delete`、`--session-rename` 和会话文件格式兼容。

## User-visible behavior

### 1. Ink 会话选择

- `:sessions` 或 `/sessions` 打开历史会话面板。
- `:resume <query>` 或 `/resume <query>` 打开同一面板并预填筛选条件。
- 面板显示会话 id、最近活动时间、条目数和安全截断的最后一条用户/助手摘要。
- 上下键选择，Enter 恢复选中的会话，Esc 关闭面板。
- 搜索只在内存中的安全摘要和会话 id 上进行，不把完整会话内容注入终端。
- 运行中、审批等待中或队列不为空时，不能切换会话；命令返回明确提示。
- 切换后清空旧会话的动态 TUI 状态，但保留已提交的终端滚动内容。

### 2. CLI 参数

- 新增 `--resume <session-id>`，语义等价于使用该 id 启动一个已有会话。
- `--resume` 与 `--session` 同时出现时返回稳定错误，避免两个 id 产生歧义。
- 现有 `--session <id>` 行为不变。
- 不存在或无效的 session id 只返回安全错误，不创建意外文件。

### 3. 安全和资源边界

- 只读取当前 session directory 下的 `.json` 文件。
- session id 只接受现有 `normalizeSessionId` 规则产生的安全值。
- 最多扫描并返回 256 个最新会话。
- 每个预览最多读取并展示 240 个 Unicode 字符；完整会话只在真正恢复后由 `FileMemory` 读取。
- 无法解析或超限的会话保留为不可恢复的列表项，不能阻塞其他会话。
- 终端输出继续使用 `sanitizeTerminalText` 和 `redactSensitiveText`。

## Architecture

### `session-registry.ts`

负责扫描目录、读取有限元数据、生成安全摘要和搜索结果。它不依赖 Ink，也不
负责改变当前运行上下文。

```ts
interface StoredSession {
  readonly id: string;
  readonly file: string;
  readonly size: number;
  readonly modifiedAt: string;
  readonly createdAt?: string;
  readonly lastActiveAt?: string;
  readonly entryCount?: number;
  readonly usage?: ChatUsage;
  readonly preview?: string;
  readonly readable: boolean;
}

listStoredSessions(directory: string, options?: {
  readonly limit?: number;
}): Promise<readonly StoredSession[]>

searchStoredSessions(
  sessions: readonly StoredSession[],
  query: string,
  limit?: number,
): readonly StoredSession[]
```

### `session-resume.ts`

解析 `:sessions`、`:resume` 命令，并格式化安全的 CLI/Ink 行。命令解析不读取
文件，便于单元测试。

### `InkRuntimeStore` / `InkCliApp`

Store 新增 `sessionPicker` 快照，保存标题、行和当前选中 index；App 负责按键，
回调由 `interactiveInk` 实现。恢复回调返回新的 `AgentContext`，而不是复用旧
context 的 memory。

### `interactiveInk`

维护当前 `sessionId` 和 `current` context。切换流程：

1. 检查当前是否空闲且没有排队输入。
2. 从 registry 读取并验证目标 session。
3. 创建新的 `FileMemory` 和 `AgentContext`。
4. 恢复与新 context 相关的变更集证据。
5. 重置动态 TUI store，更新 footer 的 session id。
6. 后续 prompt 使用新的 context。

## Compatibility

- 不修改已有 memory JSON schema。
- `--session-list --json` 保持现有字段兼容；新 registry API 只供内部和 Ink 使用。
- ANSI 模式继续支持现有 `:history`、`:search`，并新增文本形式的 `:sessions`。
- 不新增 npm 依赖。
- Node.js `>=20`。

## Verification

- registry 测试覆盖安全 id、最新 256 项、无效 JSON、摘要脱敏和搜索。
- command 测试覆盖 `:sessions`、`:resume`、别名、空查询和非法参数。
- Ink 测试覆盖打开面板、上下选择、Enter 恢复、Esc 取消和忙碌时拒绝切换。
- CLI 测试覆盖 `--resume`、冲突参数、不存在会话和恢复后追加新条目。
- 已完成 feature-focused 验证：registry/parser 7/7、CLI resume/ANSI
  6/6、Ink picker/command-palette 3/3，`@dev-agent/agent-core` 176/176，
  `@dev-agent/mcp` 70/70，CLI build、test TypeScript compilation、typecheck
  和 `git diff --check` 均通过。
- CLI 全量测试 532/532 通过，包含长 transcript 的 Home/End 导航、MCP
  初始化、会话索引、`--resume` 和 Ink picker 切换。
- 验证完成日期：2026-09-22。该实现保持既有 memory JSON schema 和
  `--session-list` 兼容性，可作为后续桌面端会话管理的基础。
