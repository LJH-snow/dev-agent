import assert from "node:assert/strict";
import test from "node:test";

import {
  createInkRenderOutput,
  normalizeInkTerminalSize,
} from "../dist/ink/terminal-size.js";

test("Ink terminal dimensions never leave zero rows during startup", () => {
  const output = {
    columns: 0,
    rows: 0,
    getWindowSize: () => [0, 0] as const,
  };

  assert.deepEqual(
    normalizeInkTerminalSize(output, {}),
    { columns: 80, rows: 24 },
  );
  assert.equal(output.columns, 80);
  assert.equal(output.rows, 24);
});

test("Ink terminal dimensions prefer the live TTY size", () => {
  const output = {
    columns: 120,
    rows: 48,
    getWindowSize: () => [80, 24] as const,
  };

  assert.deepEqual(
    normalizeInkTerminalSize(output, { COLUMNS: "100", LINES: "30" }),
    { columns: 120, rows: 48 },
  );
});

test("Ink render output keeps one virtual row above the real terminal height", () => {
  const output = {
    columns: 80,
    rows: 24,
  } as unknown as NodeJS.WriteStream;

  const guarded = createInkRenderOutput(output);

  assert.equal(guarded.columns, 80);
  assert.equal(guarded.rows, 25);
});

test("startup fallback is normalized before the Ink row guard is applied", () => {
  const output = {
    columns: 0,
    rows: 0,
    getWindowSize: () => [0, 0] as const,
  } as unknown as NodeJS.WriteStream;

  normalizeInkTerminalSize(output, {});
  const guarded = createInkRenderOutput(output);

  assert.equal(output.columns, 80);
  assert.equal(output.rows, 24);
  assert.equal(guarded.rows, 25);
});
