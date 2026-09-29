import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import {
  ENTER_ALTERNATE_SCREEN,
  EXIT_ALTERNATE_SCREEN,
  alternateScreenEnabled,
  createAlternateScreenSession,
} from "../dist/ink/alternate-screen.js";

const execFileAsync = promisify(execFile);

test("alternate screen is opt-in via environment", () => {
  assert.equal(alternateScreenEnabled({}), false);
  assert.equal(alternateScreenEnabled({ DEV_AGENT_TUI_ALT_SCREEN: "1" }), true);
  assert.equal(alternateScreenEnabled({ DEV_AGENT_TUI_ALT_SCREEN: "0" }), false);
  assert.equal(alternateScreenEnabled({ DEV_AGENT_TUI_ALT_SCREEN: "" }), false);
});

test("enter writes the enter sequence once and exit restores exactly once", () => {
  const writes: string[] = [];
  const session = createAlternateScreenSession((data) => writes.push(data), true);
  session.enter();
  session.enter();
  assert.deepEqual(writes, [ENTER_ALTERNATE_SCREEN]);
  session.exit();
  session.exit();
  assert.deepEqual(writes, [ENTER_ALTERNATE_SCREEN, EXIT_ALTERNATE_SCREEN]);
});

test("disabled sessions never write", () => {
  const writes: string[] = [];
  const session = createAlternateScreenSession((data) => writes.push(data), false);
  session.enter();
  session.exit();
  assert.deepEqual(writes, []);
});

test("a failing stream does not register the exit hook or throw", () => {
  let calls = 0;
  const session = createAlternateScreenSession(() => {
    calls += 1;
    throw new Error("stream destroyed");
  }, true);
  assert.doesNotThrow(() => session.enter());
  assert.doesNotThrow(() => session.exit());
  assert.equal(calls, 1);
});

test("process exit still restores the alternate screen", async () => {
  const modulePath = fileURLToPath(
    new URL("../dist/ink/alternate-screen.js", import.meta.url),
  );
  const script = `
    import { createAlternateScreenSession } from ${JSON.stringify(pathToFileURL(modulePath).href)};
    const session = createAlternateScreenSession(
      (data) => { process.stdout.write(data); },
      true,
    );
    session.enter();
    process.exit(0);
  `;
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { timeout: 10_000 },
  );
  assert.equal(stdout, `${ENTER_ALTERNATE_SCREEN}${EXIT_ALTERNATE_SCREEN}`);
});
