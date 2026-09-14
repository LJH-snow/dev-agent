# v48 preview contract gate coverage

**日期：2026-09-14**

**状态：root preview contract phase 已接入 TypeScript fixed release gate。**

## Fixed phase

TypeScript mode 的 phase 顺序现在是：

```text
structure -> build -> typecheck -> typescript-test -> preview-contract -> gate-contract
```

`preview-contract` 使用固定命令和固定 repository cwd：

```text
node --test tests/evidence-preview-benchmark.test.mjs tests/evidence-preview-parity.test.mjs
```

它复用前面 `build` phase 生成的 `dist`，不调用 package manager 的任意脚本、不启用
shell、不接受外部 argv/cwd，也不运行 full six-fixture benchmark。

## Coverage matrix

| Root suite | Tests | Boundary |
| --- | ---: | --- |
| `tests/evidence-preview-benchmark.test.mjs` | 5 | benchmark artifact allowlist, canonical bytes, stable ordering, input immutability, malformed selection, sensitive-field exclusion |
| `tests/evidence-preview-parity.test.mjs` | 3 | core/CLI/Desktop counts/bytes parity, filters/UTF-8, query compatibility, generic errors, no provider/session/workspace side effects |
| **Preview contract phase** | **8** | all v45/v46 lightweight preview contracts |

The full `pnpm benchmark:evidence` matrix—including the 100,000-file fixture, timing and
heap measurements—remains an explicit development command. It is not part of default CI or
`pnpm verify` so the gate does not add an implicit large resource budget.

## Fail-fast and report behavior

- A failed preview test returns its non-zero exit code from the fixed phase.
- The runner stops before `gate-contract`, Rust, and integration phases; the report records only
  the completed phase metadata and `failedStepId: "preview-contract"`.
- A successful TypeScript report contains the same metadata-only top-level/step allowlist as
  before; adding the phase does not add command, args, cwd, stdout, stderr, environment, fixture,
  provider, or workspace fields.
- Existing release-gate contract tests now cover the phase's exact command, position, fixed cwd,
  shell=false, and fail-fast/report behavior.

## Verification result

```bash
pnpm verify:typescript
```

The gate passed with the existing TypeScript workspace **612/612**, preview contract **8/8**,
and release-gate contract **11/11**. The full Rust/integration gate is run separately before
publishing the v48 change.
