# Desktop evidence preview UI decision（v49）

**日期：2026-09-14**

## Decision

**GO：增加一个最小只读 Evidence summary 面板。**

Desktop 已经有稳定的 `GET /api/sessions/<id>/evidence/preview` endpoint，但原有界面只有
transcript `Download`，用户无法发现这层 metadata-only preflight。新增面板只消费现有
preview schema，不改变 API、v1 export、session storage 或 release gate。

**Task 2 导出入口：NO-GO。**

当前没有足够的使用证据证明需要另一个 Desktop 下载入口。现有 `Download` 继续表示
Markdown transcript；metadata-only v1 JSON 仍通过既有 CLI/API 使用，避免把 preview bytes
误解为下载许可，也避免引入新的 over-limit UI 和文件命名语义。

## Baseline inventory

- Header 现有控件：session picker、new/rename/delete、transcript `Download`、`Stop`、usage
  和 stream status。
- History 继续由 `/api/sessions/<id>/messages` 加载；其中的完整 validations/changeSets
  仍按原有 transcript/validation UI 展示，preview 面板不复用这些 raw records。
- `/api/sessions` 返回的 `evidenceSummary` 继续只用于 session/history 数据，不替代 preview
  endpoint；面板使用显式点击触发的 `/evidence/preview` GET。
- 面板放在 header 下方、messages 上方，和 `Download` 相邻，初始隐藏，不改变聊天区域的
  默认高度和首屏行为。

## View model and rendering allowlist

浏览器只接受下面的成功字段，并且要求 `schemaVersion === 1`、`sessionId` 与当前 session
完全相等、四个数值为非负 safe integer：

```text
schemaVersion
sessionId
validationCount
changeSetCount
fileCount
serializedBytes
```

`generatedAt` 保留在 API schema 中但不渲染。界面只显示三类数量和经过单位格式化的
`serializedBytes`；不把 response JSON、validation/change-set records、commands、args、cwd、
output/error、diff、patch、file bytes、before-image 或 provider/environment values 注入 DOM。

## UI decision matrix

| 状态 | 面板/控件行为 | 允许显示 | 保护条件 |
| --- | --- | --- | --- |
| 初始 | 面板隐藏，Evidence 按钮可发现 | 无 | 不自动发请求、不读取 provider/workspace |
| 点击/刷新 | 面板显示，按钮暂时 disabled，四个值显示 `—` | `Loading evidence summary…` | 只发一个 GET preview 请求 |
| 成功且为空 | 显示 `0` 与格式化字节数 | metadata-only 提示 | 不把空记录当成错误 |
| 成功且有记录 | 显示 validations、change sets、files、estimated export size | 四个 allowlisted 数值 | 不显示 raw evidence |
| HTTP/JSON/allowlist 错误 | 保留面板，显示 generic `Evidence preview unavailable.` | 不显示服务端错误内容 | 可用 Refresh 重试 |
| 切换/new/rename/delete session | 取消旧请求、清空面板并隐藏 | 新 session 的默认状态 | request id + session id 双重隔离 |
| validation/rerun/Undo 改变 evidence | 保留面板但标记 `Session evidence changed — refresh to update.` | 不继续伪装成最新快照 | data revision 防止并发 response 覆盖 stale 状态 |
| audit-limit query | UI 不构造该 query | 无 | preview 与 v1 export limit 边界保持分离 |

`AbortController` 负责取消未完成请求；request identity、当前 session 比较和 evidence data
revision 一起防止旧响应或并发 mutation 覆盖新状态。面板没有 localStorage、缓存、写入
memory、chat、validation、rerun、rollback 或 Undo 权限。

## Evidence

- 先加入 RED contract assertion；旧 HTML 在缺少 `preview-evidence` 控件时失败。
- 加入最小实现后，`@dev-agent/desktop` focused suite 为 **75/75**。
- 从 `http://127.0.0.1:4318/` 做 in-app browser smoke：初始面板隐藏；fixture session 成功
  显示 `1` validation、`1` change set、`1` file、`924 B`；切换到新 session 后面板被清理；
  unknown/default session 显示 generic unavailable；键盘 Space 可触发 Evidence；浏览器
  warn/error 日志为空。
- `index.html` 内嵌脚本通过 `node --check`；`git diff --check` 通过。

## Follow-up boundary

v49 只解决“已有 preview 不可发现”的 UI 缺口。后续如果出现真实的审计 JSON 下载需求，
必须单独建立 transcript/audit export 的信息架构、显式 v41 rejection-only limit 反馈和
TDD/browser evidence；不得直接把当前 preview 面板升级为下载或执行 authority。
