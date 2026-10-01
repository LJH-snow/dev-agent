# Findings — 超长期开发路线

## 当前事实

- 当前工作区存在大量并行未提交改动，尤其是 .mimosa/ 删除集合、Desktop Autofix 源码/测试和多份历史计划；本路线只新增自己的计划目录和明确范围内的源/测试文件。
- Execution Center 的 done 事件统一处理在 apps/desktop/public/index.html，可作为完成通知/未读投影的第一接入点。
- 当前已有历史搜索、运行状态筛选、验证状态筛选、上一条对比和 metadata-only 摘要复制；下一块未实现的连续能力是后台运行完成通知和未读状态。
- 阶段 1 已新增 apps/desktop/public/execution-notifications.js：通知 store 只接受 done/failed/aborted，最多保留 32 条，按 session/run 去重，返回复制后的记录，不能接受路径样式 ID。
- Execution Center 首次 payload 只作为已读基线；后续 payload 中出现的新历史 run 才进入未读集合。点击历史行会标记该 run 已读，标记全部按钮只作用于当前 history session。
- UI 为每个 history session 单独建立初始化基线；切换到新 session 的已有历史不会误报，payload 中已不存在的 session 会清理通知和初始化标记。
- 隔离浏览器 fixture 证实：执行中心首次历史基线不显示 unread；后台新增历史后显示 1 unread，Mark read 点击后徽标隐藏且按钮 disabled。
- 阶段 2 的导出应从当前已过滤的 history projection 生成 JSON/Markdown，使用固定 allowlist 和总字符上限；不能把传入对象的未知字段原样序列化。
- 当前导出按钮通过 downloadFile seam 注入测试，浏览器默认路径使用 Blob/URL object URL；导出状态和格式选择保持在 history panel 内，不新增写 API。
- 浏览器验收发现导出成功提示会被轮询 render 清空；已修复为仅在空历史时清理，普通 refresh 保留提示，并由 focused 测试覆盖。
- 筛选 persistence 通过独立 public module 和注入 storage seam 实现；Node 环境不访问实验性的 globalThis.localStorage，只在浏览器 window 环境启用本地保存。
- bounded history UI 以 20 条为一页，只在当前 payload 内展开；服务端仍保持原有 session history 上限，Load more 不发起新请求。
- UI session 生命周期回归验证：alpha 的历史重命名为 beta 时不产生新未读；后续 beta session 被删除且 payload 为空时，历史面板隐藏并清理未读状态。
- 当前 Desktop 全量基线为 400/400；历史 focused 基线为 14/14；本路线后续每次新增测试后以新的实际数字为准。

## 设计决策

- 先做通知投影而非直接做系统通知：先保证 session/run 状态、已读边界和浏览器内可观察性，再评估宿主系统通知是否值得引入权限和隐私复杂度。
- 通知保存 metadata-only，并以 sessionId/runId 做 bounded identity；不把通知正文绑定到 assistant 内容或工具输出。
- 长路线优先沿现有 contract seams 扩展，避免重写已稳定的 server route、审批协议、证据 schema、CLI provider 路径和工作区边界。
- run recovery 代码的关键边界在 loadSessionView、pollRunSnapshot 和 restoreRunSnapshot：cursor gap 会重拉完整 snapshot；重复 sequence 通过 replayCursor 丢弃；终态按 done/failed/aborted 分别处理 queue。组合路径目前主要由 contract/unit 测试间接覆盖。
- queue/replay 组合 contract 确认：requeueActive 会把活动项放回 FIFO 前端并暂停；只在新的 terminal sequence 被 cursor 接受后 resume/startNext；重复 terminal sequence 不触发第二次 drain。
- 页面 reload 恢复 completed/failed/aborted snapshot 时，原先只恢复 turn 和 UI，没有给 restored queued prompts 设置终态队列策略；现在由 run-recovery policy 明确 done=drain、failed/aborted=pause、active/waiting/idle=hold。

## 过程记录

- 一次批量 shell 查询因 JavaScript 字符串引号错误未执行；改为使用 String.raw 和分段查询，未修改文件。
- 阶段 4 审计确认：/api/plans/apply 使用 session-scoped 的 pendingPlanKey，重名 changeSet 不会跨 session 复用；rename/delete 也会迁移或清理待审计划。streamPlanApply 会让 done.status 通过 DesktopRunState 映射为 done/failed/aborted，不能仅以函数返回成功判断终态。
- 已完成“应用结果与审阅 changeSet 证据绑定”回归：计划应用流只转发与待审 review 同一 changeSetId 的 validation，foreign evidence 不进入 SSE 或 run replay。
- 阶段 4 下一缺口已由 RED 测试确认：通用 /api/plans/apply 没有 deadline；即使传入独立的 planApplyTimeoutMs 配置，现有实现仍等待 apply 完成并转发 late done。超时后必须 abort、结束 SSE、丢弃待审 review，并忽略迟到事件，避免用户重试造成并发应用。
- 实现决策：普通 plan apply 的 deadline 使用独立的 DesktopServerOptions.planApplyTimeoutMs，默认 120000ms、范围 1..120000；外部 cancel 先允许 session 协作式返回 aborted，非协作执行最多等到 deadline；真正 timeout 会清理 pending review，late events 不再进入 SSE/replay。Autofix 继续使用原有 timeout 和 reject-on-abort 语义。
- UI 交叉审计发现：timeout SSE 只有 error、且服务端已经丢弃 pending review；若沿用普通 failed 状态，计划卡会错误显示 Retry/Reject。超时必须映射到独立 expired 终态，隐藏三种计划动作，并提示用户重新创建计划。
- 保护边界修正：通用 deadline helper 不放入并行维护的 apps/desktop/src/autofix.ts，已移到本路线新增的 apps/desktop/src/deadline.ts；Autofix 文件保留原有实现，普通 plan apply 通过 server import 使用新 helper。
- 阶段 4 下一 RED 缺口：计划 review 完成后，/api/chat 仍可直接启动第二个 run；这会让旧 pending review 与新上下文并存。UI 队列虽会等待审批，服务端也必须在 pending plan 期间 fail-closed，直到 apply/reject/timeout 解决 review。
- pending-plan guard 放在 session ID 归一化后、sessionFor 创建前，返回与 Autofix 一致的 409/code=pending-plan；因此未知 session 不会因被阻断的 chat 先注册，且 apply/reject/timeout 删除 pending 后可继续。
- stale apply 现在识别 preimage conflict、unknown/expired change set、already-applied 和 planned-guard mismatch；SSE 只返回固定的“Plan review is stale and was discarded”，pending review 被清理，UI 进入 discarded 终态并隐藏 Retry/Reject。
- 阶段 5 证据发现：InMemory/FileMemory 原先对相同 validationId 追加重复记录，legacy audit projection 也会重复导出；现在 recordValidation 使用 latest upsert，select/create evidence audit 都按 recordedAt 保留同一 validationId 的最新记录，避免验证计数与 change-set 血缘膨胀。
- Execution History 血缘发现：DesktopRunState 原先对重复 replay validation event 重复增加 validationCount；现在以有界 validationId set 去重计数，同时保留最新 validationStatus、validationId 和 changeSetId。
- session 血缘发现：普通 chat 与 plan apply 的 validation SSE 若携带 foreign sessionId，原先会进入当前 run replay；两条 server stream path 现在都按 sessionId fail-closed 丢弃该 evidence。
- run-summary 关联边界已修复：只有单条 validation event 同时带合法 validationId 与 changeSetId 时才写 history evidence tuple；缺任一 ID 会清除旧 link/status，避免新 attempt 与旧 change set 拼接。validation event 次数仍保留为观察计数，且 identity 去重集合有界于 256。
- 阶段 5 visual fixture 计划：用 /tmp 内的临时 Git 仓库与 Desktop 会话，seed 一条 history record 指向已 retention-pruned 的 validationId 和仍保留的 applied changeSet；在 Execution Center 点击“validation evidence”，验证页面不显示伪造 validation，但仍展示精确 change-set ID/state，且无 other set 串入。
- 当前 workspace .env 存在所需 Midscene 变量（只检查变量名是否存在，未读取或打印值）；使用默认 headless Puppeteer 模式与临时 loopback Desktop fixture，不连接用户浏览器。
- Midscene 初始截图确认隔离 UI 已载入 desktop-default；视觉上可见保留的 change-set-pruned / change-set-other 两张 applied cards，以及仅属于 change-set-other 的 validation card，说明 fixture seed 和实际页面渲染有效。
- Midscene 首轮 act 未找到 Execution Center/history list：当前截图显示的是 Agent run transcript、左侧 Task 操作、右侧 Runtime Inspector；没有继续猜位置或触发执行。下一步按实际 HTML mount/controller 顺序定位是否需要侧栏展开、滚动或 session 视图切换。
- 代码结构核验后确认 Execution Center 位于右侧 Runtime Inspector、在 Parallel agent runs 之后；首轮视觉操作滚动到了主 transcript。
- 受控单步 Midscene 截图确认右侧 Inspector 的 scroll 区有效；第一步从 Task workspaces 到 Task terminal、Local browser preview 和 Workbench capabilities，逐步滚动可以避免跳过目标区。
- 代码结构核验后确认 Execution Center 是 Runtime Inspector 中 parallel-runs panel 之后的 section；首轮视觉自动化滚动了主 transcript 而非右侧 Inspector，fixture 页面本身挂载正常。
- 第二次单步 Midscene 截图确认右侧 Inspector 可独立滚动；当前显示 Task terminal、Local browser preview、Workbench capabilities，目标区仍在更下方。
- 历史截图显示右侧从 Workbench capabilities 往下是 Scheduled tasks、Delivery loop、GitHub PR review；Execution Center 位于这些面板之前的中段，需对照相邻截图做单步定位。
- Midscene 现已视觉定位并显示 Execution center，面板摘要显示 1 session；history run 详情在 session row 下方，下一步滚动到 Recent runs 控件。
- Execution center 视觉中段已显示 session/detail 卡片和 Open validation action；最近运行历史区域仍未显示，需确认它是在 session 选中后渲染还是位于面板更下方。
- 当前视觉截图确认 Execution center 已位于视口内，session row 显示 desktop-default；下一步在该面板选中 session，展开 run-pruned-validation 详情。
- Execution center session detail 已展开并显示 Open trace/Open validation 等 session-level actions；Recent runs history panel 在其下方，下一步滚动到该 panel。
- 视觉验收完成关键操作：选中 run-pruned-validation 后点 View validation evidence，主对话只显示 Change-set evidence：change-set-pruned、APPLIED、1 file、+1/−0；没有被 retention 清除的 validation 卡，也没有 change-set-other 串入。
- Right Inspector 已视觉呈现 Recent runs（1 recent runs）和 Search run IDs/Outcome 控件；history rows/details 在筛选控件下方，继续单步滚动。
- Recent runs 已显示 Search/Outcome/Validation/Export filters 和 1 条记录，行卡在视口底边；下一次小滚动将完整显示唯一记录及其 View validation evidence 动作。
- 视觉验收已完整看到唯一 history row run-pruned-validation（Completed、1 validation）；详情证据按钮需先选中 run row，未选择之前该详情区按设计隐藏。
- Midscene 受控滚动已证明面板按右侧内容滚动，但连续自动滑轮难以停在 Execution Center；会改为比较附近截图/section 顺序，以短步骤精确靠近，不再让视觉 agent 重复盲滚。
- 视觉定位推进到 Parallel agent runs：右侧 Inspector 中 PR CI diagnosis 后显示 Parallel agent runs，Execution Center 位于其紧邻下方；再向下一个小步即可到目标 panel。
- run-summary 血缘已修复：DesktopRunState 只在 validationId/changeSetId pair 完整时写入 history evidence refs；缺少任一 ID 会清空旧 link/status，重复 attempt 顺序与 recordedAt 保持一致。
- Midscene 已选中 run-pruned-validation，视觉显示 Completed、1 validation；详情按钮仍需向下滚动才能进入视口，尚未触发任何 mutation。
- Recent runs 选择 run-pruned-validation 后详情显示 Completed · passed 和 View validation evidence / View change-set evidence 两个动作；下一步只点击 validation evidence，验证 retention-pruned attempt 的 fallback。
- 点击整张 history card 后 detail 仍隐藏；选择动作应落在 row heading 内部 run ID 按钮，而非卡片空白区域。
