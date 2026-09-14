# Changelog

## 2026-09-14（v63：Executor mode metadata 完成）

- 建立 `docs/day-plan-v63.md`、`docs/day-plan-v63-progress.md` 和 implementation plan，限定
  v63 只增加 executor mode metadata，不改变执行、审批、policy、protobuf、session schema、
  Windows backend 或 release matrix。
- `@dev-agent/executor` 现在能显式表达 `local`、`sandboxed-macos`、`sandboxed-linux`、
  `unsupported` 和 injected implementation 的 `unknown`；resolver 不启动子进程，也不读取
  命令输出。
- CLI doctor 的 human/JSON 输出加入 `executorMode`，并保持 Rust health check 的原有
  warn/fail 语义；executor suite **51/51**、CLI suite **119/119** 已通过。
- Desktop `/health` metadata 和最终 fixed/hosted gates 在 v63 完成后补充；本阶段不创建 tag 或
  GitHub Release。

## 2026-09-14（v64：发布前 Release Candidate 审计完成）

- 建立 `docs/day-plan-v64.md` 与 `docs/day-plan-v64-progress.md`，把 v64 限定为四个既有
  release target 的 hosted manual build、artifact 内容、checksum 和 publish boundary 审计；
  不创建 tag、不发布 GitHub Release。
- 先写 release-workflow RED contract，复现 manual dispatch 可能仅凭 tag-shaped ref 进入
  publish job，以及 package 上传前缺少 executable/README/archive/checksum 验证的缺口。
- 将 publish 条件收紧为 `push` 事件且 ref 为 `refs/tags/*`；在四平台 artifact 上传前加入
  binary executable bit、README、archive entries 和 checksum 的 fail-closed 检查。
- 本地 release-workflow contract 已从 RED 的 **2/4** 变为 **4/4**；同一 commit
  `972a229a50171805ad85bd45d53e1b06c01ebb9d` 的 hosted run
  [34844424584](https://github.com/LJH-snow/dev-agent/actions/runs/34844424584) 四个平台 build
  全部成功，四个 artifact 的 checksum、archive 内容、README 和 executable bit 全部通过。
- 同一 run 的 `Publish release` job 为 **skipped**；run 后没有 `v*` tag、GitHub Release 或
  release asset。结论为 **Release Candidate readiness evidence available / formal release still
  deferred**。

## 2026-09-14（v60：roadmap 编号与文档 source of truth）

- 盘点根 README Roadmap 共 71 项，确认第 63 项之后原本错误地重复使用 47–54；保留原有
  历史描述，将它们最小重编号为 64–71。
- 根 README 与 `docs/README.md` 增加有限的文档导航，明确 README、architecture、day-plan/
  progress、CHANGELOG 与 workflow/fixed contract tests 各自承担的 source-of-truth 边界。
- 新增 `tests/documentation-contract.test.mjs`，覆盖 roadmap 唯一连续编号和当前文档导航；
  documentation contract 为 **2/2**，并作为 fixed TypeScript gate 的独立 fail-fast step。
- 本地 `pnpm verify` 通过：workspace **614/614**、preview **8/8**、release-gate contract
  **12/12**、release-workflow contract **2/2**、documentation contract **2/2**、Rust unit/doc
  **46/46**、real-Rust integration **10/10**。structure check、脚本语法、CI workflow YAML
  parse 和 `git diff --check` 也通过。
- 本轮没有改变 Rust/TypeScript runtime、公开 schema、release workflow 或发布权限；不创建 tag、
  不上传 artifact、不发布 GitHub Release。
- commit `2c19173` 的普通 CI run
  [34812211033](https://github.com/LJH-snow/dev-agent/actions/runs/34812211033) 最终成功，Rust、
  TypeScript 和 macOS integration jobs 全部通过。第一次 TypeScript job 在 `packages/tools`
  build 阶段触发 15 分钟 timeout；同一 commit 的 failed-job rerun 后 gate 完成，documentation
  contract **2/2**、release-workflow contract **2/2**、release-gate contract **12/12**，macOS
  real integration **10/10、0 skipped**。
- v60 完成后建立 `docs/day-plan-v61.md`：下一阶段只评估 Windows restricted execution 的
  安全原语、runner、负向测试和发布边界；在证据不足前保持当前 Unsupported/NO-GO，不新增
  无沙箱 fallback 或 Windows release target。

## 2026-09-14（v61：Windows restricted execution feasibility）

- 完成平台路径 inventory：macOS `sandbox-exec`、Linux `bwrap` 和其他平台
  `RestrictedError::Unsupported` 的边界保持分离；显式配置的 TypeScript `LocalExecutor`
  不被解释成 restricted backend fallback。
- 在 `docs/windows-sandbox-feasibility-v61.md` 记录资产、攻击者能力、信任边界、候选原语
  的限制和 filesystem/network/process/resource/timeout/cancel/stdio proof-gap matrix。
- 结论为 **Preserve current macOS/Linux implementation / NO-GO for Windows backend**：没有
  Windows runner、端到端 negative tests、完整 artifact/release evidence 或明确需求前，不
  添加 Windows shim、release target、模拟 coverage 或无沙箱 fallback。
- commit `17bfa7a` 的普通 CI run
  [34815029965](https://github.com/LJH-snow/dev-agent/actions/runs/34815029965) 的 Rust、
  TypeScript 和 macOS integration jobs 全部成功；documentation contract **2/2**。

## 2026-09-14（v62：Linux `bwrap` hosted live integration 开始）

- 建立 `docs/day-plan-v62.md` 与 `docs/day-plan-v62-progress.md`，把 v62 限定为 Linux
  `bwrap` hosted live evidence，不扩大公开 API、protobuf、Windows 支持或 release target。
- 先锁定 Ubuntu/bubblewrap/user namespace/Python/Rust/dist 的 fail-closed prerequisites，
  并要求 integration harness 在 hosted job 中不能静默 skip。
- hosted run `34839400282` 在 Linux Rust gate 暴露 `/root` 等不可读 nested bind 导致
  `bwrap` live echo 失败；先以 failing Rust unit assertion 固化问题，再改为单一只读 root
  bind。随后 run `34840227357` 暴露 loopback 配置缺少 namespace 内 uid/gid 0；再次先写
  failing unit assertion，加入 uid/gid 0 和同步的 hosted probe。run `34840884768` 继续证明
  Ubuntu runner 的 AppArmor unprivileged-userns gate 仍在阻止 loopback，因而加入 CI-only
  sysctl prerequisite 配置，等待下一次 hosted evidence。
- 修复后的 run `34841473962` 已通过全部 CI jobs：Linux `bwrap` real integration **10/10、0 skipped**，
  macOS real integration **10/10、0 skipped**，TypeScript/Rust/release/documentation contracts
  同步通过；v62 acceptance 完成，未修改 release target 或公开 API。

## 2026-09-14（后续路线图：v62+）

- 新增 `docs/next-roadmap-plans-v62-plus.md`，集中记录后续候选方向：优先补齐 Linux
  `bwrap` hosted live integration，其后按真实需求考虑 executor mode 显式化、release
  candidate readiness 和 Desktop 产品化 UX。
- Windows backend 继续保持 NO-GO；文档明确了进入实现前必须具备的 runner、security
  primitive、negative tests、端到端 evidence 和 release boundary。

## 2026-09-14（v56：首个 hosted macOS CI run 的失败证据与最小修复）

- 观察到首个 GitHub-hosted `macos-15` run：Ubuntu Rust job 暴露 Linux-only 测试缺少
  `RestrictedExecutor::run` 第三个 `cancel` 参数；本地 macOS gate 原先无法发现该跨 target
  编译问题。
- 补齐该测试调用的 `None` cancel 参数，并通过本地 `cargo check --tests --target
  x86_64-unknown-linux-gnu` 与 target-specific clippy。
- 将 macOS binary、`sandbox-exec`、Python socket prerequisite 拆成独立 fail-closed steps，
  让下一次 hosted failure 能定位到具体 capability；release-gate contract 保持 **12/12**。
- 第二个 hosted run（34807975071）确认 `cargo test` 不会保证 production binary artifact；新增
  `cargo build --bin dev-agent-executor`，放在 Rust gate 之后、binary check 之前。
- 第三个 hosted run（34808369664）确认 host prerequisites 已通过，但 integration 缺少
  `packages/executor/dist`；新增 executor package build，放在 prerequisites 之后、integration
  之前。
- 最终 hosted run（34808757733）三个 job 全部通过；macOS real integration 明确为 **10 tests、
  0 failures、0 skipped**，v55/v56 的 hosted live evidence 正式关闭。
- v56 决策为 **GO / Preserve**：保留固定 runner、显式 artifact builds、独立 fail-closed
  prerequisites 和固定 integration entrypoint。

## 2026-09-14 (Day plan v50: Desktop shell accessibility 与交互稳健性)

Executed the first v50 accessibility hardening slice from `docs/day-plan-v50.md`. The change is
UI-only and preserves the preview/export/session contracts.

### Added: keyboard focus and async status semantics

- Static Desktop controls now have explicit labels for Session, New session, Usage, and Message;
  buttons, selects, and the composer share a visible `:focus-visible` outline.
- The header stream status is now an atomic polite live status. Evidence keeps its existing
  `aria-expanded` relationship and adds `aria-busy` transitions for loading/settled states.
- The served-HTML contract test covers the labels, roles, live-region attributes, focus rule, and
  loading reset. No browser framework dependency was added.

### Boundary

No API/schema/export/limits/session-memory/release-gate behavior changed. Evidence remains a
metadata-only read path; status, usage, counts, and bytes are not execution, validation, restore,
rollback, or Undo authority. A real narrow-viewport matrix and deeper screen-reader announcement
review remain deferred until a stable viewport harness or concrete feedback exists.

### Tests and validation

- v50 RED-to-GREEN Desktop focused suite: **76/76**.
- In-app browser smoke: native Space activation, initial hidden state, successful 1/1/1 summary,
  session-switch cleanup, settled `aria-busy=false`, screenshot, and zero warn/error console logs.
- Inline UI script `node --check` passed; the post-implementation full release verification and
  report smoke both passed.

### Next boundary

Complete the v50 release push, then use `docs/day-plan-v51.md` to decide whether the remaining
viewport/screen-reader items have enough evidence for a minimal follow-up or should be recorded as
Preserve/NO-GO.

## 2026-09-14 (Day plan v51: Desktop viewport 与 assistive-tech 验证)

Completed the v51 QA review from `docs/day-plan-v51.md`. The available in-app browser can provide
DOM/accessibility snapshots, screenshots, keyboard actions, and console health, but its current
capability list does not provide a viewport override or real screen-reader announcement output.

### Decision: Preserve / deferred

- Desktop/default viewport smoke found no reproducible overflow, focus loss, ARIA error, stale
  session result, or sensitive-field leak. Evidence success/error/stale/session-switch behavior
  remains covered by the v49/v50 served-HTML and browser checks.
- No browser/DOM dependency was added and no CSS or runtime behavior was changed speculatively.
  Narrow-window screenshots and actual screen-reader announcements are explicitly deferred rather
  than inferred from the default window.
- The v51 decision matrix and harness boundary are recorded in
  `docs/desktop-viewport-qa-v51.md`; ARIA/status/usage/counts/bytes remain presentation hints, not
  execution, validation, recovery, rollback, or Undo authority.

### Validation

- Existing post-v50 focused/full gates, report smoke, structure check, inline script check, and
  `git diff --check` remained green; v51 itself added no runtime code.

### Next boundary

v52 is recorded in `docs/day-plan-v52.md` and should start only from a concrete viewport harness,
real assistive-technology feedback, reproducible narrow-window interaction issue, or another
explicit Desktop UX trigger. Otherwise keep the preview/integrity surface frozen.

## 2026-09-14 (Day plan v55: macOS live Rust integration CI)

Completed the local v55 CI coverage slice from `docs/day-plan-v55.md`. The repository now has a
fixed `pnpm verify:integration` entrypoint and a dedicated macOS job that runs the Rust gate,
checks live prerequisites, and then executes real Rust integration instead of relying on Ubuntu skips.

### Added: fail-closed macOS integration job

- Added `verify:integration` as the root entrypoint for the fixed `--integration` gate mode.
- Added a pinned `macos-15` workflow job with Rust/protobuf/dependency setup and the order
  `verify:rust` → binary/sandbox/Python prerequisite checks → `verify:integration`.
- Missing `runtime/rust/target/debug/dev-agent-executor`, `/usr/bin/sandbox-exec`, or a usable
  Python socket fixture now fails the job rather than silently presenting skipped sandbox tests as
  live coverage.
- Added a release-gate workflow contract test; no runtime, API, schema, dependency, Evidence,
  session, Undo, or report-allowlist behavior changed.

### Validation

- RED before implementation: release-gate focused contract **11/12**.
- GREEN after implementation: release-gate focused contract **12/12** and
  `pnpm verify:integration` **10/10**.
- Fresh full `pnpm verify`: TypeScript workspace **614/614**, preview **8/8**, release-gate
  contract **12/12**, Rust unit/doc **46/46**, real-Rust integration **10/10**.
- YAML parse, structure check, `git diff --check`, and release-gate syntax checks passed.

### External evidence boundary

The first GitHub-hosted `macos-15` run is intentionally left for v56; local tests prove the workflow
contract but cannot prove the hosted image's sandbox availability.

## 2026-09-14 (Day plan v54: metrics source-of-truth Preserve)

Completed the v54 metrics inventory and kept automatic public test-count generation at
**Preserve / NO-GO**. No CI consumer, dashboard, reporter requirement, or stable low-risk count
contract was found.

- README remains suite-category-only; exact counts live in dated validation documents.
- No metrics reporter, script, dependency, release-report field, or gate behavior was added.
- The independent live Rust integration CI gap discovered during the inventory was routed to v55.

### Next boundary

v56 observes the first hosted macOS integration run and records runner compatibility without treating
local workflow-contract evidence as remote success.

## 2026-09-14 (Day plan v53: release summary source-of-truth)

Completed the v53 source-of-truth inventory from `docs/day-plan-v53.md`. A fresh gate confirmed
that the current TypeScript workspace has **614/614** tests, so the v52 hand-written 612 summary was
not stable enough for an evergreen README.

### Inventory and decision

- `pnpm test` currently reports model **54**, code-intelligence **30**, MCP **49**, executor **48**,
  agent-core **118**, tools **121**, Desktop **76**, and CLI **118**: **614/614** in total.
- The fixed gate also passes preview-contract **8/8**, release-gate contract **11/11**, Rust unit/doc
  **46/46**, and real-Rust integration **10/10**.
- `scripts/release-gate.mjs --report` remains metadata-only and intentionally contains no stdout,
  commands, paths, environment values, or test counts.
- Decision: **Preserve / NO-GO** for automatic public test-count generation. Parsing concurrent
  reporter output, scanning source for `test()` calls, or wrapping the gate again would add fragile
  authority and maintenance behavior without an explicit consumer.

### Minimal stabilization

- The current `README.md` summary now names the fixed release-gate suite categories without hardcoded
  totals; dated validation documents retain exact counts and their evidence.
- No runtime, dependency, test-runner, API, schema, UI, gate-order, report-allowlist, session, or
  Evidence authority behavior changed.
- The decision and inventory are recorded in `docs/release-summary-source-of-truth-v53.md`.

### Validation

- Fresh `pnpm verify` passed all fixed stages with the counts above.
- `node scripts/check.mjs` and `git diff --check` passed.

### Next boundary

v54 is recorded in `docs/day-plan-v54.md`. It should only design a machine-readable metrics contract
if CI, a dashboard, or a maintainer supplies an explicit consumer and field-level requirement.

## 2026-09-14 (Day plan v52: release documentation accuracy)

Completed the initial documentation-only v52 slice after finding a concrete mismatch: `README.md`
still reported **543 TypeScript tests**, while the then-current gate record was already higher and
included separate preview-contract and release-gate contract suites.

### Minimal correction and supersession

- The initial v52 patch changed the README summary to the then-recorded TypeScript workspace **612**,
  preview-contract **8**, release-gate contract **11**, Rust unit/doc **46**, and real-binary
  integration **10**.
- v53 fresh revalidation found the actual current workspace total is **614/614** (see the package
  breakdown in the v53 decision doc), so 612 is explicitly superseded rather than presented as a
  current evergreen number.
- The current README now uses suite-category-only wording. No test runner, runtime, API, schema, UI,
  dependency, or authority behavior changed.

### Validation

- The original v52 evidence was the post-v50 gate record; the v53 fresh `pnpm verify` superseded its
  workspace count with **614/614**, preview **8/8**, release-gate **11/11**, Rust unit/doc **46/46**,
  and real-Rust integration **10/10**.
- Structure check and `git diff --check` passed.

### Next boundary

v53 is recorded in `docs/day-plan-v53.md` to evaluate a low-risk source-of-truth for future release
summary counts while keeping the metadata-only gate/report boundary intact.

## 2026-09-14 (Day plan v49: Desktop evidence preview 可发现性与只读 UX)

Executed `docs/day-plan-v49.md`. v49 closes the Desktop discoverability gap for the existing
metadata-only evidence preview without changing the preview API, v1 export, session memory, or
release-gate contract.

### Added: read-only Evidence summary panel

- `apps/desktop/public/index.html` now places an `Evidence` control beside transcript `Download`.
  The panel is hidden by default and loads only after an explicit click or `Refresh`.
- The UI accepts only the v1 preview schema's session-bound numeric metadata and renders
  Validations, Change sets, Files, and a human-readable estimated export size. It never renders
  raw evidence records, commands, paths, output/error text, diffs, patches, or file bytes.
- `AbortController`, request identity, current-session checks, and a data revision guard prevent
  an old or concurrently stale response from being presented as the current session's summary.
  Generic errors remain retryable and do not expose server details.
- Session switching, new/rename/delete actions clear the panel; validation/rerun/Undo changes mark
  a visible panel stale until the user refreshes it. No response is persisted in localStorage or
  session memory.

### Decision: no separate Desktop audit JSON download

Task 2 is **NO-GO** without usage evidence. The existing Download remains a Markdown transcript;
metadata-only v1 JSON continues to be available through the established CLI/API surfaces and their
explicit rejection-only limits. Preview bytes are not treated as download, execution, restore,
validation, rollback, or Undo authority.

### Tests and release validation

- Added a RED-to-GREEN served-HTML UI contract in `apps/desktop/tests/server.test.ts`; focused
  Desktop suite passed **75/75**.
- In-app browser smoke covered hidden initial state, successful `1/1/1` fixture rendering with
  `924 B`, generic unknown-session error, session switch cleanup, keyboard activation, screenshot
  layout, and an empty warn/error console log check.
- Inline UI JavaScript passed `node --check`; decision matrix and boundaries are recorded in
  `docs/evidence-preview-ui-v49.md`.

### Next boundary

After the full release verification and push, v50 will focus on accessibility/interaction coverage
for the Desktop shell rather than expanding preview or integrity fields without a concrete user need.

## 2026-09-14 (Day plan v48: preview contract gate coverage)

Executed `docs/day-plan-v48.md`. v48 wires the lightweight v45/v46 preview contract suites
into the fixed TypeScript release gate without adding a preview runtime surface or putting the
large benchmark matrix into CI.

### Added: fixed `preview-contract` phase

- `scripts/release-gate.mjs` now runs a `preview-contract` phase after the workspace TypeScript
  tests and before the release-gate contract tests, using the fixed command
  `node --test tests/evidence-preview-benchmark.test.mjs tests/evidence-preview-parity.test.mjs`.
- The phase reuses the existing build output and fixed repository cwd with `shell=false`; it runs
  the 5 benchmark contract tests and 3 cross-surface parity tests, for **8/8** lightweight tests.
- Release-gate contract tests cover the exact phase command, position, cwd, shell setting, and
  fail-fast/report behavior. The report still contains only stable phase metadata.

### Boundary

The 100,000-file full benchmark remains explicit via `pnpm benchmark:evidence` and is not run by
`pnpm verify` or default CI. No digest, pagination, cursor, partial response, schema v2,
before-image, or Undo authority was added; v1 export and preview contracts remain unchanged.

### Tests and release validation

- `pnpm verify:typescript`: workspace **612/612**, preview contract **8/8**, release-gate
  contract **11/11**.
- Full `pnpm verify`: TypeScript workspace **612/612**, preview contract **8/8**, release-gate
  contract **11/11**, Rust unit/doc **46/46**, real-Rust integration **10/10**.
- Independent Rust/TypeScript gates, report allowlist smoke, structure check, and
  `git diff --check` passed.

### Next boundary

v49 is documented in `docs/day-plan-v49.md` to choose the next user-valued capability from
actual usage signals rather than adding more speculative preview/integrity fields.

## 2026-09-14 (Day plan v47: canonical metadata digest review)

Executed `docs/day-plan-v47.md` as a design-only review. The repository inventory found no
real digest consumer: `serializedBytes` already serves the only identified preview use case,
choosing an explicit v41 export limit.

### Decision: no public digest or signature

- No cache key, remote sync, audit-correlation, signature-verification, or authenticity consumer
  exists in the current CLI/Desktop/CI/session-memory surfaces. A deterministic SHA-256 hash is
  technically feasible, but algorithm availability alone is not a product requirement.
- A future hash would have to cover exactly the full v1 canonical UTF-8 serializer bytes with
  explicit algorithm/domain/schema/session/filter binding; it must remain content identity only,
  not execution, validation, restore, rollback, or Undo authority.
- There is no key ownership, rotation, verification, revocation, or trust anchor for a signature,
  so signature work is **NO-GO**. v47 adds no digest field, CLI flag, Desktop query, MCP resource,
  persisted record, Rust protocol, or schema version.

### Review and validation

- Inventory, abuse/compatibility matrix, and boundaries are recorded in
  `docs/evidence-digest-review-v47.md`.
- Existing full TypeScript/Rust/integration gates, report allowlist smoke, structure check, and
  `git diff --check` passed; no runtime behavior changed.

### Next boundary

v48 is documented in `docs/day-plan-v48.md` to include the already-created v45/v46 root preview
contract tests in the fixed TypeScript release gate. The full 100,000-file benchmark remains an
explicit development command rather than a default CI phase.

## 2026-09-14 (Day plan v46: preview cross-surface parity)

Executed `docs/day-plan-v46.md`. v46 adds a cross-surface regression harness for the same
persisted metadata-only evidence fixture and resolves the remaining Desktop query review as
compatibility-preserving behavior.

### Added: core/CLI/Desktop parity evidence

- Added `tests/evidence-preview-parity.test.mjs` and `pnpm test:preview-parity` to exercise
  the same temporary `FileMemory` through agent-core, CLI, and Desktop. Four standard filter
  cases (unfiltered, status, UTF-8 change-set id, UTF-8 validation id) produced identical
  counts, file counts, and canonical UTF-8 byte sizes.
- The harness verifies the fixed seven-field success allowlist, input/memory/workspace
  immutability, no provider load, no Desktop session run, and no persisted command/cwd/output/
  error leakage.
- The query matrix compares preview with the existing `/messages` history endpoint for empty,
  duplicate, unknown, and encoded query values, and covers unknown-session and audit-limit
  error ordering.

### Decision: preserve Desktop query compatibility

- Empty values remain absent, duplicate values continue to use the first `URLSearchParams.get()`
  value, unknown query names remain ignored, and encoded UTF-8 filters remain supported. The
  same behavior is now regression-tested against `/messages`; no silent session-selection change
  or concrete proof gap was found.
- Decision is **Preserve / tests-only**. No query tightening, schema negotiation, pagination,
  cursor, partial response, before-image, or Undo authority was added. v1 export, v41 limits,
  and preview success/error contracts are unchanged.

### Tests and release validation

- Cross-surface parity suite passed: **3/3**.
- Full `pnpm verify` passed: TypeScript workspace **612/612**, release-gate **9/9**, Rust
  unit/doc **46/46**, real-Rust integration **10/10**. Independent TypeScript/Rust gates,
  report allowlist smoke, structure check, and `git diff --check` also passed.

### Next boundary

v47 is documented in `docs/day-plan-v47.md` to evaluate whether a deterministic canonical
metadata hash has a real consumer. A hash must not be presented as a signature or used as
execution/recovery authority; absent a concrete consumer and trust model, v47 will remain
design-only/NO-GO.


## 2026-09-14 (Day plan v45: preview bounded-work benchmark)

Executed `docs/day-plan-v45.md`. v45 adds a reproducible, dev-only benchmark for the
metadata-only evidence preview and uses controlled synthetic evidence to decide whether
a second preview hard cap is justified.

### Added: benchmark and regression contract

- Added `scripts/evidence-preview-benchmark.mjs` with the fixed `empty`, `small`,
  `retention-sized`, `record-cap-sized`, `files-heavy`, and `utf8-heavy` fixture matrix.
  Fixtures stay in memory, include deliberately non-exported sensitive fields, and emit
  only schema version, generated time, counts, canonical UTF-8 bytes, duration, and
  approximate heap measurements.
- Added `pnpm test:benchmark` and `pnpm benchmark:evidence`; the ad-hoc artifact is
  written only to ignored `.dev-agent/evidence-preview-benchmark.json`.
- Added regression coverage for full-export byte parity, stable ordering, input immutability,
  malformed fixture selection, fixed output allowlists, and no sensitive fixture fields.

### Decision: no new preview hard cap

- Two independent runs reached the planned 100,000-file fixture at **27,489,424 bytes**,
  **74--76 ms**, and approximately **61.2 MiB** heap delta. The 10,000-record fixture was
  **6,621,261 bytes** and **23--25 ms**. All six preview byte counts matched the full v1
  export's canonical UTF-8 serialization exactly.
- The 100,000-file projection is explicitly rejected by the existing v41 `maxBytes` export
  limit with `EVIDENCE_AUDIT_LIMIT_EXCEEDED`, rather than truncated. No concrete availability
  failure or serialization inconsistency was reproduced, so a second preview-only hard cap
  is **NO-GO** for v45.
- No pagination, cursor, partial response, schema v2, before-image, or Undo authority was added.
  The current preview and v1 export runtime contracts remain unchanged.

### Tests and release validation

- Benchmark regression suite passed: **5/5**.
- Full `pnpm verify` passed: TypeScript workspace **612/612**, release-gate contract **9/9**,
  Rust unit/doc **46/46**, real-Rust integration **10/10**. Independent TypeScript/Rust gates,
  metadata-only report smoke, structure check, and `git diff --check` also passed.

### Boundary

The benchmark covers the bounded synthetic matrix only; future evidence of multi-million-file
or sustained heap-pressure behavior should start a new benchmark before changing runtime.
Pagination/schema v2 remain **CONDITIONAL**, and before-image/cross-process Undo remains
**NO-GO**.

## 2026-09-14 (Day plan v44: preview input isolation hardening)

Executed `docs/day-plan-v44.md`. v44 reviewed preview input ambiguity and bounded-work
risk, then implemented only the concrete CLI operation-isolation fix.

### Added: explicit CLI preview exclusivity

- `--preview-evidence` now rejects competing command operations before version, provider,
  MCP, workspace, Rust, or session-mutation branches can run. This covers prompts,
  indexing, cleanup/export, reset/compact, delete/rename, tools/metadata/list, doctor,
  MCP server, Rust checks/configuration, and approval flags. Session selection, evidence
  filters, and harmless output flags remain available.
- The preview response and v1 export contracts are unchanged; no cursor, partial response,
  schema v2, before-image, or recovery authority was added.

### Review and regression evidence

- CLI competing-operation tests cover 14 representative combinations and prove that the
  selected memory file is unchanged; malformed-memory preview errors remain generic.
- Desktop malformed-memory preview errors remain generic. Desktop unknown/duplicate/empty
  query semantics are preserved for compatibility and remain a conditional follow-up.
- Potentially large complete projection work is not silently capped or truncated. A bounded
  work benchmark and any explicit rejection contract are deferred to v45.

### Tests and release validation

- Focused suites passed: agent-core **118/118**, CLI **118/118**, Desktop **74/74**.
- Full `pnpm verify` passed: TypeScript workspace **612/612**, release-gate contract
  **9/9**, Rust unit/doc **46/46**, real-Rust integration **10/10**.
- Separate TypeScript/Rust gates, metadata-only report allowlist smoke, structure check, and
  `git diff --check` passed.

### Boundary

No v1 export field changed. Desktop query tightening and preview bounded-work caps remain
**CONDITIONAL** pending evidence. Pagination/schema v2 remain **CONDITIONAL** and
before-image/cross-process Undo remains **NO-GO**.

## 2026-09-14 (Day plan v43: canonical audit preflight and read-only preview)

Executed `docs/day-plan-v43.md`. v43 adds a separate metadata-only preview for
selecting v41 rejection-only export limits while keeping the v1 audit export
complete, stable, and backward-compatible.

### Added: agent-core canonical preview contract

- `serializeEvidenceAuditExport()` is the single canonical serializer used by both
  v1 byte-limit enforcement and preview sizing. It serializes the stable allowlist
  projection and measures UTF-8 bytes with `Buffer.byteLength(..., "utf8")`.
- `EvidenceAuditPreview` has its own schema version and fixed fields:
  `schemaVersion`, `sessionId`, `generatedAt`, `validationCount`,
  `changeSetCount`, `fileCount`, and `serializedBytes`. It never contains the v1
  evidence records or internal validation/change-set fields.
- Preview builds the complete filtered projection before reporting its size; it does
  not truncate, paginate, add cursors, negotiate schema v2, or authorize restore/Undo.

### Added: CLI/Desktop read-only mapping

- CLI `--preview-evidence` accepts the standard evidence filters and prints only the
  fixed preview metadata without initializing a provider or MCP server. It rejects
  audit-limit flags and cannot be combined with export or cleanup.
- Desktop `GET /api/sessions/<id>/evidence/preview` accepts the standard evidence
  filters and rejects audit-limit query values because limits apply only to the full
  `/evidence` endpoint. Unknown sessions return `404`; preview errors are generic
  and do not echo persisted evidence details.
- Both surfaces read only the selected session memory, preserve the memory file, and
  exclude commands, paths, output/errors, file contents, before-images, and working
  directory values from the response.

### Tests and release validation

- Focused suites passed: agent-core **118/118**, CLI **116/116**, Desktop **73/73**.
- Full `pnpm verify` passed: TypeScript workspace **609/609**, release-gate contract
  **9/9**, Rust unit/doc **46/46**, real-Rust integration **10/10**.
- Separate `pnpm verify:typescript` and `pnpm verify:rust` gates passed. Structure
  check, `git diff --check`, metadata-only report smoke, and sensitive-field/side-effect
  review passed.

### Boundary

No v1 export field changed. No `partial`, `hasMore`, `nextCursor`, pagination, schema v2,
before-image, patch, diff, file bytes, historical command, or cross-process Undo behavior
was added. v42 pagination/schema v2 remain **CONDITIONAL** and before-image/cross-process
Undo remains **NO-GO**.

## 2026-09-14 (Day plan v42: pagination/schema v2 and before-image review)

Executed `docs/day-plan-v42.md` as a design-only review. v42 freezes the v1
metadata-only export contract, evaluates future keyset pagination and schema v2
compatibility, and independently rechecks the seven before-image safety gates.

### Decisions

- Keyset pagination is **CONDITIONAL**: future work needs snapshot binding, strict
  cursor validation, deterministic invalidation, page/full distinction, and UTF-8
  byte-budget proof before any runtime fields or endpoint are added.
- Schema v2 is **CONDITIONAL**: future work needs explicit supported-version
  intersection, strict allowlist parsing, old-client rejection, migration/rollback
  tests, and no implicit downgrade.
- Before-image and cross-process Undo remain **NO-GO**. Existing postimage guards,
  same-process rollback, retention, and metadata-only audit tests do not prove the
  seven required before-image safety gates.

### Review artifacts

- `docs/evidence-pagination-review-v42.md` defines stable tuple ordering, cursor
  bindings, mutation/expiry/session/schema failure cases, and single-record byte-budget
  behavior without implementing pagination.
- `docs/evidence-schema-v2-review-v42.md` defines version negotiation and full/page
  compatibility expectations without publishing schema v2.
- `docs/before-image-review-v42.md` records the evidence ledger and proof gaps for all
  seven gates. `docs/evidence-review-conclusion-v42.md` records the final decisions.

### Boundary

No runtime code, memory schema, v1 field, cursor, partial response, before-image,
restore API, historical command, or cross-process Undo behavior changed.

## 2026-09-14 (Day plan v41: rejection-only audit export limits)

Executed `docs/day-plan-v41.md`. v41 keeps the evidence audit export version 1
metadata-only and adds explicit fail-closed limits without pagination, schema v2,
before-image persistence, or cross-process Undo.

### Added: agent-core audit limits

- `EvidenceAuditLimits` supports validation count, change-set count, total file count,
  and canonical UTF-8 byte limits. Code-defined request caps are 10,000 validations,
  10,000 change sets, 100,000 files, and 10,485,760 bytes.
- Limits are validated as positive safe integers before projection is returned. The full
  allowlisted projection is built and stably sorted first; exceeding a limit throws a
  metadata-only `EvidenceAuditLimitError` with only `code`, `kind`, `limit`, and `actual`.
  No partial v1 snapshot is returned and source evidence is not mutated.

### Added: CLI/Desktop read-only mapping

- CLI `--export-evidence` accepts `--audit-max-validations`,
  `--audit-max-change-sets`, `--audit-max-files`, and `--audit-max-bytes`. Invalid
  values fail before provider initialization; an over-limit export exits non-zero and
  writes only a structured metadata error to stderr.
- Desktop `GET /api/sessions/<id>/evidence` accepts matching camel-case query values.
  Invalid values return `400`; an over-limit complete snapshot returns `413` with the
  same `code`, `kind`, `limit`, and `actual` fields. Neither surface truncates, paginates,
  reads the workspace, or enters the chat queue.

### Tests

- Full `pnpm verify` passed: TypeScript workspace **606/606**, release-gate contract
  **9/9**, Rust unit/doc **46/46**, real-Rust integration **10/10**.
- Focused regression suites: agent-core **116/116**, CLI **115/115**, Desktop **73/73**.
- Separate TypeScript/Rust gates, five-step `--report` smoke, structure check, and
  `git diff --check` passed. The before-image seven-gate decision remains **NO-GO**.

### Boundary

No `partial`, `hasMore`, `nextCursor`, schema v2, before-image, patch, diff, file bytes,
historical command, or cross-process Undo behavior was added. Future pagination/schema review
is tracked in `docs/day-plan-v42.md`.

## 2026-09-14 (Day plan v40: metadata-only verification report and audit limits design)

Executed `docs/day-plan-v40.md`. v40 adds an opt-in, metadata-only report for
the fixed release gate and records the compatibility/size boundary for future
audit export work without expanding the runtime evidence schema.

### Added: opt-in gate report

- `scripts/release-gate.mjs --report` writes an atomic report only to the fixed
  ignored path `.dev-agent/release-gate-report.json`; without the flag, the gate
  does not create or update a report.
- The report schema is explicitly allowlisted: schema version, selected modes,
  phase ids, status, timestamps, durations, exit codes, and failed phase only.
  Commands, arguments, working directories, output, environment values, session
  evidence, and file contents are excluded.
- The report records only completed phases and the first failure, preserving the
  fixed TypeScript → Rust → real-Rust integration order and fail-fast behavior.

### Added: audit export limits design

- `docs/evidence-audit-limits-v40.md` defines fail-closed record/file/byte limits,
  canonical UTF-8 serialization, keyset pagination, cursor invalidation, and
  schema negotiation. v1 must not silently truncate or introduce partial-export
  fields.
- Before-image recovery remains **NO-GO** until the seven independent safety
  gates in `docs/before-image-gate-v39.md` have reproducible evidence.

### Tests

- Full `pnpm verify` passed in fixed order: TypeScript workspace **600/600**,
  release-gate contract **9/9**, Rust unit/doc **46/46** (43 library, 3 binary,
  0 doctests), and real-Rust integration **10/10**.
- `pnpm verify:typescript` and `pnpm verify:rust` also passed independently;
  structure check, build, typecheck, Rust fmt/clippy, and `git diff --check`
  passed.

## 2026-09-14 (Day plan v39: fixed release gate and before-image safety gates)

Executed `docs/day-plan-v39.md`. v39 makes the repository verification path
reusable locally and in CI, while keeping before-image recovery explicitly
behind a seven-gate safety review.

### Added: fixed release gate runner

- Added `scripts/release-gate.mjs` with fixed argv, fixed working directories,
  no shell execution, canonical TypeScript → Rust → real-Rust integration
  ordering, fail-fast behavior, and explicit phase selection.
- Added `pnpm verify`, `pnpm verify:typescript`, and `pnpm verify:rust`. The
  TypeScript gate also runs the runner contract suite so changes to the gate
  plan are exercised by CI.
- CI now calls the same phase-specific entry points instead of duplicating
  structure/build/typecheck/test and cargo commands.

### Added: before-image safety decision record

- `docs/before-image-gate-v39.md` defines integrity binding, capacity, sensitive
  data, user confirmation, atomic/recoverable failure, lifecycle/concurrency,
  and compatibility as independent go/no-go gates.
- The status remains **NO-GO**: no before-image bytes, recovery API, hidden
  switch, or cross-process Undo was added. Until every gate has reproducible
  evidence, only postimage-only validation and metadata-only audit remain
  allowed.

### Tests

- Full `pnpm verify` passed in the fixed order: TypeScript workspace **600/600**,
  release-gate contract **5/5**, Rust unit/doc **46/46** (43 library, 3 binary,
  0 doctests), and real-Rust integration **10/10**.
- `pnpm verify:typescript` and `pnpm verify:rust` also passed independently;
  structure check, build, typecheck, Rust fmt/clippy, and `git diff --check`
  passed.

## 2026-09-13 (Day plan v38: metadata-only audit export and lifecycle regression guard)

Executed `docs/day-plan-v38.md`. v38 turns persisted evidence into a versioned,
read-only audit projection for CLI and Desktop, then adds a long-term lifecycle
matrix without making evidence executable input or introducing cross-process
Undo.

### Added: metadata-only audit projection

- `@dev-agent/agent-core` now exposes a versioned `EvidenceAuditExport` built by
  an explicit allowlist. It includes stable identities, statuses, timings,
  hashes, counts, and safe relative paths; validation internals, commands,
  arguments, working directories, output, errors, reasons, diffs, patches,
  before-images, and file bytes remain excluded.
- Projection results are cloned and stably sorted. Relative paths normalize
  separators and reject NUL bytes, absolute paths, Windows drive paths, and
  parent traversal. Legacy `version: 1` memory without evidence remains
  readable and produces an empty versioned snapshot.

### Added: read-only CLI/Desktop surfaces

- CLI adds explicit `--export-evidence` with change-set, validation, and status
  filters. The path reads memory only, prints one JSON snapshot, and does not
  initialize a provider/MCP or touch the working directory.
- Desktop adds `GET /api/sessions/<id>/evidence` with the same session-scoped
  filters and projection. Unknown sessions and invalid statuses are explicit
  errors; the endpoint is read-only and bypasses the chat queue.

### Regression hardening

- The lifecycle matrix covers applied and rolled-back evidence through
  filtering, retention, explicit cleanup, and audit projection. Applied guards
  remain protected, rolled-back records cannot reactivate, and the existing
  v37 restore, postimage, cancellation, no-auto-rollback, MCP, and Rust
  boundaries remain in the release gate.
- Cross-process Undo remains intentionally out of scope until a separate
  before-image design review covers integrity, capacity, sensitive data,
  confirmation, failure recovery, lifecycle/concurrency, and compatibility.

### Tests

- Full TypeScript workspace tests: **600/600** (model 54, code-intelligence
  30, MCP 49, executor 48, agent-core 111, tools 121, Desktop 73, CLI 114).
- Real Rust-binary integration tests: **10/10**; Rust unit/doc tests: **46/46**
  (43 library, 3 binary, 0 doctests). Structure check, build, typecheck, Rust
  fmt/clippy, and `git diff --check` also passed.

## 2026-09-13 (Day plan v37: evidence lifecycle and continuous regression guard)

Executed `docs/day-plan-v37.md`. v36 made applied change-set evidence safe to
restore across processes; v37 adds bounded retention, durable rollback state,
explicit cleanup, and operator-visible summaries without making evidence an
execution input.

### Added: bounded evidence lifecycle

- `InMemoryMemory` and `FileMemory` retain at most 100 validation attempts and
  use a soft 100-record change-set limit by default. `applied` change-set guards
  are never implicitly pruned; only non-active `rolled-back` records are
  eligible for explicit cleanup.
- `markChangeSetRolledBack()` is persisted only after a guarded filesystem Undo
  succeeds. A postimage conflict, failed operation, cancellation, or unavailable
  sync leaves the durable state unchanged; rolled-back records do not revive an
  old before-image or enable cross-process Undo.
- `pruneEvidence()` changes only memory metadata and returns removal, protected,
  and remaining counts. `evidenceSummary()` exposes counts, effective limits,
  and the reason applied guards remain protected.

### Added: CLI/Desktop visibility and cleanup

- CLI adds `--cleanup-evidence` with optional bounds and
  `--remove-rolled-back`; interactive mode adds `:cleanup` with the same options.
  JSON prompt, metadata, session-list, and cleanup results include structured
  retention summaries.
- Desktop history/session summaries and Markdown exports include the same
  metadata-only summary. `POST /api/changesets/cleanup` validates session/limit
  input, serializes cleanup per session, distinguishes `400`/`404`/`409`/`501`,
  and never touches the working directory.
- Existing history fields, old `version: 1` memory files, validation filters,
  restore guards, cancellation, MCP, and Rust boundaries remain compatible.

### Regression hardening

- The interactive CLI now installs its `SIGINT` listener before publishing the
  readiness banner. This closes the pipe-observation race that could make an
  idle `Ctrl-C` terminate by signal instead of returning the documented exit
  status `130`; the fix is covered by the existing idle-interrupt test and a
  repeated 100-run reproduction.

### Tests

- Focused suites after the lifecycle changes: agent-core **106/106**, CLI
  **112/112**, and Desktop **73/73**.
- Full TypeScript workspace tests: **593/593** (model 54, code-intelligence 30,
  MCP 49, executor 48, agent-core 106, tools 121, Desktop 73, CLI 112).
- Real Rust-binary integration tests: **10/10**; Rust unit/doc tests: **46/46**
  (43 library, 3 binary, 0 doctests). Structure check, build, typecheck, Rust
  fmt/clippy, and `git diff --check` also passed.
- The v37 regression matrix retains coverage for session/workdir binding,
  postimage conflicts, rolled-back restore rejection, cancellation, no-auto-
  rollback, metadata-only cleanup, and protected applied guards.

## 2026-09-14 (Day plan v36: cross-process change-set evidence)

Executed `docs/day-plan-v36.md`. v35 persisted validation attempts, but the
applied change-set guard itself was process-local, so a restart could not safely
rerun validation. v36 persists the smallest evidence needed to recognize an
already-applied change without turning history into executable input.

### Added: restart-safe applied evidence

- `AgentMemory` now exposes `recordChangeSet()` and `changeSets()` for a
  minimal `AppliedChangeSetRecord`. `FileMemory` persists it and remains
  compatible with older `version: 1` session files that have no `changeSets`
  field. The record contains session/workdir binding, relative file metadata,
  existence, SHA-256 before/after hashes, statistics, and applied state — never
  commands, diffs, or file bytes.
- `AgentLoop` records evidence only after a review-backed apply succeeds. A
  persistence failure is best-effort and does not turn a successful apply into a
  failure or trigger rollback.
- `FilesystemTool` restores records only after rechecking session id,
  canonical working directory, safe paths, file kind, existence, ancestor
  symlink boundaries, and postimage hashes. A conflict is returned as blocked
  without writing or repairing the workspace. Restored records are postimage-
  only guards and explicitly cannot be undone across processes.
- CLI and Desktop restore evidence at session startup and before explicit
  validation reruns. A new process/session can rerun trusted validation when the
  postimage still matches; a session/workdir mismatch or changed file becomes a
  blocked result. Evidence remains outside model context.

### Added: structured evidence visibility and filters

- CLI prompt JSON and interactive `:validate` JSON now include a metadata-only
  `changeSets` array alongside `reviews`/`validations`.
- Desktop history and Markdown export now include `changeSets`. `GET
  /api/sessions/<id>/messages` and `/export` accept `changeSetId`, `validationId`,
  and `status` filters; invalid statuses return a structured `400`, while full
  messages remain available and only evidence arrays are narrowed.
- Legacy memory without change-set evidence remains readable and returns an
  empty array. Evidence summaries omit diffs, commands, and file contents.

### Tests

- Focused suites: agent-core **99/99**, tools **120/120**, CLI **110/110**, and
  Desktop **70/70**.
- Full TypeScript workspace tests: **580 passed**; real Rust-binary integration:
  **10 passed**; Rust unit/doc tests: **46 passed**.
- The full parallel run exposed a cancellation-fixture race that observed the
  marker file between creation and write; the test now waits for the cancellation
  record contents, keeping the suite deterministic without changing runtime
  behavior.
- Structure check, build, typecheck, Rust fmt/clippy, and `git diff --check` all
  pass.

## 2026-09-13 (Day plan v35: validation evidence, reruns, and policies)

Executed `docs/day-plan-v35.md`. v35 turns one-shot change-set validation into
session evidence that can be queried and exported, adds an explicit guarded
rerun path, and limits validation selection to fixed safe policies.

### Added: persisted validation evidence

- `ValidationRecord` adds `recordedAt`; `InMemoryMemory` and `FileMemory` retain
  validation DTOs across writes, compaction, clear, and process boundaries while
  continuing to read old `version: 1` session files without a `validations` field.
- AgentLoop records validation after emitting it as a best-effort side effect;
  evidence is not inserted into ordinary model message context and a persistence
  error never turns a successful apply into a failed apply.
- Desktop history/export and CLI `--json` expose the same structured evidence,
  including check status, bounded output, reason, duration, and change-set id.

### Added: guarded explicit reruns

- CLI interactive mode supports `:validate <changeSetId>`; Desktop exposes
  `POST /api/changesets/validate` and a rerun action on validation cards.
- Each rerun gets a fresh validation attempt id but remains linked to the
  original change set. The change-set guard checks the postimage before and
  after validation and serializes rerun with rollback/Undo.
- Unknown, prepared, rolled-back, busy, or conflicting change sets are rejected
  explicitly. Validation failure, timeout, cancel, and blocked states never
  auto-rollback or overwrite user bytes.

### Added: restricted validation policies

- `fast` runs the quickest relevant checks, `default` preserves the changed-path
  baseline, and `strict` adds fixed bounded workspace typecheck/test checks for
  package or workspace changes.
- Policy selection accepts only `fast`, `default`, or `strict`. Timeout overrides
  are positive integers under code-defined caps; validation config rejects
  executable, shell, args, cwd, diff, and custom check fields.

### Tests

- Full TypeScript workspace tests: **565 passed** (agent-core 92, tools 115,
  CLI 109, Desktop 68, plus the other workspace packages).
- Real Rust-binary integration tests: **10 passed**.
- Rust unit/doc tests: **46 passed** (43 library, 3 binary, 0 doctests).
- Structure check, build, typecheck, Rust fmt/clippy, and `git diff --check`
  passed.

## 2026-09-13 (Day plan v34: change-set validation)

Executed `docs/day-plan-v34.md`. After v33 made filesystem changes reviewable
and reversible, the next gap was knowing whether an approved change still
passed the smallest relevant checks. v34 adds deterministic validation derived
from the applied change set and keeps validation status separate from apply
status.

### Added: structured validation plans and bounded execution

- `@dev-agent/agent-core` now defines `ValidationPlan`, `ValidationCheck`,
  `ValidationResult`, and `ValidationAdapter`. Validation runs only after a
  reviewed filesystem `apply` returns `{ ok: true, changeSetId }` for the same
  reviewed change set.
- `@dev-agent/tools` derives allowlisted checks from changed paths: affected
  package typecheck/test, Rust format/lint/test, or a bounded Git whitespace
  check for documentation/configuration paths. Unknown-only changes are skipped;
  duplicate or escaping review paths are blocked. Model-provided command strings
  and diff text never become validation commands.
- `createValidationRunner` reuses the existing executor, forwards cwd/timeout
  and AbortSignal, bounds captured output to 64 KiB by default, stops after the
  first failure, and records skipped/blocked reasons. Validation failure never
  auto-rolls back an already-applied change.

### CLI and Desktop feedback

- CLI human mode prints validation status, check id, command summary, duration,
  and failure reason. `--json` remains one stdout object and adds a complete
  `validations` array alongside `reviews`. Non-Git workspaces safely report a
  skipped validation, while MCP server mode keeps its no-review mutation denial.
- Desktop emits a `validation` SSE frame after the apply `tool-result`, including
  the session id and full validation DTO. The UI renders pass/fail/skipped/blocked
  cards and keeps guarded Undo available. Stopping during validation reports a
  blocked validation before the terminal aborted event.

### Tests

- Agent-core validation lifecycle: **86/86**; tools validation runner/planner:
  **106/106**; CLI: **105/105**; Desktop: **65/65**.
- Repository-wide TypeScript tests: **543 passed**.
- Real Rust-binary integration tests: **10 passed**.
- Rust `fmt --check`, `clippy --all-targets -- -D warnings`, and unit/doc tests
  pass: **46 passed** (43 library, 3 binary, 0 doctests).

## 2026-09-13 (Day plan v33: reviewed filesystem changes)

Executed `docs/day-plan-v33.md`. The agent could approve dangerous commands, but
filesystem mutations were still opaque: a user had to trust a write before
seeing the exact bytes, and there was no guarded way to undo an approved change.

### Added: change-set preview, approval, atomic apply, and rollback

- `FilesystemTool` now has a read-only `preview` action and a
  `prepareChangeSet()` contract. A preview records a stable `changeSetId`,
  per-file existence/kind, SHA-256 before/after hashes, unified diff, and
  addition/deletion counts without writing to the workspace.
- `write`, `edit`, `patch`, and `mkdir` mutations can be reviewed as one
  all-or-nothing change set. Applying it rechecks every preimage and replaces
  files through same-directory temporary files plus rename, so a stale review or
  partial failure cannot silently leave a mixed change behind.
- A successfully applied change set can be rolled back only while every
  postimage still matches. External edits produce a conflict instead of being
  overwritten; new files and created directories are removed during a guarded
  rollback.
- `review-writes` is available in the AgentLoop, CLI, and Desktop. The CLI
  prints the real diff and records structured `reviews` in `--json`; MCP stdio
  mode denies mutations because it has no interactive reviewer channel.
- Desktop `approval-request` SSE events carry the review payload, the browser
  renders it as a safe diff card, and `POST /api/changesets/rollback` powers the
  post-approval **Undo** action with explicit 404/409/501 outcomes.

### Tests

- Focused package suites pass: tools **90/90**, agent-core **79/79**, CLI
  **101/101**, and Desktop **61/61**.
- Repository-wide TypeScript tests: **512 passed**.
- Real Rust-binary integration tests: **10 passed**.
- Rust `fmt --check`, `clippy --all-targets -- -D warnings`, and unit/doc tests
  pass: **46 passed** (43 library, 3 binary, 0 doctests).
- Structure check, build, typecheck, browser-script syntax check, and
  `git diff --check` all pass. Manual review confirmed preimage/postimage
  conflict guards, atomic failure paths, bounded change-set retention,
  approval cleanup, and per-session concurrency protection.

## 2026-09-13 (Day plan v32: cancellable and observable MCP tools)

Executed `docs/day-plan-v32.md`. MCP calls could time out, but there was no
end-to-end way for an AgentLoop, CLI, or desktop client to stop an external MCP
tool or observe its progress.

### Added: MCP cancellation and progress propagation
- `McpClient.callTool()` and `McpTool.execute()` accept an optional `AbortSignal`
  and progress callback. An in-flight abort sends
  `notifications/cancelled` with the request id and rejects with
  `McpRequestError` code `-32001`; timeout cancellation uses code `-32000`.
- Pending requests clean up their timer, abort listener, progress route, and map
  entry on every terminal path. Already-aborted calls do not write a request or
  cancellation notification, and late responses are ignored.
- AgentLoop forwards tool progress without changing the existing tool result
  contract. Human-readable CLI output prints `[tool-progress]`, while `--json`
  remains a single parseable JSON value.
- Desktop SSE emits `tool-progress` frames in `tool` → progress → `tool-result`
  order. Configured desktop MCP stdio clients receive the same abort signal and
  are closed with their session; cancellation still ends with
  `done { "status": "aborted" }` and no late result.

### Tests

- Focused MCP (49), AgentLoop (72), CLI (97), and desktop (52) suites pass.
- Repository-wide TypeScript tests: **477 passed**.
- Rust format and lint checks pass; Rust unit/doc tests: **46 passed**.
- Real Rust-binary integration tests: **10 passed**.
- The first recursive TypeScript run exposed a timing-sensitive test that used a
  50ms timeout during child-process initialization; the test now gives
  initialization a 1000ms budget and delays only the tool result, then passes in
  both focused and recursive runs.

## 2026-09-13 (Day plan v31: preserve MCP tool failure details)

Executed `docs/day-plan-v31.md`. MCP tool failures carried a useful explanation
in the server's `content` blocks, but the client discarded it and exposed only a
generic error to the caller and model.

### Fixed: MCP tool failure reasons survive the client boundary
- `McpStdioClient.callTool()` now collects every `type: "text"` block from an
  `isError` result in order and throws `McpRequestError(-32603, ...)` with the
  server-provided explanation.
- Details are capped at 2000 characters and marked as truncated; empty or
  non-text error results retain the existing generic message.
- The JSON-RPC error classification, successful results, `structuredContent`,
  and request options are unchanged.

### Tests
- Added coverage for descriptive, multi-block, empty, and oversized MCP tool
  failures. TypeScript: 465 tests; Rust: 46; real-binary integration: 10.

## 2026-09-12 (Day plan v30: same-name rename is not a missing session)

Executed `docs/day-plan-v30.md`. Renaming a session to the name it already had
was reported as a missing session.

### Fixed: "no change" and "does not exist" are told apart
- CLI: `--session-rename a a` answered `Session a not found.` even though
  `a.json` was on disk, because the rename only ran when the names differed and
  the unchanged `renamed` flag fell into the not-found branch. It now answers
  `Session a already has that name.` when the session exists, and keeps
  reporting `not found` (exit 1) when it genuinely does not. `--json` still
  emits `{ from, to, renamed: false }`.
- Desktop: `POST /api/sessions/<id>/rename` answered
  `200 { renamed: false }` for both an existing no-op and an unknown session.
  It now answers `200 { renamed: false }` for the former and `404 unknown
  session` for the latter.
- Unchanged: overwriting an existing target is still `409`, a real move is still
  `200 { renamed: true }`, and a missing source with a different target is still
  `404`.

### Tests
- TypeScript: 457 -> 461 (cli: same-name exists / same-name missing; desktop:
  same-name exists / same-name missing). Rust: 46; real-binary integration: 10.

## 2026-09-12 (Day plan v29: bad cwd is not a bad command)

Executed `docs/day-plan-v29.md`. With an invalid working directory every tool
blamed its own command, sending the model after the wrong problem.

### Fixed: `cwd` is validated before anything is spawned
- Measured with a nonexistent `workingDirectory`: `shell` answered
  `spawn echo ENOENT`, `git` answered `spawn git ENOENT`, and `search` answered
  `spawn rg ENOENT` — but all three binaries are installed. Node reports the
  command name (`error.path` included) when the cwd is what is missing, so the
  caller cannot tell which one to fix. A model reading that would go hunting for
  PATH problems or swap the command instead of fixing the path.
- `assertWorkingDirectory()` now runs before `LocalExecutor` spawns and before
  `RustExecutor` sends its request, so both paths answer
  `working directory does not exist: <path>`, or
  `working directory is not a directory: <path>` when a file is passed.
- The check runs per call rather than being cached, so a directory deleted
  mid-session is reported on the next invocation.
- Unchanged: a valid cwd with a genuinely missing command still reports the
  command.

### Tests
- TypeScript: 453 -> 457. Rust: 46; real-binary integration: 10.

## 2026-09-12 (Day plan v28: bounded SSE buffering)

Executed `docs/day-plan-v28.md`. The desktop server wrote every SSE frame to the
socket without any limit, so a client that stopped reading made the server buffer
without bound.

### Fixed: one stream cannot buffer without limit
- Measured with a stub session emitting 200k token frames and a client that
  connected and immediately stopped reading: 4 seconds later the server's heap
  was **192 MB** with no cap, warning, or recovery. An ordinary HTTP client can
  trigger this, no special access required.
- `emit()` now counts the bytes it writes and, past
  `DEV_AGENT_SSE_MAX_BYTES` (default 32 MiB), sends an `error` frame naming the
  limit, ends the stream, and aborts the run so the producing model/tool stops
  instead of working with nowhere to deliver output.
- The counter is per stream and released when the stream ends; streams within the
  cap behave exactly as before.
- Re-measured with the same flood: heap **17 MB** (was 192 MB), the stream
  reported `stream exceeded 100000 bytes`, and the session received the abort.

### Tests
- TypeScript: 450 -> 453 (flood is cut off and aborted, normal stream unchanged,
  cap is configurable). Rust: 46; real-binary integration: 10.

## 2026-09-12 (Day plan v27: tool timeouts actually stop the work)

Executed `docs/day-plan-v27.md`. A tool timeout reported failure to the model but
left the tool running, so its side effects still landed afterwards.

### Fixed: a timeout now cancels the tool
- `runTool()` raced the tool promise against a timer; on timeout it returned
  `Tool "…" timed out` and dropped the promise, but never aborted the tool.
  Measured with `sh -c "sleep 3; echo ran > marker"` and a 300ms tool timeout:
  the call returned at 304ms and **the marker file appeared 3s later**. So the
  model was told the command failed while it actually completed — a correctness
  problem for any write, deploy, or network call.
- `runTool()` now creates an `AbortController` per call and passes its signal to
  the tool, forwarding the run's own abort signal as well. On timeout it aborts
  first, so `LocalExecutor` kills the child and `RustExecutor` sends a cancel
  envelope. The command is now killed (marker absent, no leftover process).
- The outcome is deterministic: aborting can make the tool settle in the same
  tick, and which side wins a `Promise.race` is a coin flip, so an explicit
  `timedOut` flag decides the reported result regardless.
- Unchanged: the timeout still returns `{"error":"Tool … timed out after …ms"}`
  rather than throwing, and outer-abort propagation still reaches tools.

### Tests
- TypeScript: 446 -> 450. Rust: 46; real-binary integration: 10.

## 2026-09-12 (Day plan v26: symlink-aware write boundary)

Executed `docs/day-plan-v26.md`. The approval policy's "write outside the working
directory" check compared paths as strings, so a symlink inside the workspace
defeated it entirely -- the policy exists to prevent exactly that write.

### Fixed: the boundary check resolves symlinks
- With a workspace symlink `link.txt` -> `/outside/secret.txt`, a
  `filesystem write` was **allowed** and overwrote the outside file.
  A directory symlink behaved the same way: `write` and `mkdir` through it
  created entries outside the workspace.
- `outsideWorkingDirectoryWrite()` now requires both the string comparison and a
  real-path comparison to pass. The workspace is resolved with `realpath`, and
  the target is resolved through its deepest existing ancestor with the missing
  tail appended, so creating a new file (`write`) or directory (`mkdir`) is
  covered too.
- A denial names both the requested path and the resolved real path.
- A symlink that stays inside the workspace is still allowed, and an ordinary
  in-workspace write is unchanged.
- When the workspace itself does not exist the check falls back to the string
  comparison -- nothing inside it can be a symlink yet, and refusing would
  block legitimate writes (the first full-suite run caught three such
  fixtures).

### Tests
- TypeScript: 441 -> 446 (outside file link, outside dir link for write and
  mkdir, missing-parent case, inside link, ordinary writes). Rust: 46;
  real-binary integration: 10.

## 2026-09-12 (Day plan v25: no permanently wedged sandbox)

Executed `docs/day-plan-v25.md`. `RustExecutor` had no client-side timeout, so a
runtime that accepted a request and then never answered took the sandbox down
permanently.

### Fixed: a wedged runtime is abandoned and replaced
- `run(..., { timeoutMs: 400 })` against a wedged-but-alive runtime was still
  pending after 3s: `timeoutMs` is forwarded to the runtime, which is exactly
  what is stuck, so nothing enforced it on the client.
- Worse, each hung request kept its `pending` entry forever. With
  `maxConcurrentExecutions: 2`, two hung requests made every later call answer
  `Concurrent execution limit reached (2)` — the process lost sandbox
  capability until restart.
- New `RustExecutorOptions.requestTimeoutMs` (default 60000, `0` disables) is
  the client backstop. When the caller passes `timeoutMs`, the backstop is
  `timeoutMs + 5s` so the runtime's own timeout normally answers first.
- On backstop the pending entry is dropped (freeing the slot), the call rejects
  with `Rust executor did not answer "<command>" within <n>ms; restarting the
  runtime`, and the runtime process is replaced — necessary because the stdio
  binary handles one envelope at a time, so anything queued behind a stuck
  request could never run.
- Unchanged: a runtime that crashes still rejects everything via the exit
  handler, and `requestTimeoutMs: 0` keeps the previous unbounded behaviour.

### Fixed (test infrastructure)
- The executor's `test` script listed its unit test files explicitly (to keep
  the integration test out), so a newly added test file was not run by
  `pnpm test` — the unchanged total was the only signal. The integration test
  is now `real-rust-integration.integration.ts` (compiled to
  `*.integration.js`, outside the `*.test.js` glob) and the unit suite is back
  to `node --test tests-dist/*.test.js`, so new tests cannot be missed again.

### Tests
- TypeScript: 437 -> 441. Rust: 46; real-binary integration: 10.

## 2026-09-12 (Day plan v24: MCP requests time out)

Executed `docs/day-plan-v24.md`. MCP requests had no timeout, so one server that
accepted the connection and then stayed silent froze the whole CLI.

### Fixed: a silent MCP server fails fast
- `connect()` awaited `initialize` with no timeout: measured 3s and still
  pending. `dev-agent --tools` with such a server stayed alive after 6s with
  empty stdout and stderr — no output, no error, no exit.
- `McpStdioClient.request()` now enforces `McpClientConfig.timeoutMs` (default
  30s, overridable with `DEV_AGENT_MCP_TIMEOUT_MS` or a per-server `timeoutMs`).
  On timeout it removes the pending entry and rejects with
  `McpRequestError(-32000, 'MCP request "<method>" timed out after <n>ms')`, so
  the failing step is named.
- `connect()` closes the child before rethrowing: otherwise the half-open
  connection kept the spawned process alive, so the error printed but the
  process never exited.
- Unchanged: a server whose command does not exist still exits 1 with the spawn
  error, and slow-but-in-time responses still succeed.

### Fixed (tests)
- The v20 interactive test signalled `SIGINT` after a fixed sleep, which raced
  the CLI's handler installation under load (process died by signal, `code:
  null`, instead of 130). It now waits for the banner, which is printed in the
  same synchronous block that installs the handler.

### Tests
- TypeScript: 432 -> 437 (mcp: request timeout, pending cleanup, connect
  timeout, slow-but-in-time; cli: silent server fails fast). Rust: 46;
  real-binary integration: 10.

## 2026-09-12 (Day plan v23: unique MCP prefixes)

Executed `docs/day-plan-v23.md`. MCP tool names are `<prefix>:<name>` registered
into a Map, and the prefix was `config.name ?? "mcp"` -- so two servers sharing a
prefix silently erased each other's tools.

### Fixed: every MCP server gets its own prefix
- Configuring the same fixture server twice (five MCP tools each) registered
  five tools instead of ten, with no warning; two servers both named `files`
  collided the same way.
- New `assignMcpPrefixes()` runs before anything is registered: a single unnamed
  server keeps `mcp` (no behaviour change), several unnamed servers become
  `mcp-1`, `mcp-2`, ... in config order, and a repeated explicit name gets a
  numeric suffix (`files`, `files-2`, `files-3`).
- `McpServerSession.prefix` keeps its own semantics; the disambiguation lives in
  the CLI wiring so the library's other callers are unaffected.

### Tests
- TypeScript: 429 -> 432 (two-unnamed, duplicate-name, single-unnamed
  regression). Rust: 46; real-binary integration: 10.

## 2026-09-12 (Day plan v22: no MCP resource truncation)

Executed `docs/day-plan-v22.md`. `resources/read` may answer with several
content blocks -- a directory read, or text plus a blob -- and the client
silently kept only the first one.

### Fixed: every resource content block reaches the caller
- `McpStdioClient` returned `contents[0] ?? { uri }`, so a resource answering
  with three blocks lost two of them with no error. Measured against a stub
  server returning FIRST/SECOND/THIRD: `readResource()` produced `FIRST-PART`
  and nothing else.
- Added `readResourceContents(uri)` to the `McpClient` interface and the stdio
  client: it returns every block in order. `readResource(uri)` stays as the
  documented single-block convenience wrapper for compatibility.
- The CLI's `<prefix>:resource` tool now returns all blocks, so the model sees
  the whole resource instead of the first slice.

### Tests
- TypeScript: 425 -> 429 (mcp: single/multi/empty answers; cli: an end-to-end
  turn where the model receives FIRST, SECOND, and THIRD). Rust: 46;
  real-binary integration: 10.

## 2026-09-12 (Day plan v21: stop a running desktop chat)

Executed `docs/day-plan-v21.md`. The server could already abort a run -- a
dropped connection did it -- but the UI gave the user no way to trigger it:
after sending, the input locked until the model or a tool finished.

### Added: explicit cancel
- `POST /api/chat/cancel` with `{ sessionId }` aborts the session's in-flight
  run through the existing `AbortController`. It answers
  `{ sessionId, cancelled: true }`; the aborted stream still closes with
  `done { "status": "aborted" }`. Cancelling an idle session answers
  `cancelled: false` instead of erroring, so the button is idempotent.
- The server now keeps one `AbortController` per running session (next to the
  existing `inFlight` set); `streamChat()` uses the caller's controller, so
  disconnect and cancel share one path.
- The header gained a `Stop` button, enabled only while a run is in flight.
- The `done` frame's status is no longer overwritten by the send handler's
  `finally`: a cancelled run reads `aborted`, not `idle`.

### Verified
- Browser check against a provider that hangs: during the run the status read
  `streaming` with `Stop` enabled; after clicking it the status read `aborted`,
  `Stop` disabled, no late assistant text appeared, and the session file held
  only the user entry (re-checked 8s later).

### Tests
- TypeScript: 421 -> 425. Rust: 46; real-binary integration: 10.

## 2026-09-12 (Day plan v20: the interactive session loop)

Executed `docs/day-plan-v20.md`. The interactive CLI (no `--once`) was three
separate bugs wearing one trench coat, and the README claimed the opposite.

### Fixed: interactive mode is a session loop
- `interactive()` never kept the context returned by `runPrompt()`, so every
  prompt restarted at `turns=1` and `[usage]` reported only that prompt
  (`15/15/15` where the totals should have been `15/30/45`). Both now
  accumulate across the session.
- `Ctrl-C` during a run only printed `(interrupted)` and left the model request
  in flight. It now aborts through the same `AbortSignal` path the loop and
  executors already support, and the process exits with status `130` -- 19ms
  against a provider that hangs instead of waiting for it.
- `Ctrl-C` while idle at the `>` prompt also only printed a line and never
  exited. Closing the readline interface does not settle a pending
  `question()`, so the loop now races the prompt against an explicit interrupt
  promise.
- Unchanged: an interrupt is not a failure (the session keeps its prior state),
  and `exit` / `quit` still leaves with status `0`.

### Tests
- TypeScript: 418 -> 421. Rust: 46; real-binary integration: 10.

## 2026-09-12 (Day plan v19: editor-style line counts)

Executed `docs/day-plan-v19.md`. `filesystem read` reported the wrong file
length for the most common file shape, and the model pages with that number.

### Fixed: `read` line semantics
- A trailing newline used to add a phantom line: `"one\ntwo\nthree\n"` answered
  `totalLines: 4`, so a model paging through a file was always one line ahead of
  the end. Line splitting now treats a trailing newline as a terminator
  (`"a\n"` -> 1 line, `"\n"` -> 1 line, `""` -> 0 lines, `"a\n\n"` -> 2 lines),
  and `lines.join("\n")` still reproduces the source.
- An `offset` past the end answered an inverted range (`startLine: 99`,
  `endLine: 98` on a three-line file). It now pins the empty range to the file:
  `startLine: totalLines + 1`, `endLine: totalLines`.
- Unchanged: `offset`/`limit` must still be positive integers, and `truncated`
  keeps its meaning.

### Tests
- TypeScript: 413 -> 418. Rust: 46; real-binary integration: 10.

## 2026-09-12 (Day plan v18: strict CLI arguments)

Executed `docs/day-plan-v18.md`. A mistyped flag used to do the wrong thing
quietly, which is the worst failure mode for a CLI that scripts and CI drive.

### Fixed: unknown and malformed arguments are rejected
- `validateCliArgs()` declares every flag and how many values it consumes, and
  runs before anything else in `main()`.
- Unknown flag: `--nope` exited `0` and dropped into interactive mode; it now
  exits `1` with `Unknown option '--nope'.`
- Swallowed value: `--session --once hi` consumed `--once` as the session id and
  wrote `once.json`; a value may no longer start with `-`, so this exits `1`.
- Flag as prompt: `--once --json` sent the literal string `--json` to the model;
  it now exits `1` with `--once requires a value.`
- Stray positional: `dev-agent hello` silently started interactive mode; it now
  exits `1` with `Unexpected argument 'hello'.`
- Valid input is unchanged, including the optional values for `--compact` and
  `--check-rust` and the `-v` short flag.

### Tests
- TypeScript: 407 -> 413. Rust: 46; real-binary integration: 10.

## 2026-09-12 (Day plan v17: TypeScript-first test suite)

Executed `docs/day-plan-v17.md`. The test suite moved from hand-written ESM
JavaScript to TypeScript, so the repository is TypeScript-first end to end —
including the tests.

### Changed: tests are TypeScript now
- Every `tests/*.test.mjs` became `tests/*.test.ts` (73 files across
  `apps/cli`, `apps/desktop`, and the six packages), preserving git history.
- Each workspace gained a `tsconfig.test.json`: `rootDir: tests`,
  `outDir: tests-dist`, declarations/source maps off, and `strict` relaxed for
  test ergonomics. The `test` script compiles that config and then runs
  `node --test tests-dist/*.test.js`, so the Node test runner and the
  zero-extra-dependency policy are unchanged.
- `tests-dist/` is git-ignored, like `dist/`.
- Three fixtures stay `.mjs` because they are spawned as child processes:
  `fake-mcp-server`, `flaky-mcp-server`, and `mock-executor-binary`.
- README documents the two-step test pipeline.

### Removed
- `.gitattributes` no longer excludes `tests/**` and `scripts/**` from GitHub
  Linguist. That exclusion existed only because the tests were JavaScript files
  that out-weighed the TypeScript sources; with the tests in TypeScript it
  would under-count the real language. GitHub now reports TypeScript at about
  83.8% (was 38.1%), with JavaScript down to about 3.1% (was 48.8%).

### Tests
- TypeScript: 407 tests, still all passing after the migration; Rust: 46;
  real-binary integration: 10.

## 2026-09-12 (Day plan v16: recoverable tool errors, readable code-search positions)

Executed `docs/day-plan-v16.md`. Two failure paths made the agent unable to
help itself: a thrown tool error ended the whole run, and an out-of-range
`code-search` position surfaced a TypeScript debug failure.

### Fixed: tool errors are reported back to the model
- `AgentLoop` runs tools through a new `runToolSafely()`: an exception (including
  `Tool not found: X`) is written back as `{"error": "…"}` in that tool's
  result and the loop continues, so the model can correct its arguments or pick
  another tool. An abort still propagates, and `maxTurns` bounds a model that
  keeps calling a failing tool.
- Reproduction: a tool that threw `bad path` used to end after one model call
  with `status: "error"`; now the model gets a second turn and can finish.

### Fixed: `code-search` validates line and column
- `references`/`definition` used to hand the position straight to the TypeScript
  language service, so `line: 99` on a one-line file produced
  `Debug Failure. Bad line number` (and `line: 0` did the same).
- The requested position is now checked against the scanned source (and line and
  column must be >= 1), answering `code-search line 99 is beyond the end of …`
  or `… column 999 is beyond the end of line 1 …` instead.

### Tests
- TypeScript: 403 -> 407. Rust: 46 (unchanged).
- New coverage: missing tool recovered by the model, a throwing tool recovered
  by the model, a permanently failing tool stopped by `maxTurns`, and both
  out-of-range position cases.

## 2026-09-12 (Day plan v15: MCP reconnect state, sharper approval keys)

Executed `docs/day-plan-v15.md`. Two subtle states were wrong: a reconnected MCP
client kept its closed flag, and "always allow" collapsed `npm run test` and
`npm run build` onto the same key.

### Fixed: MCP client reconnect resets its closed flag
- `close()` sets `closed = true`; `connect()` never cleared it, so after
  `client.reconnect()` a later server crash skipped `rejectAll` and any pending
  request hung forever instead of failing. `connect()` now resets `closed` and
  the line buffer.
- The fake MCP server gained a `crash` tool that exits without answering, and a
  regression test races the call against a 2s timeout. Removing the fix makes
  that test fail with `expected a rejection, got timeout`.

### Fixed: the always-allow key keeps two leading arguments
- `normalizeApprovalKey()` used the first non-flag token only, so `npm run test`
  became `npm run` and approving it silently covered `npm run build` /
  `npm run deploy`; `git -C /repo status` similarly covered other git
  subcommands in that directory.
- The key is now the command plus up to two leading non-flag tokens. Existing
  equivalences still hold (`npm test` / `npm test -- --watch`,
  `git status` / `git status --short`,
  `chmod 777 x` / `chmod -R 777 x`), while different scripts and different
  `-C` subcommands stay separate.

### Tests
- TypeScript: 401 -> 403. Rust: 46 (unchanged).
- New coverage: MCP reconnect followed by a crashing server, and the
  two-argument approval key (npm scripts, `git -C`, `chmod` with/without `-R`).

## 2026-09-12 (Day plan v14: literal search, git exec options, corrupt metadata)

Executed `docs/day-plan-v14.md`. Three holes found by driving the tools rather
than reading them: the search query was parsed as ripgrep options, git could
spawn a shell through its own options without an approval, and `--metadata`
presented a corrupt session file as an empty one.

### Fixed: the `search` tool treats the query as a literal pattern
- `SearchTool` now passes `--` before the query, so `--files`, `--version`, or
  `--pre=…` are searched for instead of being interpreted by ripgrep. Before the
  change `--files` listed the directory and `--version` printed ripgrep's
  version; both looked like a successful search to the model.

### Fixed: git options that execute another process need approval
- `denyDangerousPolicy` gained a "git command execution" pattern covering `-c`
  (including `-calias…`), `--config-env`, `--exec-path`, `--upload-pack`, and
  `--receive-pack`. Reproduction: `git -c alias.probe=!echo injected-command-ran
  probe` printed `injected-command-ran` through the git tool while the policy
  reported nothing. Plain `git status` / `git log` / `git push origin main`
  stay allowed, and `approval.allow` still takes precedence.

### Fixed: `--metadata` explains a corrupt session file
- A file that exists but cannot be parsed now exits 1 with the path and
  `--reset-memory` / `--session-delete <id>` recovery hints instead of printing
  `No session metadata found.`; `--json` returns `{ error, path }`. A genuinely
  absent file, and a valid file that simply has no metadata, keep the old
  exit-0 behaviour.

### Tests
- TypeScript: 395 -> 401. Rust: 46 (unchanged).
- New coverage: literal `--files` / `-f` search queries, the git execution
  pattern plus its allowlist exemption, and the corrupt/missing/valid-but-empty
  `--metadata` cases.

## 2026-09-11 (Day plan v13: pattern coverage, async Python, depth-safe index)

Executed `docs/day-plan-v13.md`. All three fixes came from probing the running
code rather than reading it: the approval table missed long-option `rm` and
short force pushes, the Python scanner ignored `async def`, and a narrow
`code-search` call deleted deeper entries from the shared index.

### Fixed: the dangerous-command table matches both spellings
- `rm --recursive --force` was allowed while `rm -rf` was denied. The
  "recursive delete" pattern now accepts long and short recursion flags, uses a
  token boundary so `rm file-r.txt` is not a false positive, and still allows
  `rm --force file` because it is not recursive.
- `git push -f` and `git push origin +main` were allowed while
  `git push --force` was denied. The "force push" pattern now covers `-f`,
  `--force`, `--force-with-lease`, `--force-if-includes`, and `+refspec`;
  `git push --follow-tags` and branch names containing `-f` stay allowed.

### Fixed: the Python scanner sees `async def`
- Top-level `async def` becomes a `function`, class-level and decorated
  `async def` become `method` symbols with their class as `containerName`.
  `await some_call(...)` is not mistaken for a declaration.

### Fixed: a narrow `code-search` no longer prunes deeper index entries
- Reproduction: an index holding `shallow.ts` and `deep/nested/deep.ts` lost the
  deep file after a `maxDepth: 1` search, which rewrote the shared index.
- A loaded index is now restricted to the requested depth for that scan, and the
  write-back merges with the on-disk index: entries outside the scanned depth
  survive untouched, while a deep file that really is gone is still removed by a
  scan that covers its depth.

### Fixed: a disconnect drops a pending desktop approval
- When the SSE client went away while an `ask` prompt was open, the pending
  approval stayed in the server's map until the 120s timeout fired. The prompt
  is now settled as a denial and removed as soon as the request's abort signal
  fires, and the endpoint answers `404` for that id afterwards.

### Tests
- TypeScript: 389 -> 395. Rust: 46 (unchanged).
- New coverage: long-option `rm`, `-f`/`+refspec` pushes and their look-alike
  false positives, async Python functions and methods, and both directions of
  the depth-safe index write-back, plus a client-disconnect approval cleanup
  case.

## 2026-09-11 (Day plan v12: multi-language search, cache writes, config doctor)

Executed `docs/day-plan-v12.md`. These gaps only showed up once the pieces were
exercised end to end: the shared index silently lost Python/Rust entries, the
Rust scanner ignored `pub`, Anthropic cache writes were priced as plain input,
and a malformed config file failed without saying so.

### Fixed: `code-search` and `--index` now share one scope
- Reproduction: `--index` reported `files: 3, symbols: 2` for a TS/Python/Rust
  project, then `code-search` loaded the index (`loadedFromDisk: 1`) but
  returned zero hits for the Python/Rust symbols and rewrote the file with
  `rescanned: 2, persisted: 1` — the entries were pruned as "deleted".
- `code-search` now scans the same set as `--index`: `.ts`/`.tsx`/`.mts`/`.cts`,
  `.js`/`.jsx`/`.mjs`/`.cjs`, `.py`, `.rs`, depth 8, skipping
  `node_modules`/`dist`/`.git`/`.next`/`.cache`/`.dev-agent`. Symbol search
  covers all four languages; `references` and `definition` deliberately keep
  handing only TS/JS sources to the TypeScript language service.
- End-to-end check after the fix: `--index` 3 files / 3 symbols, one hit per
  language, `rescanned: 0, persisted: 0`.

### Fixed: the Rust scanner understands real Rust
- Visibility (`pub`, `pub(crate)`, `pub(in path)`) and item modifiers (`async`,
  `unsafe`, `const`, `default`, `extern "C"`) are stripped before matching, so
  `pub fn`/`pub struct`/`pub enum`/`pub type`/`pub mod`/`pub use` all produce
  symbols.
- `trait` becomes an `interface` symbol; functions inside `impl`/`trait` blocks
  are `method` symbols carrying `containerName`; `impl<T> Foo<T>` and
  `impl Trait for Foo` resolve to `Foo`; one-line `impl` blocks do not leak a
  container into the lines that follow.

### Added: Anthropic cache-write accounting and pricing
- `ChatUsage.cacheCreationPromptTokens` records Anthropic's
  `cache_creation_input_tokens` (inside `promptTokens`); streamed output-only
  deltas no longer risk double counting. `addUsage` keeps it in session totals.
- `ModelPrice.cacheCreationInputPerMillion` prices those tokens; prompt cost is
  now split into plain input, cache reads, and cache writes, each falling back
  to the input price when its own price is unset, with both cache buckets
  clamped to `promptTokens`.

### Added: `--doctor` validates the shared config
- The report gained a `config` check: a missing file is `ok` (defaults are
  used), a valid object is `ok` and lists the recognised sections, and invalid
  JSON, a non-object, or an unreadable file is a `warn` with the reason — the
  runtime readers still ignore it, but the user is no longer left guessing.

### Tests
- TypeScript: 379 -> 389. Rust: 46 (unchanged).
- New coverage: multi-language index round-trip (search + no pruning, with and
  without a persisted index), Rust visibility/modifier/trait/impl-method
  scanning, cache-write pricing with fallback, and the three config states in
  `--doctor`.

## 2026-09-11 (Day plan v11: MCP approvals, cache accounting, index repair)

Executed `docs/day-plan-v11.md`. Three boundaries that were still half-open:
MCP server mode bypassed the approval policy entirely, provider cache hits were
discarded before accounting, and a corrupt index file stayed broken forever.

### Added: `--mcp-server` obeys the approval policy
- The MCP branch now loads `~/.dev-agent/config.json`, resolves
  `--approval` / `approvalMode`, and runs every tool call through
  `denyDangerousPolicy` (built-in patterns plus `approval.deny`, with
  `approval.allow` exemptions).
- A denied call throws `[denied by approval policy] …`, which the MCP server
  returns as `{ isError: true }` with the reason, so the host model can adapt.
  MCP has no prompt channel, so `ask` behaves like `deny-dangerous` there.

### Added: cached prompt tokens are accounted for and priced
- `ChatUsage.cachedPromptTokens` records the cached part of the prompt. OpenAI
  maps `prompt_tokens_details.cached_tokens`; Anthropic maps
  `cache_read_input_tokens` and counts `cache_creation_input_tokens` as prompt
  tokens too (only the event carrying `input_tokens` contributes them, so a
  stream's output-only delta cannot double count). The field stays absent when
  a response reports no cache hits.
- `ModelPrice.cachedInputPerMillion` optionally prices that part at a discount;
  without it cached tokens use the regular input price. Cached counts are
  clamped to `promptTokens`, and `addUsage` carries them into session totals.

### Fixed: a corrupt persisted index is rewritten
- `code-search` already refreshed an index it had loaded; now, when the file
  exists but cannot be parsed (bad JSON, wrong version, missing fields), the
  full scan that follows replaces it with a valid
  `{ version, files, symbols, signatures }`. A missing index is still never
  created by a search, and a failed write is still ignored.

### Tests
- TypeScript: 368 -> 379. Rust: 46 (unchanged).
- New coverage: MCP gating (deny, allow, config allowlist), OpenAI/Anthropic
  cache parsing including a streaming no-double-count case, cache-aware pricing
  and its fallback/clamp paths, cached-token accumulation, and corrupt-index
  replacement.

## 2026-09-11 (Day plan v10: incremental indexing, session usage, rename UI)

Executed `docs/day-plan-v10.md`. This pass closes the loops v9 left open: the
symbol index refreshes itself instead of only being read back, token usage
survives the process that produced it, and the desktop exposes the session
rename API it already had.

### Changed: `--index` reuses unchanged files
- `indexDirectory` stats the tree first and loads the previous
  `.dev-agent/index.json`; files whose mtime/size signature still matches keep
  their stored sources and symbols instead of being re-read, changed or new
  files are rescanned, and deleted files drop out. First runs and malformed
  indexes still do a full scan.
- `IndexReport` gained `reused`; the human output reads
  `Indexed N files / M symbols (K reused)` and `--json` carries the field.

### Added: `code-search` writes refreshed scans back
- When a scan that started from `<root>/.dev-agent/index.json` finds changed or
  deleted files, the tool rewrites the refreshed
  `{ version, files, symbols, signatures }` to that file. It only touches an
  index that already exists, and a failed write never fails the search.
- `getCacheStats()` gained `persisted`; `InMemoryCodeIndex` gained
  `listSymbols()` for the write-back.

### Added: session token usage survives a restart
- `AgentMemory.recordUsage()` is awaited for every provider usage report.
  `InMemoryMemory` accumulates it in process; `FileMemory` merges it into the
  session file as `metadata.usage` (and `addUsage` moved to `usage.ts` so both
  paths share the arithmetic).
- CLI `--metadata` prints `Usage: prompt=… completion=… total=…`, and
  `--session-list --json` includes each session's `usage` (`null` when absent).
- Desktop `GET /api/sessions` returns `usage` plus a `cost` estimate made with
  the current model and `pricing` table; the chat header restores both when a
  session is switched or the page is reloaded.

### Added: desktop session rename control
- The picker gained a `Rename` button that prompts for a new id and calls the
  existing `POST /api/sessions/<id>/rename`, then reloads the list and history;
  conflicts and failures surface in the status line.

### Tests
- TypeScript: 359 -> 368. Rust: 46 (unchanged).
- New coverage: index reuse and `reused` reporting, code-search write-back
  (changed scan, unchanged no-write, no index created, failed write tolerated),
  usage accumulation in both memory implementations and through a full agent
  run, CLI metadata usage output, desktop session summaries with usage/cost,
  and the served rename control.

## 2026-09-11 (Day plan v9: index reuse, atomic patches, cost estimates)

Executed `docs/day-plan-v9.md`. The theme is making the agent's own bookkeeping
cheaper and more predictable: it reuses the index it already wrote, patches
files in one atomic edit, remembers approvals by intent instead of by exact
argument list, and can price the tokens it spends.

### Added: `code-search` reads back the persisted index
- `--index` now records per-file signatures (mtime + size) next to the symbol
  map in `<path>/.dev-agent/index.json`; the format stays `version: 1`, so
  `JsonFileCodeIndex.load()` keeps working.
- A cold `CodeSearchTool` cache loads that file first and only re-reads files
  whose signature changed, removing files that disappeared. Corrupt or
  version-mismatched files fall back to a full scan silently.
- `getCacheStats()` gained `loadedFromDisk`.

### Added: atomic multi-hunk `filesystem patch`
- `filesystem patch` takes `hunks: [{ oldText, newText }]`, applies them in
  order to an in-memory copy, requires every hunk to match exactly once and not
  overlap an earlier one, and writes the file only after all of them succeed.
  Errors name the failing hunk and the reason; the file stays untouched.
- The approval policy treats `patch` like `write`/`edit`/`mkdir`: targets
  outside the working directory are denied.

### Changed: "always allow" is keyed by command + subcommand
- `normalizeApprovalKey()` derives the key from the command name plus its first
  non-flag token, unwrapping `sh -c "…"` first. `npm test` and
  `npm test -- --watch`, or `git status` and `git status --short`, now share one
  decision; unrelated commands still prompt separately.
- The CLI and desktop session allowlists use the normalized key. The desktop
  `ApprovalPrompt.command` field became `key`.

### Added: usage cost estimation
- `@dev-agent/model` exports `PriceTable` and
  `estimateCost(usage, model, prices)`: the longest model-name prefix wins, and
  unknown models or malformed/negative prices return `undefined` rather than
  guessing.
- `~/.dev-agent/config.json` gained a `pricing` section
  (`{"gpt-4o-mini": {"inputPerMillion": 0.15, "outputPerMillion": 0.6}}`).
  The CLI appends `cost=$…` to `[usage]` and adds a `cost` field to `--json`;
  the desktop's `usage` SSE frame carries `cost` and the chat header accumulates
  it next to the token counter. Unconfigured or unmatched models print no cost,
  exactly as before.

### Tests
- TypeScript: 342 -> 359. Rust: 46 (unchanged).
- New coverage: persisted-index read-back (load, incremental re-read, deletion,
  corrupt fallback), multi-hunk patch (success, atomic failure, overlap,
  validation), normalized approval keys on both surfaces, and cost estimation
  (known model, unknown model, longest prefix, malformed entry) plus the CLI
  `cost=$…` output.

## 2026-09-11 (Day plan v8: editing, indexing, approval memory)

Executed `docs/day-plan-v8.md`. The headline is that the agent can finally
change code the way a coding agent should: by editing a snippet instead of
rewriting whole files.

### Added: unique-snippet editing and line-range reads
- `filesystem edit` replaces `oldText` with `newText` only when the snippet
  appears exactly once; a missing match, an ambiguous match, a missing
  `oldText`, or a missing `newText` is an error and the file stays untouched.
  An empty `newText` deletes the snippet.
- `filesystem read` accepts `offset` (1-based) and `limit` (2000 lines by
  default) and answers with `startLine`/`endLine`/`totalLines`/`truncated`, so
  large files can be read in slices.
- The approval policy treats `edit` like `write`: targets outside the working
  directory are denied.

### Added: `--index` symbol index command
- Scans a directory with the same ignore rules as `code-search`
  (`node_modules`, `dist`, `.git`, `.next`, `.cache`, `.dev-agent`) and writes
  `{ version, files, symbols }` to `<path>/.dev-agent/index.json`, a shape
  `JsonFileCodeIndex.load()` can read.
- Reports files, symbols, and a language breakdown; `--json` gives the same as
  an object. `.dev-agent/` is now git-ignored.

### Added: per-session approval memory
- CLI `ask` accepts `a` (or "always") to run a command and remember it for the
  rest of the process; the desktop prompt gained an "Always allow" button that
  posts `decision: "allow-always"`.
- The memory is keyed by the exact command line and lives in memory only; it is
  per session and never written to disk.

### Fixed
- The CLI's own `--index` run created `.dev-agent/index.json` files that were
  not ignored by git; they now are.

### Tests
- TypeScript: 329 -> 342. Rust: 46 (unchanged).
- New coverage: edit success/not-found/ambiguous/delete/validation, read
  pagination and past-the-end offsets, approval denial for out-of-workspace
  edits, the index command (scan, ignores, missing path), and approval memory
  on both the CLI and the desktop.

## 2026-09-11 (Day plan v7: interactive approvals, doctor, session deletion)

Executed `docs/day-plan-v7.md`, closing the approval boundary v6 left open and
adding the operational tooling that was missing for real use.

### Added: interactive approval prompts in the desktop UI
- `ChatSession.run` accepts a `requestApproval` callback; with `ask` it confirms
  flagged calls instead of denying them outright, and still denies when no
  requester is available.
- The server tracks pending approvals, emits `approval-request` over SSE, and
  answers `POST /api/approval`; unanswered prompts are denied after
  `DEV_AGENT_APPROVAL_TIMEOUT_MS` (default 120s).
- The chat UI renders Allow/Deny buttons and shows the resulting decision.

### Added: `dev-agent --doctor`
- Checks Node (>=20), `rg`, `protoc` (warn only), the Rust runtime binary
  (missing or failing health check is a failure; unconfigured is a warning),
  the provider API key, and whether the session directory is writable.
- `--doctor --json` prints `{ checks, summary }` and the process exits 1 when
  any check fails. The runtime health probe is shared with `--check-rust`.

### Added: session deletion
- CLI `--session-delete <id>` removes `<sessionDir>/<id>.json` and reports
  `{ sessionId, deleted }` with `--json`; a missing session is not an error.
- Desktop `DELETE /api/sessions/<id>` removes the file and forgets the session
  (404 when unknown), with a Delete button in the session picker.

### Tests
- TypeScript: 304 -> 315. Rust: 46 (unchanged this plan).
- New coverage: interactive approval (deny, allow, timeout), doctor checks
  (healthy, missing key, missing binary, JSON round trip), and session deletion
  on both surfaces.

### Fixed
- `streamChat` referenced a closure variable it could not see, which only
  surfaced once the desktop approval tests ran against a fresh build.
- Desktop tests bound the shared default port 4317; they now use port 0 so test
  files can run in parallel.

## 2026-09-11 (Day plan v6: approval policies, persistent digests, MCP resources)

Executed `docs/day-plan-v6.md`. The main line is a command-approval layer: the
sandbox decides how a command runs, nothing decided whether it should.

### Added: approval policies
- `packages/agent-core/src/approval.ts`: `ApprovalPolicy`, `ApprovalRequest`
  (tool, input, session, working directory), `ApprovalOutcome` (decision plus
  reason), `allowAllPolicy()`, and `denyDangerousPolicy()`.
- The dangerous table covers recursive delete, `sudo`, `mkfs`, `dd of=`, power
  control, force push, pipe-to-shell, `chmod 777`, fork bombs, `git reset
  --hard`/`clean -f`, and privileged containers; extra patterns can be added.
  Filesystem writes outside the working directory are blocked too.
- `AgentLoop` consults the policy before each tool call. A denial is written
  back as that tool's result so the model can adapt, a throwing policy counts as
  a denial, and no policy means every call runs exactly as before.

### Added: CLI `--approval allow|deny-dangerous|ask`
- `--approval` wins over `DEV_AGENT_APPROVAL`, which wins over the config file's
  `approvalMode`; invalid values are rejected (flag) or ignored (env/config).
- `ask` confirms flagged calls with `y/N`, reusing the interactive readline
  interface and falling back to one line of stdin for `--once`. Anything but
  `y`, EOF, or a read failure denies the call.

### Added: desktop approval
- `DEV_AGENT_APPROVAL` and `ChatSessionOptions.approvalMode`. The web UI has no
  approval prompt yet, so `ask` maps to `deny-dangerous` rather than silently
  running the command.
- New `approval` SSE frame `{ tool, decision, reason }`; the chat UI renders a
  `[denied]` line for denials.

### Added: persistent, length-capped context digests
- `AgentMemory` gained optional `getSummary`/`setSummary`. `FileMemory` stores
  the digest alongside the session (optional field, older files still load) and
  `InMemoryMemory` keeps it in process, so a new run reuses it instead of
  summarizing the same history again.
- The digest re-anchors by the id of its last covered entry: when compaction
  removed that entry the digest text is kept while new trims are summarized.
- `summaryMaxChars` (default 2000) caps the digest, and
  `DEV_AGENT_SUMMARY_MAX_CHARS` / `summaryMaxChars` expose it.

### Added: MCP server resources and prompts
- Server mode implements `resources/list`, `resources/read`, `prompts/list`,
  and `prompts/get` and advertises both capabilities.
- `--mcp-server` serves `dev-agent://session` (id, working directory,
  timestamps, memory size), `dev-agent://workspace` (top-level entries),
  `review-changes`, and `explain-codebase` (optional `focus` argument).

### Tests
- TypeScript: 270 -> 297. Rust: 43 (unchanged).
- New coverage: approval policies and their loop integration, CLI mode
  resolution plus three approval round trips, desktop denial over SSE, digest
  reuse/compaction/clamping/persistence, and MCP resources and prompts
  (including the host-script round trip).

## 2026-09-11 (Development plan v5: graceful termination, context summaries)

Executed `docs/night-plan-v5.md`, closing the two boundaries v4 left open:
cancellation went straight to SIGKILL (and could orphan a sandboxed command),
and the context budget dropped old history outright.

### Added: graceful process-group termination
- Commands now run in their own process group — `process_group(0)` in the Rust
  runtime, `detached: true` in the TypeScript `LocalExecutor` — so a termination
  signal reaches the whole tree, including `sandbox-exec`/`bwrap` wrappers.
- Cancellation and timeouts send SIGTERM first and SIGKILL only after a
  two-second grace period; commands that exit on SIGTERM are unaffected, and
  commands that ignore it are still stopped. Output truncation keeps ending
  immediately.
- Non-Unix falls back to killing the single process.

### Added: incremental context summarization
- `contextBudget.summarize` (default off) replaces the
  `[context] N earlier entries omitted` notice with a model-written
  `[summary]` digest. Only newly trimmed entries are summarized, and the digest
  is extended rather than regenerated.
- Summarization tokens count toward the session usage and fire `onUsage`; a
  failed summary falls back to the omission notice and the run continues.
- CLI: `DEV_AGENT_SUMMARIZE_CONTEXT` / `summarizeContext`; desktop:
  `ChatSessionOptions.summarizeContext` with the same env fallback.
- Known boundary: the digest lives on the `AgentLoop` instance, so the desktop
  (which builds a loop per run) regenerates it once per run. Persisting it in
  memory metadata is the follow-up if that cost matters.

### Tests
- TypeScript: 262 -> 270. Rust: 42 -> 43.
- New coverage: SIGTERM-ignoring commands on both executors, summary replacing
  the notice, incremental summarization, summary tokens in usage, summary
  failure fallback, and a CLI round trip where the provider receives the
  `[summary]` message.

## 2026-09-11 (Development plan v4: cancellation, usage, MCP server)

Executed `docs/night-plan-v4.md`, which closed the gaps v3 left behind:
interrupts only stopped at turn boundaries, token usage was invisible, and
dev-agent could consume MCP servers but not act as one.

### Added: cancelling a running tool
- `Envelope` gains `cancel = 5` with `CancelRequest { request_id }`. The
  cancelled run answers `ErrorResult { code: "CANCELLED" }`; the cancel itself
  is not acknowledged separately.
- `dev-agent-executor` now reads envelopes concurrently with running commands
  and tracks a `oneshot` sender per in-flight request id, so a cancel can
  arrive mid-command and kill its child process. This replaces the previous
  strictly-serial execution model.
- `ExecutorRunOptions.signal` aborts a run: `LocalExecutor` kills the child and
  rejects with `ExecutorCancelledError`; `RustExecutor` sends the cancel
  envelope and rejects when the runtime answers `CANCELLED`. `RustExecutor`
  gained the same default concurrency limit as `LocalExecutor` (5).
- The loop forwards its run signal into `ToolExecutionContext.signal`, and
  shell/git/search pass it to the executor, so a disconnect stops the command.
- Fixed two latent `RustExecutor` bugs the new tests exposed: concurrent first
  calls could spawn two runtimes, and `dispose()` left the instance unusable.

### Added: desktop end-to-end coverage
- New e2e suite with a local OpenAI-compatible SSE stub driving a real
  `ChatSession` and `startServer`.
- Disconnecting the client is proven to kill a running command: the tool
  touches a start marker, sleeps, then touches a finish marker that never
  appears.
- `DEV_AGENT_MAX_CONTEXT_CHARS` is verified through the real session, and the
  `usage` SSE event is asserted end to end.

### Added: token-usage accounting
- `ChatUsage { promptTokens, completionTokens, totalTokens }` on
  `ChatCompletion`; all four providers map their own field names, including
  usage from a stream's final event (Anthropic merges `message_start` and
  `message_delta`). Responses without usage stay undefined.
- `AgentLoop` fires `onUsage` per turn and accumulates the session total on
  `AgentContext.usage`, so it survives across runs.
- CLI prints `[usage] prompt=… completion=… total=…`; the desktop emits a
  `usage` SSE event and the UI shows a running token counter.

### Added: MCP server mode
- `createMcpServer({ tools })` speaks newline-delimited JSON-RPC 2.0 over
  stdio: `initialize`, `ping`, `tools/list`, `tools/call`. Tool implementations
  are injected, so `@dev-agent/mcp` keeps no dependency on `@dev-agent/tools`.
- Tool execution failures answer `{ isError: true }` for the host model, while
  unknown tools (-32602) and methods (-32601) are protocol errors.
- `apps/cli --mcp-server` exposes the built-in tool set with no model provider
  and keeps stdout protocol-only.

### Tests
- TypeScript: 237 -> 262. Rust: 39 -> 42.
- New coverage: Rust cancellation (unit + real-binary), LocalExecutor and
  RustExecutor aborts plus the concurrency limit, tool-signal forwarding, the
  desktop interrupt/context-budget/usage e2e suite, per-provider usage parsing,
  and the MCP server unit tests plus a CLI host-script round trip.

## 2026-09-11 (Night plan v3: quotas, context budget, retries, interrupts)

Executed `docs/night-plan-v3.md` end to end. The through-line is making the
sandbox path and long sessions behave under real use rather than only in the
happy path.

### Added: Rust runtime output quota
- `RunRequest.max_output_bytes` (field 7) and `RunResult.bytes_truncated`
  (field 5) extend the protobuf protocol; both are optional/backward compatible,
  and a client that omits the limit gets a 1 MiB default rather than unbounded
  capture.
- The Rust `LocalExecutor` streams stdout/stderr instead of buffering with
  `wait_with_output`, stops at the per-stream limit, kills a child that would
  otherwise block on a full pipe, and reports the truncation.
- `RustExecutor` forwards `maxOutputBytes` (default 1 MiB) and surfaces
  `bytesTruncated` on the result, so the quota that already existed in the
  TypeScript `LocalExecutor` now also applies when the sandbox is enabled.
- The stdio binary is documented as strictly serial: it reads the next envelope
  only after the current command finished.

### Added: Agent context budget
- `AgentLoopOptions.contextBudget.maxChars` bounds the history sent to the
  model. Oldest entries are dropped first, an assistant tool call is never
  separated from its tool results, the system prompt and the newest entry are
  always kept, and a `[context] N earlier entries omitted` system message
  announces the drop. Unset means the full history, exactly as before.
- CLI: `DEV_AGENT_MAX_CONTEXT_CHARS` (over `maxContextChars` in the config file).
- Desktop: `ChatSessionOptions.maxContextChars` with the same env fallback.

### Added: code-search incremental caching
- `InMemoryCodeIndex.removeFile()` (declared on `CodeIndex`) drops a file's
  symbols so a cached index can be updated in place.
- `CodeSearchTool` caches the symbol index, per-file signatures, and sources per
  scan root. A repeated search re-reads only files whose size or mtime changed,
  drops deleted files, and reuses cached sources for `references`/`definition`.
  `getCacheStats()` reports hits/misses/rescanned.
- On this repository a repeated `AgentLoop` symbol search dropped from 261ms to
  65ms with identical results.

### Added: model retry and rate-limit handling
- New `retry` module: 429/5xx and network failures retry with exponential
  backoff and jitter; other 4xx fail immediately; aborts are never retried.
  `Retry-After` is honoured in delta-seconds and HTTP-date form, capped at 2s.
- All four providers share the wrapper, configured via
  `ProviderConfig.retry` (defaults: 2 retries, 250ms base, 2s cap).
- `streamChat` only retries the initial request, so tokens already delivered to
  the caller are never duplicated.

### Added: desktop interrupts and concurrency protection
- `AgentLoop.run` accepts an optional `AbortSignal`, checked before each turn
  and tool call and forwarded to the model request; interruptions are rethrown
  instead of being recorded as a failed turn.
- A client disconnect aborts the run and closes the stream with
  `done { "status": "aborted" }`; a second concurrent `POST /api/chat` is
  rejected with 409 so two runs never interleave one conversation state.
- Documented boundary: an already-running tool call is not killed.

### Tests
- TypeScript: 206 -> 237. Rust: 35 -> 39.
- New coverage: Rust output truncation (unit + real-binary integration), the
  macOS test interpreter discovery, context-budget trimming and CLI wiring,
  code-search cache hits/invalidations, model retry policy, and desktop
  abort/409 behaviour.

## 2026-09-10 (Sandbox network test interpreter discovery)

### Fixed: macOS network tests asserted on the Xcode python3 stub
- `sandbox_executor_denies_network_when_disabled` and
  `sandbox_executor_allows_loopback_network_when_loopback` hardcoded
  `/usr/bin/python3`. On machines without full developer tools that path is a
  stub which shells out to `xcode-select`; the sandbox profiles under test deny
  writes to `/dev/null`, so the stub aborted before Python started and the
  assertions checked the stub's error instead of the network policy. Both tests
  failed locally while passing on CI, where `/usr/bin/python3` is a real
  interpreter.
- The tests now resolve an interpreter by probing candidates outside the
  sandbox: `DEV_AGENT_TEST_PYTHON`, then `python3` from `PATH`, then
  `/usr/bin/python3`, `/opt/homebrew/bin/python3`, and `/usr/local/bin/python3`.
  Candidates that cannot run are skipped, so a broken stub no longer masks the
  behaviour under test.
- With no usable interpreter the two tests skip with an explanatory message
  instead of reporting a failure. The sandbox policy behaviour is unchanged;
  only the interpreter the tests drive it with.

### Tests
- Rust: 33 passed / 2 failed -> 35 passed. Verified both network tests still
  exercise the policy by pointing `DEV_AGENT_TEST_PYTHON` at a nonexistent
  binary and confirming the probe falls through to a working interpreter.

## 2026-09-10 (Release pipeline)

### Added: tag-driven release workflow
- `.github/workflows/release.yml` builds `dev-agent-executor` for
  `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-unknown-linux-gnu`, and
  `aarch64-unknown-linux-gnu`, packages each as `.tar.gz` with a `.sha256`
  checksum, and attaches them to a GitHub Release on a `v*` tag.
- The macOS targets build natively on `macos-latest`; the Linux arm64 target
  cross-compiles on `ubuntu-latest` with `gcc-aarch64-linux-gnu`.
- Manual `workflow_dispatch` runs build and upload the artifacts without
  publishing a release, so the pipeline can be verified without cutting a tag.
- Checksum files record only the archive name, so `shasum -a 256 -c` works next
  to the downloaded files rather than expecting the CI build directory.

Verified end to end: a dispatched run built all four targets and uploaded four
artifacts; the downloaded macOS arm64 archive contained a Mach-O arm64 binary
that answered `--check-rust` with runtime version `0.1.0` and capabilities
`run, run_sandboxed`.

## 2026-09-10 (Config file wiring and sandbox binary selection)

### Fixed: the config file was never read
- `apps/cli/src/config.ts` implemented `parseConfig`/`loadConfig` with unit tests,
  but nothing in the CLI called them: `~/.dev-agent/config.json` had no effect at
  all, despite being documented as supported.
- The CLI now loads it and applies it to provider selection (`defaultProvider` /
  `defaultModel`), the agent turn budget (`maxTurns`), and MCP servers
  (`mcpServers`). Environment variables and CLI flags take precedence, so an
  explicit invocation always overrides a saved preference. A malformed config
  file is ignored rather than fatal.

### Fixed: DEV_AGENT_RUST_BINARY did not reach tool execution
- The variable was only read inside `--check-rust`, so setting it left real tool
  runs on `LocalExecutor` -- the sandbox was silently bypassed. The CLI's own
  error message told users to set it, and the root README pointed at it too.
- `--rust-executor <path>` / `--check-rust <path>` now win, then
  `DEV_AGENT_RUST_BINARY`, and that resolved path is what builds the executor.
  `ChatSession` in the desktop app honours the same variable.

### Docs
- `apps/cli/README.md` gained the missing `--metadata`, `--session-list`,
  `--compact`, `--no-stream`, `--rust-executor`, and `--check-rust` options, the
  `DEV_AGENT_RUST_BINARY` variable, and a configuration-file section describing
  the keys and their precedence.

### Tests
- New `apps/cli/tests/config-file.test.mjs` (3 tests): a config file's
  `defaultProvider` is applied, an environment variable overrides it, and a
  malformed config still lets the CLI run. These point `HOME` at a scratch
  directory so they never touch a developer's real config.
- New `apps/cli/tests/rust-executor-wiring.test.mjs` (2 tests): against a local
  OpenAI-compatible stub, a streamed tool call is executed through
  `RustExecutor` when `DEV_AGENT_RUST_BINARY` is set, and through
  `LocalExecutor` when it is not.
- Config resolver unit tests cover flag/env precedence for the binary path,
  provider, model, and turn budget.
- `apps/cli` tests: 23 -> 33. TypeScript tests: 196 -> 206.

## 2026-09-10 (CLI session directory consistency)

### Fixed: DEV_AGENT_SESSION_DIR only affected listing
- `sessionDir()` honoured `DEV_AGENT_SESSION_DIR` for `--session-list`, but
  `createMemory()` built its path from `homedir()` directly. Setting the variable
  therefore pointed the listing at an empty directory while `--session`,
  `--metadata`, and `--compact` kept reading and writing
  `~/.dev-agent/sessions` -- the CLI's own sessions never appeared in its own
  listing, contradicting the documented behaviour.
- `createMemory()` now resolves through `sessionDir()`, so all four commands use
  the same directory. `DEV_AGENT_MEMORY_FILE` still takes precedence.

### Docs
- `apps/cli/README.md` now documents `DEV_AGENT_SESSION_DIR`, which was
  previously only mentioned in the changelog.

### Tests
- New `apps/cli/tests/session-dir.test.mjs` (3 tests): `--metadata` and
  `--compact` operate on the configured session directory, and
  `DEV_AGENT_MEMORY_FILE` still wins. Tests use a unique session id so a failure
  cannot read or mutate a developer's real sessions.
- `apps/cli` tests: 20 -> 23. TypeScript tests: 193 -> 196.

## 2026-09-10 (Desktop server hardening)

### Fixed: client errors were reported as server errors
- `POST /api/chat` with a malformed or empty JSON body threw out of `JSON.parse`
  and surfaced as a 500. Both cases now return 400 with a clear message, so a bad
  request is no longer indistinguishable from a server fault.
- Static file misses returned 500 as well: requesting a missing `/public/*` asset
  or the directory itself propagated `readFile`'s ENOENT/EISDIR to the catch-all
  handler. `serveFile` now maps unreadable paths to a 404.

### Note on `/public/` path traversal
- The `/public/` handler normalizes the request path through `new URL`, which
  resolves `..` segments before `join`, and `join` does not re-base on absolute
  segments — so the prefix check is not reachable via traversal. Percent-encoded
  parent segments resolve to a literal directory name and now return 404 rather
  than 500. This was verified with tests that send the raw path (fetch normalizes
  `..` client-side, which is why an earlier test passed for the wrong reason).

### Tests
- New `apps/desktop/tests/server-edge-cases.test.mjs` (11 tests): missing static
  assets, directory requests, malformed and empty JSON bodies, non-string
  messages, health content type, streamed `error` events when a session throws,
  encoded and raw parent-segment paths, and successful static serving.
- `apps/desktop` tests: 5 -> 16. TypeScript tests: 182 -> 193.

## 2026-09-10 (Built-in tools hardening)

### Fixed: code-search ignored relative file paths
- `CodeSearchTool` builds its index from absolute paths but passed the `file`
  input through verbatim. A relative path -- what a model naturally emits, e.g.
  `src/agent.ts` -- matched nothing, so `references` silently returned
  `count: 0` and `definition` returned `undefined`, with no error.
- `file` is now resolved against the scanned root (the working directory by
  default), so relative and absolute paths both work.

### Fixed: filesystem write silently discarded non-string content
- `write` accepted any `content` type and coerced non-strings to `undefined`,
  which wrote an empty file. A model sending structured content would silently
  clobber a file instead of getting an error.
- `content` must now be a string when provided; omitting it still writes an
  empty file.

### Tests
- New `packages/tools/tests/tools-edge-cases.test.mjs` (26 tests) covering the
  built-in tools beyond their happy paths: filesystem write/read round-trips,
  `mkdir`, `stat` and input validation; shell and git argument validation and
  the exact command/args/cwd forwarded to the executor; search argument
  construction; and code-search relative paths, kind filtering, `limit`, and
  `node_modules`/`dist` skipping.
- `packages/tools` tests: 10 -> 36. TypeScript tests: 156 -> 182.

## 2026-09-10 (Model streaming hardening)

### Fixed: streaming dropped tool calls, breaking tool use
- The agent loop calls `streamChat` whenever `onToken` is set, and the CLI enables
  token streaming by default. All four providers returned only `{ content }` from
  `streamChat`, so `completion.toolCalls` was always empty: the loop saw zero tool
  calls and ended the turn without ever running a tool. Tool use was effectively
  broken in streaming mode for every provider.
- `streamChat` now surfaces tool calls:
  - OpenAI accumulates `tool_calls` deltas by index (id, name, concatenated
    arguments) and parses the assembled JSON.
  - Anthropic tracks `content_block_start` `tool_use` blocks and concatenates
    `input_json_delta` fragments before parsing.
  - Gemini collects `functionCall` parts from streamed candidates.
  - Ollama collects `message.tool_calls` from each NDJSON chunk (the array was
    declared and returned but never populated).

### Fixed: the final streamed event was dropped
- Every provider kept a partial-line buffer but never flushed it when the stream
  ended, so a final event without a trailing newline was silently lost.
- OpenAI additionally stopped on `[DONE]` only inside the inner line loop, so
  events arriving after `[DONE]` were still parsed; the stream now terminates.

### Tests
- New `packages/model/tests/streaming.test.mjs` (25 tests): token accumulation and
  `onToken`, events split across chunk boundaries, multi-byte characters split
  mid-UTF-8, `[DONE]` termination, trailing-event flush, malformed payloads,
  non-OK and body-less responses, abort-signal forwarding, and streamed tool
  calls for all four providers.
- New `packages/agent-core/tests/streaming-tool-calls.test.mjs`: wires the real
  OpenAI provider (fake `fetch`) into `AgentLoop` and asserts the streamed tool
  call is actually executed. Existing streaming tests used a mock provider that
  returned tool calls directly, which is why they never caught this.
- TypeScript tests: 130 -> 156.

## 2026-09-10 (CI + build hardening)

### Continuous integration (`.github/workflows/ci.yml`)
- Added a GitHub Actions workflow that runs on push to `main`, pull requests, and
  manual dispatch:
  - TypeScript job (ubuntu, Node 26 via `.nvmrc`, pnpm 12.3.4): `pnpm install
    --frozen-lockfile` -> structure check -> build -> typecheck -> test.
  - Rust job (ubuntu, stable toolchain): `cargo fmt --check`, `cargo clippy
    --all-targets -- -D warnings`, `cargo test`.
- Validated the workflow with `actionlint`.
- Added `.nvmrc` pinning Node 26 and a CI status badge in the root README.

### Fixed: root `clean` script caused infinite recursion
- `pnpm clean` is a **built-in pnpm command** (it removes `node_modules`
  directories) and a same-named script in `package.json` overrides it. The root
  `"clean": "pnpm -r clean"` therefore re-entered the root script recursively,
  spawning processes until it was interrupted instead of removing `dist`.
- Root delegating scripts now use the explicit `run` verb
  (`pnpm -r run build|typecheck|test|clean`), which avoids built-in collisions and
  correctly skips the workspace root. Added a root `test` script.

### Build ordering
- Documented and wired the required order on a fresh checkout: `build` before
  `typecheck`/`test`, because workspace packages resolve each other through
  `dist/*.d.ts`, which only exist after a build.

### Rust lint gates
- `cargo fmt --check` is now clean.
- Resolved all `cargo clippy --all-targets -- -D warnings` findings: gated the
  Linux-only `ro_bind_if_exists`/`build_bwrap_args` helpers with
  `#[cfg(any(target_os = "linux", test))]`, switched to `std::io::Error::other`,
  and moved `impl Default for SandboxExecutor` before the test module.

## 2026-09-10 (Night Build v4)

### Network policy enforcement via Starlark (`runtime/rust`)
- Fixed a bug where `ctx.network_policy` exposed the Rust enum Debug output
  (e.g. `"NetworkDisabled"`) instead of the documented lowercase labels
  (`"enabled"`, `"disabled"`, `"loopback"`, `"unspecified"`). This silently broke
  the example policy's `check_network_policy` function. Added a
  `network_policy_label` helper that maps the prost-generated enum to the
  documented lowercase contract.
- Added Starlark-level unit tests for network policy decisions: the policy script
  can now deny network commands (e.g. `curl`, `wget`) when `network_policy ==
  "disabled"` and allow them when `"enabled"`, and the example policy's
  `check_network_policy` function is verified end to end.
- Rust tests: 31 → 35 passing (+4 network policy tests).

### Documentation
- Updated root `README.md` Roadmap to mark items 5–8 as done, consolidated the
  stale "Current Status (v2)" section, and refreshed the Rust runtime progress
  section to reflect the active Linux `bwrap` backend and Starlark network policy.
- Updated `docs/README.md` to reflect the implemented desktop shell, Linux `bwrap`
  backend, and Starlark `ctx.network_policy` contract.

## 2026-09-10 (Night Build v3)

### Desktop shell (`apps/desktop`)
- New `@dev-agent/desktop` package: a local web server with a streaming chat UI.
- `src/server.ts` serves a static HTML chat UI and streams chat responses from
  `POST /api/chat` as Server-Sent Events (`token`, `tool`, `tool-result`, `turn`, `done`, `error`).
- `src/chat-session.ts` builds the `AgentLoop` with the default tools and model
  provider, and bridges its streaming callbacks to SSE events. Reuses
  `@dev-agent/agent-core`, `@dev-agent/model`, `@dev-agent/tools`, `@dev-agent/mcp`,
  and `@dev-agent/executor`.
- Single-page dark/light chat UI in `public/index.html` (vanilla JS, no build step).
- Configurable via env vars (`DEV_AGENT_MODEL_PROVIDER`, `DEV_AGENT_DESKTOP_HOST`,
  `DEV_AGENT_DESKTOP_PORT`, `DEV_AGENT_MEMORY_FILE`). Health check at `GET /health`.
- New HTTP-level tests covering the UI, health, chat SSE stream, and 404 handling.

### CLI streaming and session management hardening
- Agent loop now wires `onToken`, `onToolCall`, `onToolResult` callbacks so tokens
  print live and tool activity is shown with color in interactive and `--once` modes.
- New `--no-stream` flag disables live token output (falls back to printing the final answer).
- New `--session-list` command enumerates saved sessions sorted by recency, showing
  file size and last-modified time. Honors `DEV_AGENT_SESSION_DIR` for the sessions directory.
- New E2E tests for `--session-list` (empty and populated) and `--no-stream`.

### Linux bubblewrap backend (`runtime/rust`)
- `RestrictedExecutor` now has a real `#[cfg(target_os = "linux")]` execution path
  using `bwrap` (bubblewrap) instead of returning `Unsupported`.
- `build_bwrap_args` is a pure function (testable on any host) that constructs the
  bubblewrap argument list: namespace unsharing (`--unshare-user-try`, `--unshare-ipc`,
  `--unshare-pid`, `--unshare-uts`, `--unshare-cgroup-try`), read-only root filesystem
  with per-distro path detection, writable/read-only path bind mounts, network policy
  (`--unshare-net` for disabled/loopback), environment injection (`--setenv`), cwd
  enforcement (`--chdir`), and `--die-with-parent`.
- Resource limits (`setrlimit`) now shared across macOS and Linux backends
  (CPU, FSIZE, NOFILE, NPROC, CORE).
- Linux-only live `bwrap` integration test (skipped when `bwrap` is not installed).
- New unit tests for the argument builder: namespace flags, network policy toggling,
  writable/readonly binds, environment variables.

## 2026-09-10 (Night Build v2)

## 2026-09-14（v57：fresh-checkout verification artifact contract）

- 在隔离 clean checkout 中验证：直接 `pnpm verify:integration` 需要先生成 executor `dist`；
  完整 `pnpm verify` 在没有 Rust binary 时会透明报告 macOS integration **10 skipped**，不把
  它解释为 live coverage；构建 binary 后 warmed workspace 为 **10/10**。
- 修复 release-gate contract 对 `/dev-agent` 绝对目录后缀的假设，改为从测试文件位置解析
  repository root，保证隔离 checkout 的 contract suite 仍为 **12/12**。
- 更新 README、`docs/README.md` 和 architecture 的 artifact 前置条件与 Linux bwrap 状态。
- 决策：**Preserve / NO-GO** 自动把 artifact preparation 复制进固定 gate；macOS hosted job
  继续作为 live sandbox evidence 的权威入口。


## 2026-09-14（v58：release workflow packaging contract）

- 新增 `tests/release-workflow.test.mjs`，覆盖 release workflow 的四 target matrix、Rust
  target/cross linker、release binary build、tar.gz/SHA-256 packaging、artifact upload 与
  tag-only publish 边界。
- 将 release workflow contract 作为 fixed TypeScript gate 的独立 step；focused contract 为
  **2/2**，既有 release-gate contract 为 **12/12**。
- 没有创建 tag、上传 release artifact 或发布 GitHub Release；静态 contract 不替代真实四平台
  release run。

## 2026-09-14（v58 hosted verification）

- 普通 CI run [34810638031](https://github.com/LJH-snow/dev-agent/actions/runs/34810638031) 的
  Rust、TypeScript 和 macOS integration jobs 全部成功；hosted TypeScript release gate 的
  release workflow contract 为 **2/2、0 failures**。

## 2026-09-14（v59：release artifact packaging smoke）

- 按 release workflow 的 Package 规则，在隔离目录对当前 host `aarch64-apple-darwin` 做一次
  single-target smoke：release binary、README、tar.gz、SHA-256 verification 与 executable bit
  均通过。
- 没有创建 tag、上传 artifact 或发布 GitHub Release；单 target smoke 不替代四平台 release。
- 决策：**Preserve / NO-GO** 永久新增 smoke script 或 fixed gate step，保留静态 contract 与
  真实 release candidate 的证据边界。
