import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createRuntimeManifestSignature } from "../packages/runtime-manager/dist/signing.js";
import { validateManifest } from "../packages/runtime-manager/dist/manifest.js";

export const MAX_SIGNED_MANIFEST_BYTES = 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

/**
 * Signs the canonical form of a built runtime manifest with an Ed25519
 * private key (PKCS8 PEM) and writes the base64 signature next to it as
 * `dev-agent-runtime-manifest.sig`. The canonicalization lives in
 * runtime-manager so the workflow's signature matches client-side
 * verification exactly; this wrapper adds file bounding and fail-closed
 * argument handling for CI use.
 */
export function signManifestFile({ manifestPath, outputPath, privateKeyPem }) {
  if (typeof manifestPath !== "string" || manifestPath.trim() === "") {
    fail("manifest path is required");
  }
  const key = typeof privateKeyPem === "string" ? privateKeyPem.trim() : "";
  if (!key.includes("PRIVATE KEY")) {
    fail("an Ed25519 signing key (PKCS8 PEM) is required to sign the runtime manifest");
  }
  const resolvedManifest = resolve(manifestPath);
  const info = statSync(resolvedManifest);
  if (!info.isFile() || info.size > MAX_SIGNED_MANIFEST_BYTES) {
    fail(`runtime manifest is missing or exceeds the ${MAX_SIGNED_MANIFEST_BYTES} byte limit`);
  }
  const manifest = validateManifest(JSON.parse(readFileSync(resolvedManifest, "utf8")));
  const signature = createRuntimeManifestSignature(manifest, key);
  const resolvedOutput = resolve(outputPath ?? `${resolvedManifest}.sig`);
  writeFileSync(resolvedOutput, `${signature}\n`, { encoding: "utf8", mode: 0o600 });
  return resolvedOutput;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--manifest") {
      options.manifestPath = argv[++index];
    } else if (arg === "--output") {
      options.outputPath = argv[++index];
    } else if (arg === "--key-file") {
      options.keyFile = argv[++index];
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  let key = process.env.RUNTIME_MANIFEST_SIGNING_KEY ?? "";
  if (options.keyFile) {
    key = readFileSync(resolve(options.keyFile), "utf8");
  }
  const outputPath = signManifestFile({
    manifestPath: options.manifestPath,
    outputPath: options.outputPath,
    privateKeyPem: key,
  });
  process.stdout.write(`${outputPath}\n`);
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedFile === currentFile) {
  try {
    main();
  } catch (error) {
    console.error(`runtime manifest signing error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
