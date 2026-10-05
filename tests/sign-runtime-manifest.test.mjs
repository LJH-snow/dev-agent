import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const signingDist = join(repoRoot, "packages", "runtime-manager", "dist", "signing.js");

if (!existsSync(signingDist)) {
  execFileSync("pnpm", ["--filter", "@dev-agent/runtime-manager", "run", "build"], {
    cwd: repoRoot,
    stdio: "pipe",
  });
}

const { verifyManifestSignature } = await import(pathToFileURL(signingDist));
const { signManifestFile, MAX_SIGNED_MANIFEST_BYTES } = await import(
  pathToFileURL(join(repoRoot, "scripts", "sign-runtime-manifest.mjs"))
);

function manifestFor() {
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
      {
        target: "x86_64-unknown-linux-gnu",
        os: "linux",
        arch: "x64",
        libc: "glibc",
        archive: "dev-agent-executor-x86_64-unknown-linux-gnu.tar.gz",
        binary: "x86_64-unknown-linux-gnu/dev-agent-executor",
        sha256: "b".repeat(64),
        size: 2048,
      },
    ],
  };
}

function keyPair() {
  return generateKeyPairSync("ed25519");
}

test("signs the release manifest into a .sig sidecar that client verification accepts", () => {
  const { privateKey, publicKey } = keyPair();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const directory = mkdtempSync(join(tmpdir(), "dev-agent-sign-manifest-"));
  const manifestPath = join(directory, "dev-agent-runtime-manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifestFor(), null, 2)}\n`, "utf8");

  const outputPath = signManifestFile({ manifestPath, privateKeyPem });
  assert.equal(outputPath, `${manifestPath}.sig`);

  const signature = readFileSync(outputPath, "utf8").trim();
  assert.ok(signature.length > 0 && signature.length <= 256);
  assert.equal(verifyManifestSignature(manifestFor(), signature, publicKeyPem), true);

  const tampered = JSON.parse(readFileSync(manifestPath, "utf8"));
  tampered.releaseVersion = "9.9.9";
  assert.equal(verifyManifestSignature(tampered, signature, publicKeyPem), false);
});

test("sign script fails closed on missing key, oversized manifest, and invalid manifest", () => {
  const directory = mkdtempSync(join(tmpdir(), "dev-agent-sign-manifest-fail-"));
  const manifestPath = join(directory, "dev-agent-runtime-manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifestFor(), null, 2)}\n`, "utf8");

  assert.throws(() => signManifestFile({ manifestPath }), /signing key/i);
  assert.throws(
    () => signManifestFile({ manifestPath, privateKeyPem: "not-a-key" }),
    /sign|key/i
  );

  const oversizedPath = join(directory, "oversized.json");
  writeFileSync(oversizedPath, "x".repeat(MAX_SIGNED_MANIFEST_BYTES + 1), "utf8");
  assert.throws(
    () => signManifestFile({ manifestPath: oversizedPath, privateKeyPem: "ignored" }),
    /manifest/i
  );

  const invalidPath = join(directory, "invalid.json");
  writeFileSync(invalidPath, "{ not a manifest }", "utf8");
  assert.throws(
    () => signManifestFile({ manifestPath: invalidPath, privateKeyPem: "also-ignored" }),
    /manifest/i
  );
});
