# Runtime manifest signing — key ceremony and verification

The managed Rust runtime is distributed as archives whose integrity is
protected two ways: the manifest records every archive's SHA-256 (verified on
every install), and — optionally — the manifest itself is signed with an
Ed25519 key so clients can detect a tampered or replaced manifest. Both
halves ship; the signature path stays inert until the release maintainer
completes the key ceremony below.

## What exists

- **Workflow signing (release side).** When the repository secret
  `RUNTIME_MANIFEST_SIGNING_KEY` contains an Ed25519 private key (PKCS8 PEM),
  the release workflow signs `dev-agent-runtime-manifest.json` via
  `scripts/sign-runtime-manifest.mjs` (Ed25519 over the canonical manifest
  form produced by `@dev-agent/runtime-manager`) and uploads
  `dev-agent-runtime-manifest.sig` next to it. Without the secret, releases
  stay checksum-only and nothing changes.
- **Client verification (install side).** When
  `DEV_AGENT_RUNTIME_MANIFEST_PUBLIC_KEY` is set to the matching SPKI PEM
  public key, `RuntimeManager` fetches the `.sig` sidecar on every
  `runtime install`, verifies it, and fails closed with
  `MANIFEST_SIGNATURE_INVALID` when the signature is missing, corrupt, or
  produced by a different key. `runtime status --json` and `dev-agent
  --doctor` report the current state as `manifestVerification:
  enabled|not-configured`.

## Key ceremony (release maintainer, one time)

1. Generate the keypair offline; never commit or transmit the private key:

   ```bash
   node -e '
   const { generateKeyPairSync } = require("node:crypto");
   const { privateKey, publicKey } = generateKeyPairSync("ed25519");
   console.log(privateKey.export({ type: "pkcs8", format: "pem" }));
   console.error(publicKey.export({ type: "spki", format: "pem" }));
   ' > /tmp/runtime-manifest-key.pem 2> /tmp/runtime-manifest-pub.pem
   ```

2. Store the private PEM as the repository secret
   `RUNTIME_MANIFEST_SIGNING_KEY` (Settings → Secrets and variables →
   Actions). The release workflow reads only that secret; it is never echoed
   or persisted.
3. Publish the public key (`/tmp/runtime-manifest-pub.pem`) out of band —
   pin it in release notes and in this document — so users can configure
   `DEV_AGENT_RUNTIME_MANIFEST_PUBLIC_KEY` and verify they got the genuine
   manifest.
4. From the next tag onward, releases carry
   `dev-agent-runtime-manifest.sig`; users with the public key configured
   fail closed on any release whose manifest was not signed by the matching
   key.

## Failure semantics

| Condition | Result |
| --- | --- |
| No client public key configured | Checksum-only trust model, unchanged behavior |
| Public key configured, `.sig` missing | Install fails (`MANIFEST_SIGNATURE_INVALID`) |
| Public key configured, signature mismatch | Install fails (`MANIFEST_SIGNATURE_INVALID`) |
| Workflow secret set | Release publishes the `.sig` sidecar |
| Workflow secret absent | Checksum-only release; no sidecar is created |

Signing proves the manifest came from the release process; it is not a
runtime security proof and does not change the sandbox or approval model.
