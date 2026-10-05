import { createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { canonicalizeManifest } from "./manifest.js";
import type { RuntimeManifest } from "./types.js";

/** Ed25519 signatures are 64 bytes → 88 base64 chars; the cap absorbs padding variants. */
export const MAX_MANIFEST_SIGNATURE_CHARS = 256;

/**
 * Signs the canonical form of a runtime manifest with an Ed25519 private key
 * (PKCS8 PEM). The canonical form is deterministic, so signatures made by the
 * release workflow verify identically inside the manager.
 */
export function createRuntimeManifestSignature(manifest: RuntimeManifest, privateKeyPem: string): string {
  const canonical = canonicalizeManifest(manifest);
  const signature = cryptoSign(null, Buffer.from(canonical, "utf8"), privateKeyPem);
  return signature.toString("base64");
}

/**
 * Verifies a base64 Ed25519 signature over the manifest's canonical form.
 * Every failure mode — malformed manifest, malformed key, bad base64, wrong
 * length, tampered content — returns false; it never throws.
 */
export function verifyManifestSignature(manifest: RuntimeManifest, signature: unknown, publicKeyPem: string): boolean {
  if (typeof signature !== "string" || signature.length === 0 || signature.length > MAX_MANIFEST_SIGNATURE_CHARS) {
    return false;
  }
  let canonical: string;
  try {
    canonical = canonicalizeManifest(manifest);
  } catch {
    return false;
  }
  let publicKey: ReturnType<typeof createPublicKey>;
  try {
    publicKey = createPublicKey(publicKeyPem);
  } catch {
    return false;
  }
  try {
    return cryptoVerify(null, Buffer.from(canonical, "utf8"), publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

/** Test/tooling convenience: generates an Ed25519 keypair as PEM strings. */
export function generateManifestSigningKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}
