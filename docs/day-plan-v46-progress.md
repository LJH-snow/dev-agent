# v46 开发进度：preview 跨宿主 parity 与 Desktop query 语义收敛

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v46.md` 为准。v46 承接 v45 的 NO-GO 结论，优先补
> cross-surface regression evidence，不因理论风险扩展 preview runtime。

## 当前状态

v45 benchmark、parity、sensitive-field regression 与 full verification 已完成；v46
已建立计划，下一步从同一份 session fixture 的 core/CLI/Desktop parity 测试开始。

## v45 baseline

- [x] 六个 synthetic fixtures 连续运行两次；preview bytes 与 full v1 canonical serializer
  完全一致。
- [x] 最大 100,000-file fixture 为 27,489,424 bytes、74--76 ms、约 61.2 MiB heap delta；
  没有复现 concrete availability gap。
- [x] 新增 preview hard cap 为 **NO-GO**；v41 explicit export caps 保持现有边界。

## 进行中

### Task 0：冻结 v45 基线与 parity fixture

- [ ] 固化 v45 benchmark 数据、preview routes 和当前 query semantics。
- [ ] 设计不会跨 test 污染的 shared session fixture。
- [ ] 写 success/error/unknown/duplicate/empty/unknown-query decision matrix。

### Task 1：跨宿主 preview parity regression

- [ ] core/CLI/Desktop 对同一 fixture 的 counts、file count、bytes parity。
- [ ] generic error、sensitive-field 和 no-side-effect regression。
- [ ] 不在宿主层复制 serializer 或计算 bytes。

### Task 2：Desktop query semantics decision

- [ ] 兼容性证据优先；默认 preserve `get()` first/empty-as-absent/unknown-ignore。
- [ ] 只有真实 proof gap 才 TDD 修复；否则记录 CONDITIONAL/NO-GO。

### Task 3：验证与发布

- [ ] 全量门禁、docs、commit/push 和 v47 计划。

## 设计原则

- preview 是完整 canonical projection 的 metadata-only sizing surface，不是 evidence export
  的 partial/cursor 版本。
- 不改变 v1 export、v41 rejection-only limits、provider/workspace/chat queue 或 recovery
  boundaries。
- 所有 runtime 改动先 RED 后 GREEN；测试能证明 preserve 时，不为“更严格”而更改兼容语义。
