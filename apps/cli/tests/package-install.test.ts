import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const cliRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(dirname(cliRoot));
const smokeScript = join(repositoryRoot, "scripts", "cli-package-smoke.mjs");

test("CLI tarball installs and runs from outside the workspace", async () => {
  const result = await execFileAsync(process.execPath, [smokeScript], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      // The smoke script supplies its own isolated HOME and never calls a model.
      DEV_AGENT_MODEL_PROVIDER: "ollama",
    },
    maxBuffer: 2 * 1024 * 1024,
  });

  assert.match(result.stdout, /CLI package smoke passed/);
  assert.equal(result.stderr, "");
});
