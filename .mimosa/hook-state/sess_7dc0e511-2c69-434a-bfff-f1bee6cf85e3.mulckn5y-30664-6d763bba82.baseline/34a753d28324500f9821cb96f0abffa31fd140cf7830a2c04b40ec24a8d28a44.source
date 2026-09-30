import assert from "node:assert/strict";
import test from "node:test";

import {
  StreamOutputBudget,
  StreamOutputLimitError,
} from "../dist/stream-budget.js";

test("StreamOutputBudget counts UTF-8 bytes for text and JSON", () => {
  const textBudget = new StreamOutputBudget(4);
  textBudget.addText("😀");

  assert.throws(
    () => textBudget.addText("x"),
    (error) => {
      assert.ok(error instanceof StreamOutputLimitError);
      assert.equal(error.code, "stream_output_limit");
      assert.equal(error.limitBytes, 4);
      assert.equal(error.observedBytes, 5);
      return true;
    }
  );

  const jsonBudget = new StreamOutputBudget(5);
  assert.throws(
    () => jsonBudget.addJson("😀"),
    (error) => {
      assert.ok(error instanceof StreamOutputLimitError);
      assert.equal(error.observedBytes, 6);
      return true;
    }
  );
});
