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

- Blocked on user 2FA: the non-interactive governance publish returned
  `publish_failed`; the PTY-wrapped `npm publish` reached the auth stage and
  printed browser-auth URLs, but the `/-/v1/done` poll timed out (E404) before
  the user completed authorization. An auto-retry loop (15 attempts over
  ~35 minutes, freshest URL maintained in `/tmp/dev-agent-npm-auth-latest.txt`)
  also exhausted without a completed authorization.
- Registry stayed consistent throughout: `dist-tags.latest` remained `0.2.1`
  and `@agent_cli/cli@0.2.2` was never partially published.
- The candidate is fully prepared, verified, and committed (`d6b65f2`).
  Completion path when the user is ready: re-run the PTY publish (or the
  guarded `pnpm release:publish -- --publish` after a fresh `npm login`)
  and click the printed URL within its short validity window; then re-check
  `npm view @agent_cli/cli@0.2.2 version` and `dist-tags.latest`, flip
  `docs/release-state.json` to published 0.2.2, update the docs contract and
  CHANGELOG, and commit.
