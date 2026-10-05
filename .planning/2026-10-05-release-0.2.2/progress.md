# Progress — @agent_cli/cli 0.2.2 release round

## 2026-10-05

- User authorized the 0.2.2 release round ("可以" after the proposal). npm
  publish was explicitly in the announced plan; the GitHub carrier tag/release
  remains a separate decision, per the standing two-authorization rule.
- Candidate 0.2.2 contents: Security Center metadata-only audit history +
  `:security history`, managed runtime default carrier switch to 0.2.1,
  Desktop Security Center routes and panel, and pre-spawn managed-runtime
  re-validation (`verifyBeforeSpawn`).
- Preparation:
  - `apps/cli/package.json` → 0.2.2; `docs/release-state.json` →
    candidate 0.2.2 / published 0.2.1 / status candidate.
  - README, `docs/release-cli-npm.md`, `docs/next-roadmap-plans-v62-plus.md`
    document the candidate; documentation contract updated for the
    candidate-phase state and re-run 60/60.
  - `pnpm release:preflight`: ok (auth authenticated, registry matched 0.2.1,
    artifact ready, nextAction publish_candidate).
  - Official `npm test` 842/842; `pnpm package:smoke` passed;
    `NODE_USE_ENV_PROXY=1 pnpm runtime:smoke -- --skip-build` passed.
- Environmental fix found and fixed during the round: npm 11.6+ rejects
  project-scoped installs when `allow-scripts` config arrives via the
  environment (EALLOWSCRIPTS). The parent `npm test` session exports the
  user-level `allow-scripts` setting as `npm_config_allow_scripts`, which the
  package/runtime smoke scripts previously forwarded into their child
  `npm install` calls. Both smoke scripts now strip `npm_config_*` from child
  environments (`sanitizedChildEnv`), and the runtime smoke's hardcoded
  carrier constant moved from 0.1.6 to the published 0.2.1.
- Publish result: recorded below after execution.

## Publish evidence

- Completed 2026-10-05: the user authorized the round and completed the npm
  2FA browser authorization on a fresh PTY publish attempt
  (`+ @agent_cli/cli@0.2.2`, tarball `agent_cli-cli-0.2.2.tgz`, 2.9 MB,
  5 files, shasum `adcccab7f3bcc4b3a5ed58c1343e253630f94280`).
- Earlier attempts: the non-interactive governance publish returned
  `publish_failed`; PTY attempts reached the auth stage but the `/-/v1/done`
  poll timed out (E404) until the user clicked in time. One intermediate loop
  misfired by running `npm publish` from the repo root (EPRIVATE) and was
  corrected to run from `apps/cli`; the registry was never touched by any
  failed attempt.
- Registry verification: `npm view @agent_cli/cli@0.2.2 version` → `0.2.2`
  (after the ~2-minute propagation delay seen in prior rounds) and
  `dist-tags.latest` → `0.2.2`.
- Post-publish clean install from the registry: `dev-agent --version` →
  `dev-agent 0.2.2`; provider-free `dev-agent --tools --json` returns normally.
- Documentation flipped to published: `release-state.json` (published 0.2.2,
  status published), README, `docs/release-cli-npm.md` (0.2.2 publication
  record), roadmap, CHANGELOG (merged the unreleased section into the
  0.2.2 release section), documentation contract updated and green.
- The formal GitHub carrier release remains `v0.2.1`; a `v0.2.2` tag/release
  is a separate decision requiring explicit authorization.
- Carrier release completed later on 2026-10-05 after the user said 继续:
  annotated tag `v0.2.2` created at `75553ba` and pushed; release workflow
  run `37306834407` succeeded;
  [GitHub Release v0.2.2](https://github.com/LJH-snow/dev-agent/releases/tag/v0.2.2)
  is formal (non-draft, non-prerelease) with 10 assets (CLI tarball, four
  platform archives, four sha256 sidecars, runtime manifest). All four
  archive checksums were independently re-verified against their sidecars;
  the manifest records releaseVersion 0.2.2 / releaseTag v0.2.2 with four
  targets (runtime identity 0.2.0, protocol 1). End-to-end: clean-installed
  the published 0.2.2 package and completed `runtime install
  --runtime-version 0.2.0 --runtime-release 0.2.2` → `runtime status`
  (installed) → `runtime remove` against an isolated runtime dir.
- Closing scan after the carrier-release docs:
  `scan-2026-10-05T12-12-36.332Z-be57ccea1e00`, seal
  `sha256:f0de74ee7ba26b943b4a53de873c405f80a8f85fa96a840a95a886ccfa4a95de`,
  depth deep, 198 dependencies / 0 advisories, verdict effect `none`.
  Findings: 21 — unchanged across six consecutive scans. Static-only
  evidence, not a runtime security proof.
- Closing scan for the round:
  `scan-2026-10-05T11-40-57.116Z-79526bc7838e`, seal
  `sha256:193d500a07d5b005f7dc48a33aa329c2cfe0a483dc02971ea16db7182e2f7399`,
  depth deep, 198 dependencies / 0 advisories, verdict effect `none`.
  Findings: 21 — unchanged across five consecutive scans; the release round
  (version bump, docs, smoke-script env sanitization) introduced no findings.
  Static-only evidence, not a runtime security proof.
