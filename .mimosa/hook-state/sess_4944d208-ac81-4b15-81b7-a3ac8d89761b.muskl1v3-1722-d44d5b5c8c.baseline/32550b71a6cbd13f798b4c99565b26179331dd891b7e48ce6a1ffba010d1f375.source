import assert from "node:assert/strict";
import test from "node:test";

import { parseBenchmarkCommand, parseSpeedModeCommand } from "../dist/speed-mode-command.js";

test("parses all speed modes and preserves unknown commands", () => {
  assert.deepEqual(parseSpeedModeCommand(":mode"), { kind: "show" });
  assert.deepEqual(parseSpeedModeCommand(":mode FAST"), { kind: "set", mode: "fast" });
  assert.deepEqual(parseSpeedModeCommand(":mode balanced"), { kind: "set", mode: "balanced" });
  assert.deepEqual(parseSpeedModeCommand(":mode deep"), { kind: "set", mode: "deep" });
  assert.deepEqual(parseSpeedModeCommand(":mode turbo"), { kind: "invalid" });
  assert.equal(parseSpeedModeCommand(":model"), undefined);
});

test("bench defaults to hi and accepts a bounded-by-caller prompt string", () => {
  assert.equal(parseBenchmarkCommand(":bench"), "hi");
  assert.equal(parseBenchmarkCommand(":bench hi"), "hi");
  assert.equal(parseBenchmarkCommand(":bench   hello world  "), "hello world");
  assert.equal(parseBenchmarkCommand(":bench   "), "hi");
  assert.equal(parseBenchmarkCommand(":benchmarks"), undefined);
});
