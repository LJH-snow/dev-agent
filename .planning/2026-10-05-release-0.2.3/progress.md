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

- Completed 2026-10-06: after several auth sessions timed out (the user was
  intermittent), a retry loop maintained fresh auth URLs and the user
  completed browser authorization; npm accepted the publish
  (`+ @agent_cli/cli@0.2.3`). Note: the authorization landed after npm's
  CLI-side poll had moved on — the server processed the pending publish and
  the loop's next attempt was stopped cleanly (a duplicate publish would
  have been rejected by npm anyway).
- Registry verification: `npm view @agent_cli/cli@0.2.3 version` → `0.2.3`
  (after ~80 seconds of propagation delay) and `dist-tags.latest` → `0.2.3`.
- Post-publish clean install from the registry: `dev-agent --version` →
  `dev-agent 0.2.3`; provider-free `runtime status --json` returns normally
  and includes the new `manifestVerification: "not-configured"` field.
- Documentation flipped to published: `release-state.json` (published 0.2.3,
  status published, updatedAt 2026-10-06), README, `docs/release-cli-npm.md`
  (0.2.3 publication record), roadmap, CHANGELOG (new 2026-10-06 section),
  documentation contract updated and green.
- The formal GitHub carrier release remains `v0.2.2`; a `v0.2.3` tag/release
  is a separate decision requiring explicit authorization.
- Closing scan: `scan-2026-10-05T16-08-57.281Z-cd3941cd33da`, seal
  `sha256:18cbacac7ccaf00843b5e1fbe51cbbc974aa1ba83d90ed47cc2017298a5ac212`,
  depth deep, 198 dependencies / 0 advisories, verdict effect `none`.
  Findings: 21 — unchanged across ten consecutive scans. Static-only
  evidence, not a runtime security proof.
