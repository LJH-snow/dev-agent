# v60 开发进度：统一 roadmap 编号与项目文档 source of truth

> 最后更新：2026-09-14

> v60 已完成。根 README Roadmap 现在包含 71 个唯一、连续的编号；新增的 bounded
> documentation contract 已接入 fixed TypeScript gate。本地全量验证和 hosted CI 均已通过。

## 最终变更

- 根 `README.md` 的 Roadmap 原先为 `1..63, 47..54`；保留八条历史描述，仅将后八项重编号
  为 `64..71`。
- 根 README 增加 documentation index、architecture、CHANGELOG、v60 plan/progress 的导航。
- `docs/README.md` 明确四类 source of truth：用户状态/roadmap、architecture、时间顺序的
  CHANGELOG、当前 day-plan/progress；同时声明 workflow、fixed gate 和 contract tests 是
  可执行行为的权威来源。
- 新增 `tests/documentation-contract.test.mjs`，覆盖 roadmap 连续编号和 source-of-truth
  导航链接；没有新增依赖，也没有触碰 runtime、protobuf、公开 schema 或 release workflow。
- `scripts/release-gate.mjs` 将 documentation contract 作为固定 TypeScript gate step；既有
  gate order/metadata contract 同步更新。

## 已完成

- [x] 盘点 README Roadmap：共 71 项，重复编号为 47–54，原位置在第 63 项之后。
- [x] 对照 v56–v59 的 CI、release、sandbox、artifact 和 Preserve/NO-GO 记录；未发现需要
  改写执行行为的状态冲突。
- [x] RED-to-GREEN documentation contract：实现前能复现重复编号失败，修复后
  documentation contract **2/2**。
- [x] release-gate contract 更新后 focused suite **12/12**。
- [x] 完成 roadmap 最小重编号与文档导航修复，保留历史事实和发布边界。
- [x] `pnpm verify`：workspace **614/614**、preview **8/8**、release-gate contract **12/12**、
  release-workflow contract **2/2**、documentation contract **2/2**、Rust unit/doc **46/46**、
  real-Rust integration **10/10**。
- [x] `node scripts/check.mjs`、`node --check scripts/release-gate.mjs`、CI workflow YAML parse、
  `git diff --check`。
- [x] commit `2c19173` 的普通 CI run
  [34812211033](https://github.com/LJH-snow/dev-agent/actions/runs/34812211033) 最终成功；Rust、
  TypeScript 和 macOS integration jobs 全部通过。第一次 TypeScript job 在
  `packages/tools` build 阶段达到 15 分钟 timeout，failed-job rerun 后正常完成，没有产生
  代码错误或额外 workflow 变更。
- [x] 建立下一阶段入口 `docs/day-plan-v61.md` 和对应 progress，默认只做 Windows feasibility
  inventory/threat model，不把 Unsupported 路径扩大成 speculative backend。

## 待完成

- [x] `pnpm verify`：workspace、preview、release-gate/release-workflow/documentation contracts、
  Rust 和 real-Rust integration 全部保持绿色。
- [x] `node scripts/check.mjs`、`node --check scripts/release-gate.mjs`、workflow YAML parse、
  `git diff --check`。
- [x] 更新 `docs/CHANGELOG.md`，准备推送普通分支变更；不触发 tag release。
- [x] 记录 hosted CI run；若没有新的具体需求，下一阶段只建立保持窄范围的 v61 入口。

## 当前决策

**GO for unique roadmap numbering and bounded documentation navigation; Preserve history.**
本轮没有删除 CHANGELOG、day-plan、NO-GO/deferred 决策，也没有新增 generator 或依赖。
README/architecture/day-plan/CHANGELOG 继续分别承担摘要、结构、过程决策和时间记录职责；
CI/release workflow 与 fixed contract tests 继续承担可执行行为权威。

## 下一步

1. 完成本地 fixed gate 与文档/结构检查。
2. 更新 CHANGELOG，提交推送并观察普通 CI。
3. 按 `docs/day-plan-v61.md` 先做 Windows feasibility inventory；没有新 trigger 时，不扩张
   为 speculative 功能开发。
