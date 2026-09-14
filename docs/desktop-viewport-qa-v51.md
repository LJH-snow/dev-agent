# Desktop viewport / assistive-tech QA decision（v51）

**日期：2026-09-14**

## Decision

**Preserve / deferred：本轮不新增浏览器依赖，也不修改 Desktop UI。**

当前 in-app browser 足以验证 DOM、截图、键盘动作和 console health，但本轮暴露的能力列表
没有 viewport override，也没有真实 screen-reader announcement 输出。没有可复现的窄窗口溢出、
焦点丢失、ARIA 错误或敏感字段泄露，因此为未测尺寸添加测试框架或继续改 UI 不具备足够
用户价值证据。

## Harness capability matrix

| 能力 | 当前证据 | v51 结论 |
| --- | --- | --- |
| 页面导航/刷新 | 可用 | 已使用 |
| DOM/accessibility snapshot | 可用 | 已使用 |
| 鼠标/键盘 Space | 可用 | Evidence 可触发 |
| screenshot | 可用 | 已检查 summary/header/composer |
| console warn/error | 可用 | 本轮为空 |
| 固定 viewport override | 当前 capability list 未提供 | 不猜测，不宣称窄窗口已测 |
| 真实 screen-reader announcement | harness 未提供 | 只检查 ARIA/DOM 语义，不冒充读屏结果 |

## Baseline evidence

- 首屏 Evidence panel 为 hidden，header/session/message/status/usage 的 ARIA 语义可见。
- 使用 fixture session 触发 Evidence 后，面板显示 `1` validation、`1` change set、`1` file、
  `924 B`，settled `aria-busy=false`，且不显示 fixture 的 path、cwd、hash 或 raw JSON。
- 键盘 Space 可以激活 Evidence；切换到 new session 后旧面板被隐藏，旧结果不留在新 session。
- unknown/default session 的请求显示 generic unavailable；console warn/error 为空。
- 已有 served-HTML contract 锁定 focus-visible、labels、status live region、Evidence
  `aria-expanded`/`aria-busy` 和 stale request guards。

## Deferred decisions

### Responsive layout：deferred

源码已有 header wrapping、Evidence grid 的窄窗口 media rule，但没有固定 viewport 的可重复
截图证据。本轮不以 812px 默认窗口推断任意手机尺寸，也不引入新依赖；后续只有在 viewport
harness 可用或收到具体溢出/遮挡反馈时才补 RED test 和最小 CSS 修复。

### Assistive-tech announcements：Preserve

`status` 使用 atomic polite live region，usage 不使用 live region 以避免 token 计数噪声，
Evidence status 使用独立 status/busy 语义。本轮没有真实读屏输出可证明公告重复或缺失，
因此保持现状，不添加快捷键、重复 toast、折叠或额外通知。

## Boundary

v51 不改变 `EvidenceAuditPreview` v1、v1 export、filters、v41 limits、CLI、session
memory、fixed release gate、transcript Download、validation 或 Undo。ARIA 属性只是可访问性
提示，不是执行、验证、恢复、回滚或 Undo authority。

下一次触发条件是：可固定 viewport 的 harness、真实辅助技术反馈、或具体可复现的窄窗口
交互缺陷。否则继续保持 Preserve/NO-GO，并把精力放到有证据的用户需求上。
