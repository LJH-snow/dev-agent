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
