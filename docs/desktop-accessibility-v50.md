# Desktop shell accessibility decision（v50）

**日期：2026-09-14**

## Decision

**GO：做一轮不改 API 的轻量 accessibility hardening。**

v49 的浏览器 smoke 已证明 Evidence summary 能够成功展示，但静态 shell 的异步 status、
session/usage/message 控件缺少稳定的显式语义，且没有统一的 keyboard focus-visible 规则。
v50 只补齐这些可验证的交互契约，不重构页面、不增加依赖、不改变后端行为。

## Implemented contract

- 所有可交互的 `button`、`select`、`textarea` 统一提供可见的 `:focus-visible` outline，
  不依赖鼠标 hover 才能识别焦点。
- session picker 有显式 `aria-label="Session"`；仅显示加号的 new-session 控件同时有
  `aria-label="New session"`；message textarea 有 `aria-label="Message"`。
- header status 使用 `role="status"`、`aria-live="polite"` 和 `aria-atomic="true"`，
  让 idle/streaming/done/error/aborted 等异步状态成为可播报的完整状态；usage 保持显式
  `aria-label="Usage"`，但不设置 live region，避免 token 计数在流式过程中产生噪声。
- Evidence 按钮通过 `aria-controls` 与面板关联；面板通过 `aria-busy` 明确 loading 与
  settled 状态。reset、成功、generic error 和 stale response 都会回到 `false`。
- 既有 Evidence `aria-expanded`、request identity、session id 和 data revision guard
  保持不变；焦点语义不把 counts/bytes 变成执行、validation、restore、rollback 或 Undo
  authority。

## Interaction matrix

| 场景 | 可访问状态 | 预期行为 |
| --- | --- | --- |
| 首屏 | session/message 有 label，status 为 idle，preview `aria-busy=false` | 可以从键盘定位控件，不自动发 preview 请求 |
| 键盘聚焦 | `:focus-visible` outline | 焦点清晰，Space/原生按钮 activation 可用 |
| Evidence loading | panel `aria-busy=true`，两个 Evidence 按钮暂时 disabled | 屏幕阅读器知道异步工作仍在进行 |
| Evidence success/error | panel `aria-busy=false`，status 提示结果 | 只播报 metadata-only/generic copy，不播 raw payload 或服务端错误 |
| session switch/new/rename/delete | 旧请求 abort，面板隐藏，`aria-expanded=false` | 不把旧 session 的结果显示在新 session |
| validation/rerun/Undo mutation | panel 保留但 status 标记 stale | 用户明确 Refresh 后才回到最新 snapshot |

## Evidence and limits

- 先加入 served-HTML RED assertions；现有页面在缺少 `button:focus-visible` 和显式 ARIA
  semantics 时失败。
- 最小实现后 `@dev-agent/desktop` focused suite 为 **76/76**；内嵌脚本通过 `node --check`。
- in-app browser smoke 覆盖 `Evidence` 的 Space activation、成功 1/1/1 summary、初始隐藏、
  session switch 清理、`aria-busy=false` settled state 和 warn/error console health。
- 没有引入 Playwright/jsdom 依赖；静态 HTML contract 与轻量 browser smoke 保持与当前
  desktop shell 的测试策略一致。

## Preserve / next boundary

v50 不改变 `GET /api/sessions/<id>/evidence/preview`、v1 export、filters、v41 limits、
CLI、session memory、release gate 或 Desktop transcript Download。Enter activation、真正的
窄窗口 viewport matrix 和更完整的 screen-reader announcement 仍需要后续在有稳定 browser
viewport harness 或实际反馈时单独验证；没有证据就不做 shortcut、折叠或新通知机制。
