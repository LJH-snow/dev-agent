import assert from "node:assert/strict";
import test from "node:test";
import { parseSecurityCommand } from "../dist/security-center.js";

test("security commands are read-only and parse aliases", () => {
  assert.deepEqual(parseSecurityCommand(":security"), { handled: true, action: "scan" });
  assert.deepEqual(parseSecurityCommand("/security scan"), { handled: true, action: "scan" });
  assert.deepEqual(parseSecurityCommand(":security history"), { handled: true, action: "history" });
  assert.deepEqual(parseSecurityCommand("/security history"), { handled: true, action: "history" });
  assert.deepEqual(parseSecurityCommand(":security clear"), { handled: true, action: "clear" });
  assert.deepEqual(parseSecurityCommand("/security clear confirm"), { handled: true, action: "clear-confirm" });
  assert.deepEqual(parseSecurityCommand(":security help"), { handled: true, action: "help" });
  assert.deepEqual(parseSecurityCommand(":security fix"), { handled: true, action: "invalid" });
  assert.deepEqual(parseSecurityCommand(":security history extra"), { handled: true, action: "invalid" });
  assert.equal(parseSecurityCommand(":skill security"), undefined);
});
