# Progress — release-side manifest signing (opt-in, secret-gated)

## 2026-10-05

- Completes the client half shipped in `48eb8d7`: the release workflow can
  now produce `dev-agent-runtime-manifest.sig` without changing anything for
  existing (unsigned) releases.
- RED first: `tests/sign-runtime-manifest.test.mjs` (script missing → fail)
  and two new contract tests in `tests/release-workflow.test.mjs` (workflow
  lacked the secret gate / sign step / consistency checks) — both confirmed
  failing before implementation.
- Implementation:
  - `scripts/sign-runtime-manifest.mjs`: reads the built manifest (1 MiB
    cap, must validate), signs its canonical form with an Ed25519 PKCS8 PEM
    key (env `RUNTIME_MANIFEST_SIGNING_KEY` or `--key-file`), writes the
    base64 sidecar with `0o600`. Canonicalization is imported from
    `packages/runtime-manager/dist/signing.js` — the workflow never
    improvises its own canonical form.
  - `release.yml` manifest job: secret-gated optional step (pnpm install +
    runtime-manager build + sign); the artifact upload pattern now carries
    the sig when present. `release.yml` release job: sig/secret consistency
    check (with secret → sidecar must exist and stay ≤ 256 bytes; without →
    sidecar must not exist), allowlist extended, `gh release create`
    includes the sidecar conditionally via `sig_args`.
- End-to-end evidence: signed the REAL published v0.2.2 manifest with a
  locally generated keypair and verified the sidecar with the matching
  public key through `verifyManifestSignature` → true.
- Verification: workflow contract 15/15, sign script 2/2, runtime-manifest
  and documentation contracts green (82/82 across the four root files);
  YAML parses cleanly.
- Key ceremony remains a user decision: generate an Ed25519 keypair, store
  the private PEM as the `RUNTIME_MANIFEST_SIGNING_KEY` secret, and pin the
  public key in docs for users who set `DEV_AGENT_RUNTIME_MANIFEST_PUBLIC_KEY`.
  Until then, no release produces a signature and all existing behavior is
  unchanged.
