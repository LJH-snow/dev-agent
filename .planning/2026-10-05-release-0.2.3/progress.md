# Progress — @agent_cli/cli 0.2.3 release round

## 2026-10-05

- User authorized the 0.2.3 round ("继续" after the proposal naming the
  0.2.3 发布轮 as the next node). npm publish with 2FA is in the announced
  plan; the GitHub carrier tag remains a separate decision.
- Candidate 0.2.3 contents: Desktop Security Center completion (clear
  history, MCP metadata inspection, scan-scope session picker), opt-in
  Ed25519 manifest signature verification (client + secret-gated workflow
  signing), `runtime status` reporting `manifestVerification`, and the
  packaged default carrier following 0.2.2.
- Slice before the bump (RED first): `resolveManagedRuntimeStatus` and the
  `runtime status` payload now report `manifestVerification`
  ("enabled"/"not-configured") from `DEV_AGENT_RUNTIME_MANIFEST_PUBLIC_KEY`.
  runtime-command tests 8/8.
- Preparation: version 0.2.3, release-state candidate, README /
  release-cli-npm / roadmap candidate sections, docs contract 60/60,
  preflight ok (auth authenticated, registry matched 0.2.2, artifact ready),
  package smoke passed, runtime smoke passed (carrier 0.2.2), official
  `npm test` 843/843 on rerun (first run had three unrelated 20-31s PTY
  waitFor flakes under load; rerun green, no assertion loosened).
- Publish result: recorded below after execution.

## Publish evidence

- (pending)
