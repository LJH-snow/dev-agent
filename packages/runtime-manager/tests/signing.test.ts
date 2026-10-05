import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  createRuntimeManifestSignature,
  verifyManifestSignature,
} from "../dist/signing.js";
import { canonicalizeManifest } from "../dist/manifest.js";

function manifestFor(): any {
  return {
    schemaVersion: 1,
    product: "dev-agent",
    runtime: "dev-agent-executor",
    releaseVersion: "0.2.2",
    releaseTag: "v0.2.2",
    repository: "LJH-snow/dev-agent",
    protocolVersion: 1,
    artifacts: [
      {
        target: "aarch64-apple-darwin",
        os: "darwin",
        arch: "arm64",
        libc: "none",
        archive: "dev-agent-executor-aarch64-apple-darwin.tar.gz",
        binary: "aarch64-apple-darwin/dev-agent-executor",
        sha256: "a".repeat(64),
        size: 1024,
      },
    ],
  };
}

test("ed25519 signatures verify against the canonical manifest and detect tampering", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const manifest = manifestFor();
  const signature = createRuntimeManifestSignature(manifest, privateKeyPem);

  assert.equal(typeof signature, "string");
  assert.ok(signature.length > 0 && signature.length <= 256);
  assert.equal(verifyManifestSignature(manifest, signature, publicKeyPem), true);

  const tampered = { ...manifest, releaseVersion: "0.2.3" };
  assert.equal(verifyManifestSignature(tampered, signature, publicKeyPem), false);

  const flippedTarget = {
    ...manifest,
    artifacts: [{ ...manifest.artifacts[0], sha256: "b".repeat(64) }],
  };
  assert.equal(verifyManifestSignature(flippedTarget, signature, publicKeyPem), false);

  assert.equal(verifyManifestSignature(manifest, `${signature.slice(0, -2)}AA`, publicKeyPem), false);
  assert.equal(verifyManifestSignature(manifest, "", publicKeyPem), false);
  assert.equal(verifyManifestSignature(manifest, undefined, publicKeyPem), false);
  assert.equal(verifyManifestSignature(manifest, "x".repeat(10_000), publicKeyPem), false);

  const { publicKey: otherKey } = generateKeyPairSync("ed25519");
  const otherPem = otherKey.export({ type: "spki", format: "pem" }).toString();
  assert.equal(verifyManifestSignature(manifest, signature, otherPem), false);
});

test("verification fails closed for unparseable manifests and malformed keys", () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  assert.equal(verifyManifestSignature({ nope: true } as any, "AAAA", publicKeyPem), false);
  assert.equal(verifyManifestSignature(manifestFor(), "AAAA", "not-a-key"), false);
  assert.equal(canonicalizeManifest(manifestFor()).length > 0, true);
});
