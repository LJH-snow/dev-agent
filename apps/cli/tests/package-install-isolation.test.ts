import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("package bundling completes before the CLI test runner starts", async () => {
  const manifest = JSON.parse(
    await readFile(join(cliRoot, "package.json"), "utf8")
  );
  const pretestScript = String(manifest.scripts?.pretest ?? "");
  const testScript = String(manifest.scripts?.test ?? "");

  assert.match(testScript, /&& node build-package\.mjs && node --test/);
  assert.equal(pretestScript, "rm -rf tests-dist");
});

test("in-suite package smoke does not start a nested workspace build", async () => {
  const source = await readFile(
    join(cliRoot, "tests", "package-install.test.ts"),
    "utf8"
  );

  assert.match(source, /execFileAsync\(process\.execPath, \[smokeScript, "--skip-build"\]/);
  assert.doesNotMatch(source, /execFileAsync\(process\.execPath, \[smokeScript\]/);
});
