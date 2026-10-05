# Progress — session picker + manifest signature verification round

## 2026-10-05

### Slice 1: Desktop panel scan-scope session picker (commit `7c3a285`)

- Contract RED first (panel contract test failed on the missing select), then:
  labeled `<select id="security-center-session">` with a "Default workspace"
  empty default; populated from `GET /api/sessions` capped at 256 entries,
  reading only `sessionId` strings (content-derived previews ignored);
  selection preserved across refreshes; "Run bounded scan" sends
  `{ sessionId }` only when a session is selected, so the existing route's
  fail-closed 400/404 handling covers bad ids. en/zh i18n keys added.
- Desktop suite 450/450.

### Slice 2: opt-in Ed25519 manifest signature verification (commit `48eb8d7`)

- RED tests first: `signing.test.ts` (sign/verify roundtrip, tampered
  releaseVersion, flipped artifact sha256, flipped sig bytes, empty/oversized
  sig, wrong key, unparseable manifest, malformed key → all fail closed) and
  a manager-level test (valid signature → install succeeds and the signature
  downloader is hit exactly once; tampered/missing signature →
  `MANIFEST_SIGNATURE_INVALID`; no configured key → signature downloader is
  never invoked).
- Implementation:
  - `signing.ts`: `createRuntimeManifestSignature()` (Ed25519 over
    `canonicalizeManifest()`, PKCS8 PEM), `verifyManifestSignature()`
    (never throws, 256-char signature cap), `generateManifestSigningKeyPair()`
    for tooling.
  - `getManifestSignatureDownloadUrl()` →
    `<release>/dev-agent-runtime-manifest.sig`; default signature downloader
    mirrors the bounded manifest reader.
  - `RuntimeManager`: `manifestVerifyPublicKey` + `manifestSignatureDownloader`
    options; `loadManifest()` verifies after full manifest validation and
    before any archive download; new error code `MANIFEST_SIGNATURE_INVALID`.
  - CLI: `createCliRuntimeManager` enables verification only when
    `DEV_AGENT_RUNTIME_MANIFEST_PUBLIC_KEY` is set; the private key is never
    accepted at runtime.
- runtime-manager suite 29/29 (2 new + 1 new manager test); CLI runtime
  tests 7/7; docs contract 60/60.

### Governance note (same pattern as npm provenance)

The release workflow does not yet produce `dev-agent-runtime-manifest.sig`;
that step needs a generated Ed25519 keypair with the private half stored as a
repository secret and the public half pinned in docs/CLI usage. Both halves
of the feature are now in place; enabling them end-to-end requires the
user's key ceremony decision. Until then the verification path exists but is
inert (no key configured → unchanged behavior; release has no .sig →
verification is only triggerable with the env var set and would fail closed,
correctly blocking unverified installs for users who opt in).

### Closing scan

`scan-2026-10-05T13-11-05.142Z-60b4dc4ac8fa`, seal
`sha256:405ae5ab206038d198fa29f0d4d758b8cabf8ccdbc77289efd0aa5dc77a29877`,
depth deep, 198 dependencies / 0 advisories, verdict effect `none`.
Findings: 21 — unchanged across eight consecutive scans; zero findings in
the touched files. Static-only evidence, not a runtime security proof.
