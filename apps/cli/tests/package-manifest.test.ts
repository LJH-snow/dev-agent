import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

type PackageManifest = {
  name?: string;
  version?: string;
  private?: boolean;
  license?: string;
  repository?: { type?: string; url?: string };
  homepage?: string;
  bugs?: { url?: string };
  main?: string;
  exports?: unknown;
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  files?: string[];
  scripts?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const cliRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packagePath = join(cliRoot, "package.json");
const sourceEntryPath = join(cliRoot, "src", "index.ts");
const bundlePath = join(cliRoot, "dist", "cli.js");

async function readManifest(): Promise<PackageManifest> {
  return JSON.parse(await readFile(packagePath, "utf8")) as PackageManifest;
}

test("CLI package is publishable and exposes the bundled executable", async () => {
  const manifest = await readManifest();
  const sourceEntry = await readFile(sourceEntryPath, "utf8");

  assert.equal(manifest.name, "@agent_cli/cli");
  assert.notEqual(manifest.private, true, "the public CLI package must not be private");
  assert.equal(manifest.license, "MIT");
  assert.equal(
    manifest.repository?.url,
    "git+https://github.com/LJH-snow/dev-agent.git"
  );
  assert.equal(manifest.homepage, "https://github.com/LJH-snow/dev-agent#readme");
  assert.equal(manifest.bugs?.url, "https://github.com/LJH-snow/dev-agent/issues");
  assert.equal(manifest.main, "dist/cli.js");
  assert.equal(manifest.bin?.["dev-agent"], "dist/cli.js");
  assert.equal(manifest.engines?.node, ">=20");
  assert.deepEqual(manifest.files, ["dist/cli.js", "dist/cli.js.map", "LICENSE"]);
  assert.match(sourceEntry, /^#!\/usr\/bin\/env node\n/);
  await assert.doesNotReject(readFile(bundlePath), "the package bundle must be built");
  const bundle = await readFile(bundlePath, "utf8");
  assert.match(
    bundle,
    /const require = __devAgentCreateRequire\(import\.meta\.url\)/,
    "the ESM bundle must bridge dynamic CommonJS requires",
  );
  const bundleStats = await stat(bundlePath);
  assert.notEqual(bundleStats.mode & 0o111, 0, "the npm bin target must be executable");
});

test("CLI package has no unresolved workspace runtime dependencies", async () => {
  const manifest = await readManifest();
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    assert.ok(
      !version.startsWith("workspace:"),
      `${name} still uses an unresolved workspace dependency: ${version}`
    );
  }
});


test("the npm CLI package does not install a Rust runtime implicitly", async () => {
  const manifest = await readManifest();
  assert.equal(manifest.scripts?.postinstall, undefined);
  assert.equal(manifest.scripts?.preinstall, undefined);
  assert.equal(
    (manifest.files ?? []).some((file) => file.includes("dev-agent-executor")),
    false
  );
});

test("rich TTY rendering is backed by Ink and React", async () => {
  const manifest = await readManifest();

  assert.match(manifest.dependencies?.ink ?? "", /^\^?6\./);
  assert.match(manifest.dependencies?.react ?? "", /^\^?19\./);
  assert.match(manifest.devDependencies?.["@types/react"] ?? "", /^\^?19\./);
  assert.equal(
    manifest.dependencies?.["react-devtools-core"],
    undefined,
    "React DevTools is optional and must not be a published CLI runtime dependency",
  );
});
