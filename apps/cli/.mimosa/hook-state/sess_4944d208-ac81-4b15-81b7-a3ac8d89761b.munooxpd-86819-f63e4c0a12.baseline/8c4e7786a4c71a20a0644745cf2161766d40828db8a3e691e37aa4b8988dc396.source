import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { render, Text } from "ink";

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

test("Ink 7 native alternateScreen enters before the first frame and exits on unmount", async () => {
  const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream;
  Object.assign(stdin, {
    isTTY: true,
    setRawMode: () => stdin,
    ref: () => stdin,
    unref: () => stdin,
  });
  const writes: string[] = [];
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      writes.push(String(chunk));
      callback();
    },
  }) as Writable & NodeJS.WriteStream;
  Object.assign(stdout, { isTTY: true, columns: 80, rows: 24 });

  const instance = render(createElement(Text, null, "native alt-screen"), {
    stdin,
    stdout,
    stderr: stdout,
    interactive: true,
    alternateScreen: true,
    patchConsole: false,
    exitOnCtrlC: false,
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const beforeUnmount = writes.join("");
    assert.ok(beforeUnmount.includes(ENTER_ALTERNATE_SCREEN));
    assert.ok(beforeUnmount.includes("native alt-screen"));
    assert.equal(beforeUnmount.includes(EXIT_ALTERNATE_SCREEN), false);

    instance.unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const output = writes.join("");
    assert.ok(output.indexOf(ENTER_ALTERNATE_SCREEN) < output.indexOf("native alt-screen"));
    assert.ok(output.lastIndexOf(EXIT_ALTERNATE_SCREEN) > output.indexOf("native alt-screen"));
  } finally {
    stdin.destroy();
    stdout.destroy();
  }
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
