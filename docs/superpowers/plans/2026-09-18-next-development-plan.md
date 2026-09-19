# 2026-09-18 下一阶段安全与索引契约实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留当前未提交工作和 v0.1.8 candidate 发布边界的前提下，完成配置读取上限收口，修复 `index.json` 在 `index refresh`、`index status` 与 `code-search` 之间的格式兼容问题，并用证据驱动的审计确定下一轮安全工作。

**Architecture:** 先完成当前工作区已经开始的 Goal 66，再把共享代码索引视为一个跨包 v1 数据契约处理。新写入统一保存 `mtimeMs`、`size`、`ctimeMs`，旧的 `mtimeMs`/`size` 记录继续可读；缺少 `ctimeMs` 时不得在没有内容指纹的情况下错误复用缓存。其余安全审计只在发现可复现缺口后实施，不做投机性重构。

**Tech Stack:** TypeScript 5.9, Node.js 20+, pnpm 12.3.4, Node test runner, Rust runtime release gates, existing `@dev-agent/code-intelligence`, `@dev-agent/tools`, `@agent_cli/cli`, and Desktop contracts.

**Spec:** `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md` and its progress record `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals-progress.md`.

## Global Constraints

- 保留当前工作区中 Goal 66 的用户改动；不得用 reset、checkout 或清理命令覆盖它们。
- 每个行为变更先写最小 RED contract，运行并确认因缺少实现而失败，再写最小 GREEN 实现。
- 索引 v1 兼容旧的 `mtimeMs`/`size` 签名；新写入包含 `ctimeMs`；没有 `ctimeMs` 且没有内容指纹时不得声称缓存命中。
- 不改变公开 CLI 命令名称、退出码、MCP/JSON schema 或 Rust sandbox 权限语义，除非测试和文档同时锁定兼容行为。
- 对外输出不得包含绝对路径、源文件内容、原始错误、凭据或命令参数；索引状态必须是 metadata-only。
- 不新增可配置的读取上限；固定上限沿用现有值：配置文件 `1 MiB`，其他已建立的输入边界按现有契约保持。
- 不实现 Windows backend，不新增没有真实用户触发条件的 Desktop UI，不重做 Evidence、Undo 或 session schema。
- 子代理只能修改其 brief 指定的文件集合；不同子代理不得拥有重叠写入范围；主代理负责最终整合和验证。
- 不创建 tag、不 push、不发布 npm、不创建 GitHub Release、不修改 `~/.npmrc`。
- 最终必须运行覆盖性验证并读取完整结果：`pnpm verify`、`git diff --check`，以及每个变更包的 focused tests。

---

### Task 0: 收口当前 `config validate/show` 读取边界

**Files:**
- Already modified: `apps/cli/src/config-command.ts`
- Already modified: `apps/cli/tests/config-command.test.ts`
- Already modified: `apps/cli/README.md`
- Already modified: `docs/CHANGELOG.md`
- Already modified: `docs/release-candidate-checklist-v0.1.7-desktop.md`
- Already modified: `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`
- Modify: `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals-progress.md`
- Already modified: `tests/documentation-contract.test.mjs`

**Interfaces:**
- `executeConfigCommand(options: ConfigCommandOptions): Promise<ConfigCommandExecution>` returns `config_read_error` and exit code `1` for a file larger than `1 MiB`.
- Missing files continue to use `source: "defaults"`.
- Valid small files, invalid JSON, redaction, and existing CLI JSON output remain unchanged.

- [x] **Step 1: Run the existing RED/GREEN evidence check**

Run:

```sh
pnpm --filter @agent_cli/cli run build
node --test apps/cli/tests-dist/config-command.test.js
node --test tests/documentation-contract.test.mjs
```

Expected: the current implementation and contracts pass; if a test fails, treat
that failure as the blocking state to diagnose before touching unrelated files.

- [x] **Step 2: Review the dirty diff and preserve the existing contract**

Run:

```sh
git diff -- apps/cli/src/config-command.ts apps/cli/tests/config-command.test.ts
git diff --check
```

Confirm that the size check occurs before `readFile`, that diagnostics do not
include the path or bytes, and that the test creates a file larger than
`1024 * 1024` bytes.

- [x] **Step 3: Record the verified progress entry**

Append a `Follow-up Goal 66` completion section to the progress record with the
focused test counts, documentation contract result, and the existing
no-tag/no-push/no-publish boundary. Do not alter the implementation solely to
make the progress record look complete.

---

### Task 1: Unify persisted index signatures across refresh, status, and code-search

**Files:**
- Modify: `packages/code-intelligence/src/index-status.ts`
- Test: `packages/code-intelligence/tests/index-status.test.ts`
- Modify: `packages/tools/src/code-search.ts`
- Test: `packages/tools/tests/code-search-persisted.test.ts`
- Modify: `apps/cli/src/index-command.ts` only if the compatibility tests prove its loader needs a behavior change
- Test: `apps/cli/tests/index-command.test.ts` or `apps/cli/tests/mcp-index-cli.test.ts`
- Modify: `apps/cli/README.md` only for a user-visible compatibility rule
- Modify: `docs/CHANGELOG.md` only for the verified candidate note
- Modify: `docs/release-candidate-checklist-v0.1.7-desktop.md` only for the verified candidate note
- Modify: `docs/superpowers/plans/2026-09-18-next-development-plan.md` to mark task progress
- Modify: `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md` and its progress record only after the implementation is verified

**Interfaces:**
- Persisted v1 signatures accept:

```ts
type PersistedFileSignature = {
  readonly mtimeMs: number;
  readonly size: number;
  readonly ctimeMs?: number;
};
```

- New `code-search` writes include `ctimeMs`.
- `index status` accepts both legacy `{ mtimeMs, size }` and current
  `{ mtimeMs, size, ctimeMs }`, while returning only metadata.
- A legacy signature without `ctimeMs` is reusable only when the caller also
  supplies a matching content fingerprint; otherwise the refresh is a miss and
  re-reads the file.

- [x] **Step 1: Add the failing compatibility tests**

Add tests for these concrete cases:

```ts
test("index status accepts a legacy code-search signature", async () => {
  const status = await getIndexStatus({
    indexPath: "project/.dev-agent/index.json",
    readFile: async () => JSON.stringify({
      version: 1,
      files: { "src/a.ts": "export const a = 1;" },
      symbols: [{ name: "a", kind: "variable", filePath: "src/a.ts", line: 1 }],
      signatures: { "src/a.ts": { mtimeMs: 1, size: 20 } },
    }),
  });
  assert.equal(status.status, "ready");
  assert.equal(status.usable, true);
  assert.equal(status.hasSignatures, true);
});
```

Add a persisted-index test that runs a changed `code-search` scan and asserts
the written signature contains numeric `mtimeMs`, `size`, and `ctimeMs`.
Add a refresh-planner test showing that a legacy signature without `ctimeMs`
does not produce a cache hit when no fingerprint is supplied.

- [x] **Step 2: Run focused tests and confirm RED**

Run:

```sh
pnpm --filter @dev-agent/code-intelligence run build
pnpm --filter @dev-agent/code-intelligence run test
pnpm --filter @dev-agent/tools run build
pnpm --filter @dev-agent/tools run test
```

Expected: the new compatibility tests fail because the status parser rejects
legacy signatures and `code-search` does not yet persist `ctimeMs`.

- [x] **Step 3: Implement the smallest compatible signature model**

Change the shared parser to accept an optional `ctimeMs`. Keep strict numeric
validation for every present field. Make cache-hit comparison follow this
order:

```ts
if (indexed.ctimeMs !== undefined && current.ctimeMs !== undefined) {
  return indexed.mtimeMs === current.mtimeMs
    && indexed.size === current.size
    && indexed.ctimeMs === current.ctimeMs;
}
return fingerprintAvailable
  ? fingerprint(indexedSource) === currentFingerprint
  : false;
```

Update `code-search` stat collection and write-back to carry `ctimeMs`, while
continuing to load older two-field signatures. Do not expose the signature
contents in CLI or Desktop status responses.

- [x] **Step 4: Run focused tests and confirm GREEN**

Run:

```sh
pnpm --filter @dev-agent/code-intelligence run test
pnpm --filter @dev-agent/tools run test
pnpm --filter @agent_cli/cli run test
```

Expected: all focused suites pass, including the existing corrupted-index,
incremental refresh, multi-language, and max-depth tests.

- [x] **Step 5: Verify the real cross-command flow**

Use a temporary project and run:

```sh
node apps/cli/dist/index.js index refresh --cwd <tmp-project> --json
node apps/cli/dist/index.js index status --cwd <tmp-project> --json
```

Then exercise one `CodeSearchTool` refresh against the same index. The status
must be `ready`, the refresh must retain symbols, and no output may contain the
temporary absolute path or source content.

---

### Task 2: Independent audit of remaining unbounded or incompatible input surfaces

**Files:**
- Read-only audit scope: `apps/cli/src`, `apps/desktop/src`, `packages/agent-core/src`, `packages/tools/src`, `packages/mcp/src`, `packages/model/src`, `packages/runtime-manager/src`, `runtime/rust/src`, and their tests.
- Output: `.superpowers/sdd/2026-09-18-next-development-plan/task-2-audit.md`
- No production edits are allowed unless the audit identifies a reproducible defect and the main agent explicitly assigns a follow-up task.

**Interfaces:**
- The audit report lists each user-controlled read/write boundary, its existing
  size/time/shape guard, the covering test, and one of `PRESERVE`, `FIX`, or
  `NEEDS-EVIDENCE`.

- [ ] **Step 1: Build an inventory**

Search for:

```sh
rg -n "readFile|readFileSync|createReadStream|JSON\.parse|JSON\.stringify|readdir|stat\(" \
  apps/cli/src apps/desktop/src packages/agent-core/src packages/tools/src \
  packages/mcp/src packages/model/src packages/runtime-manager/src runtime/rust/src
```

- [ ] **Step 2: Trace each candidate to its caller and test**

For every candidate, record whether input is bounded before bytes are loaded,
whether output is metadata-only, and which test proves the behavior. Do not
classify a path as a bug solely because it uses `readFile`; identify the actual
attacker-controlled or project-controlled input and the observable impact.

- [ ] **Step 3: Produce a bounded decision list**

The report must end with a table containing exact file paths, a reproduction
command for each `FIX`, and the reason each `PRESERVE` item is already covered.
The main agent will decide whether to create another implementation task.

---

### Task 3: Remediate the three reproducible audit findings

Task 2 identified three concrete input-boundary gaps. Each subtask below has a
disjoint production write set and must follow the same RED/GREEN/review loop.

#### 3A: Bound runtime completion metadata reads

**Files:**
- Modify: `packages/runtime-manager/src/manager.ts`
- Test: `packages/runtime-manager/tests/runtime-manager.test.ts`

Add one fixed maximum for install metadata and the completion marker. Check
`lstat().size` before either `readFile`; oversized regular files must return the
existing generic `corrupt` status without exposing paths, bytes, or raw parser
errors. Keep the current incomplete, malformed, checksum, and install contracts
unchanged.

- [x] Add oversized metadata and marker fixtures first and confirm RED.
- [x] Implement the pre-read size guard and confirm the focused suite is GREEN.
- [x] Perform a scoped code review and record the result in the SDD ledger.

#### 3B: Bound desktop session directory discovery

**Files:**
- Modify: `apps/desktop/src/server.ts`
- Test: `apps/desktop/tests/server-edge-cases.test.ts`

Replace full-directory materialization with streaming directory enumeration and
a bounded candidate collection. Preserve the existing 256-entry response cap,
known in-memory session inclusion, deterministic filename selection, metadata
only output, and tolerant handling of missing or corrupt session files.

- [x] Add a fixture that exceeds the response cap and asserts deterministic
  bounded selection before implementation.
- [x] Implement bounded enumeration and confirm the focused desktop suite is
  GREEN.
- [x] Perform a scoped code review and record the result in the SDD ledger.

#### 3C: Bound MCP resource reads before response framing

**Files:**
- Modify: `packages/mcp/src/server.ts`
- Test: `packages/mcp/tests/mcp-server.test.ts`
- Modify: `apps/cli/src/index.ts` only if the built-in workspace resource needs
  the bounded reader contract
- Test: the smallest existing CLI MCP test file that covers the built-in
  resource, or add a focused test beside the relevant command test

Extend the server resource reader contract with an optional bounded-read
context while preserving existing zero-argument resource readers. Pass the
configured frame limit to resource readers, reject oversized returned text
before JSON response serialization, and preserve JSON-RPC error semantics.
The built-in workspace resource must stop enumerating once its bounded output
budget is reached rather than materializing every directory entry.

- [x] Add a resource-specific RED test proving the reader receives and honors
  the byte budget, and that an oversized result is rejected before response
  framing.
- [x] Implement the bounded contract and built-in workspace behavior, then run
  focused MCP and CLI tests.
- [x] Perform a scoped code review and record the result in the SDD ledger.

---

### Task 4: Candidate documentation and release evidence synchronization

**Files:**
- Modify only as needed: `progress.md`
- Modify only as needed: `docs/superpowers/plans/2026-09-18-next-development-plan.md`
- Modify only as needed: `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals-progress.md`
- Modify only as needed: `docs/release-candidate-checklist-v0.1.7-desktop.md`
- Modify only as needed: `docs/CHANGELOG.md`
- Test: `tests/documentation-contract.test.mjs`

**Interfaces:**
- Documentation must distinguish published `@agent_cli/cli@0.1.7` / `v0.1.7`
  from the workspace `0.1.8` candidate.
- It must record Goal 66 and any verified index compatibility change as
  workspace-only candidate work.
- It must not imply tag, push, npm publish, or GitHub Release authorization.

- [x] **Step 1: Write the documentation contract first**

Add assertions for the exact user-visible behavior before editing prose:

```js
assert.match(cliReadme, /config validate\/show[\s\S]*1 MiB/i);
assert.match(cliReadme, /index status[\s\S]*(legacy|compatible|signature)/i);
assert.match(desktopCandidate, /workspace-only|candidate/i);
```

- [x] **Step 2: Run the documentation contract and confirm RED**

Run:

```sh
node --test tests/documentation-contract.test.mjs
```

Expected: only the newly added assertions fail if their wording is not yet
present; unrelated documentation contracts remain green.

- [x] **Step 3: Update the smallest set of source-of-truth documents**

Record exact dates, test counts, and release boundaries. Do not duplicate an
entire architecture description in the changelog or candidate checklist.

- [x] **Step 4: Run the documentation contract again**

Run:

```sh
node --test tests/documentation-contract.test.mjs
git diff --check
```

Expected: all documentation contracts pass and no whitespace errors remain.

---

### Task 5: Full verification and whole-branch review

**Files:**
- Read-only review of the complete working tree and all plan/progress records.

- [x] **Step 1: Run package-focused verification**

Run:

```sh
pnpm --filter @agent_cli/cli run build
pnpm --filter @agent_cli/cli run test
pnpm --filter @dev-agent/code-intelligence run test
pnpm --filter @dev-agent/tools run test
node --test tests/documentation-contract.test.mjs
```

- [x] **Step 2: Run the fixed full gate**

Run:

```sh
pnpm verify
```

Read the complete output and report exact failed phase, exit code, and test
counts if anything fails. A prior run is not evidence for this run.

- [x] **Step 3: Perform a final diff and contract review**

Run:

```sh
git status --short --branch
git diff --stat
git diff --check
git diff -- apps/cli/src/config-command.ts packages/code-intelligence/src/index-status.ts packages/tools/src/code-search.ts
```

Confirm that user changes were preserved, no unrelated files changed, no
release side effect occurred, and every claimed behavior has a current test.

- [x] **Step 4: Update the ledger and handoff**

Record completed tasks, preserved findings, remaining evidence gaps, exact
verification commands, and the next human decision. Do not claim the project
is release-ready merely because local tests pass.

### Desktop test-file race: mitigated

An independent worktree reproduced a real test-harness race: the Desktop edge
case suite temporarily replaces `public/index.html` while another Desktop test
file can read the same path concurrently, causing an intermittent `404`.
After the candidate changes were committed, the equivalent narrow fix landed
in main as commit `310cbce`: the Desktop test script now uses
`--test-concurrency=1`. No cherry-pick of `8d0dafb` was performed.

Fresh verification on 2026-09-19 passed the serialized Desktop focused suite
at **132/132** and the main-tree `pnpm verify` gate with exit code **0**,
ending in `=== all selected gates passed ===`. This validates the mitigation
for the reproduced cross-file race; it does not authorize release by itself.
