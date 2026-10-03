import assert from "node:assert/strict";
import test from "node:test";

import { parseTeamCommand } from "../dist/index.js";

test("parses collaborative execution and review commands", () => {
  assert.deepEqual(parseTeamCommand(":team fix the auth flow"), {
    kind: "execute",
    request: "fix the auth flow",
  });
  assert.deepEqual(parseTeamCommand(":team plan fix the auth flow"), {
    kind: "plan",
    request: "fix the auth flow",
  });
  assert.deepEqual(parseTeamCommand(":team apply"), { kind: "apply" });
  assert.deepEqual(parseTeamCommand(":team cancel coding"), {
    kind: "cancel",
    taskId: "coding",
  });
  assert.deepEqual(parseTeamCommand(":team retry coding"), {
    kind: "retry",
    taskId: "coding",
  });
});

test("does not treat ordinary commands as team commands", () => {
  assert.equal(parseTeamCommand(":plan fix the auth flow"), undefined);
  assert.deepEqual(parseTeamCommand(":team"), { kind: "execute", request: "" });
  assert.deepEqual(parseTeamCommand(":team retry"), { kind: "retry", taskId: "" });
});
