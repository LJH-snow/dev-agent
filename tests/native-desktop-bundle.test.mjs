import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const launcher = readFileSync(resolve(root, "script/build_and_run.sh"), "utf8");

test("native launcher stages the canonical Signal Loom icon", () => {
  assert.equal(existsSync(resolve(root, "apps/desktop/public/signal-loom.svg")), true);
  assert.match(launcher, /signal-loom\.svg/);
  assert.match(launcher, /iconutil -c icns/);
  assert.match(launcher, /CFBundleIconFile/);
  assert.match(launcher, /SignalLoom\.icns/);
});

test("native launcher exposes a local archive mode without launching", () => {
  assert.match(launcher, /--package\|package/);
  assert.match(launcher, /Signal Loom Desktop-local\.zip/);
  assert.match(launcher, /ditto -c -k/);
  assert.match(launcher, /shasum -a 256/);
});
