## CLI TUI 滚动、诊断、命中区与 Footer 状态修正

工作区已有未提交的 Ink Phase 2/3 改动，且 `app.tsx`、`runtime-store.ts` 和测试里已经包含部分本次 UI 修复。实施前保留这些改动和 `.mimosa/` 等无关产物，只补齐并纠正目标行为；不提交、不推送。

1. **统一启动页与 transcript 的滚动内容**
   - 保持 WelcomePanel 和对话内容在同一 managed viewport 中，保证启动时有内容可供滚轮、PageUp/PageDown 与 Home/End 滚动，而不是接管 wheel 却无可见效果。
   - 校准 viewport 内容测量与首次渲染/终端 resize 同步，覆盖 welcome 顶部可达及短内容不误报可滚动。

2. **诊断与通知**
   - 保留 route/state/timing/usage 诊断默认过滤，并确认 `DEV_AGENT_TUI_DEBUG=1` 的 opt-in 路径可见。
   - 保持 approval、retry、失败等行动型信息可见；普通 notices 去重并有界，避免无限累积。测试验证大量 route notices 不进入默认 UI、debug 诊断可查看、actionable 状态不被过滤。

3. **导航栏 hover/click 几何**
   - 用 shell 的实际测量结果确定导航行，并与实际标签绘制使用同一截断宽度/居中计算；不再依赖固定 `terminalRows - 9` 估算。
   - 处理 stdout resize、composer 多行/paste notice 与 notice 出现造成的布局变化；增加真实 Ink+xterm 屏幕的悬停边界和点击回归测试。

4. **Composer 底部状态行**
   - 显示当前有效 session 的 provider/model 和 provider 回报的最近一次请求 prompt tokens，并明确标注“last request”；无数据时显示 unknown，模型/session 切换时清除过期用量。
   - 先按代码里真实 metadata 确认 context window/limit 是否可得；若不可得，诚实保留 `limit unknown`，不从累计 token 或模型名推造容量或百分比。
   - 对窄终端确保单行截断，不影响 composer。

5. **验证**
   - 扩展 `ink-navigation-screen.test.ts`、`ink-app.test.ts` 和 store 测试，覆盖启动滚动、resize/dynamic shell hitbox、通知策略及状态行来源。
   - 运行 CLI source/test typecheck、相关 Ink 屏幕测试及全量 CLI 测试；完整保存输出并检查退出码，最后运行 `git diff --check`。

如核实现有代码已完整满足某项，则保留实现，仅补必要的回归覆盖，避免重复改动。