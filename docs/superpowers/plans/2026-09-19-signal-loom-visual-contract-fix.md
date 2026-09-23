# Signal Loom Visual Contract Fix

**建立日期：2026-09-19**

**状态：已完成**

## Goal

修复 rich TTY 的两个已复现视觉回归：

1. 启动画面的 Signal Loom 标记必须按字符单元输出多段真彩色渐变；
2. 活跃输入框必须始终输出蓝色真彩色边框，且 `NO_COLOR` 仍保持可读的无色布局。

不改变 CLI 的命令、队列、审批、工具卡片、非交互输出或 JSON 契约。

## Evidence

首次基线命令：

```text
pnpm --filter @agent_cli/cli run test
```

结果：在 CLI 与 Desktop 测试构建同时运行时，380 项中 378 项通过，失败 2 项：

- `Signal Loom launch mark uses a multi-stop truecolor gradient`
- `rich input uses a blue truecolor frame`

Desktop 基线：

```text
pnpm --filter @dev-agent/desktop run test
```

结果：137/137 通过。

后续将 CLI 单独串行复跑后，两个视觉断言均通过，确认失败来自并发构建/测试时的瞬态
工作区竞争，而不是 rich TTY 实现回归。

## Scope

只修改：

- `apps/cli/src/tui-brand.ts`
- `apps/cli/src/tui-input.ts`
- `apps/cli/tests/tui-brand.test.ts`
- `apps/cli/tests/tui-input.test.ts`
- 本计划文档

## Review

### 1. Brand gradient

- 保留现有 Signal Loom 几何和紧凑版单色输出；
- 现有实现已经为 full launch mark 的每个可见 logo 字符计算稳定的多段 RGB 插值；
- 每个字符已经单独包裹真彩色前景 ANSI 序列；
- `color: false` 和 `NO_COLOR` 路径已经保持无色布局。

### 2. Blue input frame

- 现有实现已经保留默认蓝色 RGB token；
- 输入框边框、竖线和底部边框已经经过真彩色包装；
- `NO_COLOR` 路径仍输出纯文本；
- 排队 prompt 使用独立灰蓝色，不覆盖活跃编辑器颜色。

## Verification

1. Brand focused tests：**4/4**；
2. Input focused tests：**18/18**；
3. CLI 全套测试：**380/380**；
4. Desktop 全套测试：**137/137**；
5. `git diff --check`：通过。

本轮没有生产代码改动，只有本计划文档新增；没有发布 npm、创建 tag、push 或创建
GitHub Release。

## Boundaries

- 不发布 npm 包；
- 不创建 tag、push 或 GitHub Release；
- 不引入新的终端 UI 依赖；
- 不重做已完成的 CLI 队列和 Desktop 工作台。
